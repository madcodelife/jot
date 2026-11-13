//! `Notes`: the notes folder as a class, wrapping `jot_store::Store`.

use std::fmt::Display;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use jot_store::{Source, Store, StoreError, Watcher};
use nsh_core::element::io_code;
use nsh_core::prelude::*;

use crate::relay::relay;

/// The notes folder: one Markdown file per note, the file name its title.
/// Every member runs at once and throws an `Error` when it fails, with a
/// `code`: `ERR_JOT_INVALID_TITLE`, `ERR_JOT_NOT_FOUND`,
/// `ERR_JOT_ALREADY_EXISTS`, `ERR_JOT_CHANGED` (a to-do line changed
/// since it was read), or the file system's (`EACCES`, `ENOSPC`, ...).
#[class]
pub struct Notes {
    store: Store,
    /// The folder watcher `watch` started; replaced by the next `watch`.
    watcher: Option<Watcher>,
}

#[class]
impl Notes {
    /// Opens the notes folder `dir` (a leading `~/` is the home folder),
    /// creating it if missing; throws when it cannot.
    pub fn new(dir: String) -> Result<Self, JsError> {
        let path = expand_home(&dir);
        let store = Store::open(path)
            .map_err(|e| store_error(e, format_args!("cannot open the notes folder {dir:?}")))?;
        Ok(Notes {
            store,
            watcher: None,
        })
    }

    /// The folder's path.
    #[getter]
    pub fn dir(&self) -> String {
        self.store.root().to_string_lossy().into_owned()
    }

    /// Every note, most recently modified first.
    pub fn list(&self) -> Result<Vec<NoteMeta>, JsError> {
        let notes = self
            .store
            .list()
            .map_err(|e| store_error(e, "cannot list the notes"))?;
        Ok(notes.into_iter().map(NoteMeta::from).collect())
    }

    /// The notes whose title or body holds every word of `query` (case
    /// does not matter), title matches first, then the most recently
    /// modified; at most `limit`. An empty query lists the latest notes.
    pub fn search(&self, query: String, limit: u32) -> Result<Vec<SearchHit>, JsError> {
        let hits = self
            .store
            .search(&query, limit as usize)
            .map_err(|e| store_error(e, format_args!("cannot search for {query:?}")))?;
        Ok(hits.into_iter().map(SearchHit::from).collect())
    }

    /// The note titled `title` (case does not matter), or `null`.
    pub fn read(&self, title: String) -> Result<Option<Note>, JsError> {
        let note = self
            .store
            .read(&title)
            .map_err(|e| store_error(e, format_args!("cannot read the note {title:?}")))?;
        Ok(note.map(Note::from))
    }

    /// Replaces the body of the note titled `title`, keeping its
    /// frontmatter, or creates the note: the editor's autosave.
    pub fn write(&mut self, title: String, body: String) -> Result<NoteMeta, JsError> {
        let meta = self
            .store
            .write(&title, &body)
            .map_err(|e| store_error(e, format_args!("cannot save the note {title:?}")))?;
        Ok(meta.into())
    }

    /// Creates a note; throws `ERR_JOT_ALREADY_EXISTS` when a note has the
    /// title.
    pub fn create(&mut self, title: String, body: String) -> Result<NoteMeta, JsError> {
        let meta = self
            .store
            .create(&title, &body, Source::User)
            .map_err(|e| store_error(e, format_args!("cannot create the note {title:?}")))?;
        Ok(meta.into())
    }

    /// Renames the note `from` to `to`; throws `ERR_JOT_NOT_FOUND` or
    /// `ERR_JOT_ALREADY_EXISTS`.
    pub fn rename(&mut self, from: String, to: String) -> Result<NoteMeta, JsError> {
        let meta = self.store.rename(&from, &to).map_err(|e| {
            store_error(e, format_args!("cannot rename the note {from:?} to {to:?}"))
        })?;
        Ok(meta.into())
    }

    /// Deletes the note's file.
    pub fn delete(&mut self, title: String) -> Result<(), JsError> {
        self.store
            .delete(&title)
            .map_err(|e| store_error(e, format_args!("cannot delete the note {title:?}")))
    }

    /// Calls `onChange` when notes in the folder change, by the app or
    /// anything else (Claude, a sync client), a moment after the changes
    /// settle. Replaces the listener of an earlier call.
    pub fn watch(&mut self, on_change: Callback<()>, cx: CallCx<'_>) -> Result<(), JsError> {
        // The old watcher goes first: with it goes its sender, which ends
        // the old listener's task.
        self.watcher = None;
        let changes = relay(cx, move |()| on_change.post(()));
        let watcher = self
            .store
            .watch(move || {
                let _ = changes.send(());
            })
            .map_err(|e| store_error(e, "cannot watch the notes folder"))?;
        self.watcher = Some(watcher);
        Ok(())
    }

    /// Every to-do in every note: open ones first, by due time (those
    /// without one last), then by the note's last change.
    pub fn todos(&self) -> Result<Vec<Todo>, JsError> {
        let todos = self
            .store
            .todos()
            .map_err(|e| store_error(e, "cannot read the to-dos"))?;
        Ok(todos.into_iter().map(Todo::from).collect())
    }

    /// Checks (`done`) or unchecks the to-do at `line` of `note`, if that
    /// line's text is still `text` (else throws `ERR_JOT_CHANGED`):
    /// checking adds today's date, unchecking removes it.
    pub fn set_todo_done(
        &mut self,
        note: String,
        line: u32,
        text: String,
        done: bool,
    ) -> Result<NoteMeta, JsError> {
        let today = jiff::Zoned::now().date();
        let meta = self
            .store
            .set_todo_done(&note, line as usize, &text, done, today)
            .map_err(|e| {
                store_error(
                    e,
                    format_args!("cannot update the to-do at line {line} of {note:?}"),
                )
            })?;
        Ok(meta.into())
    }
}

impl Notes {
    /// The folder, for the reminders' thread.
    pub(crate) fn store(&self) -> &Store {
        &self.store
    }
}

/// Who created a note.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PropEnum)]
pub enum NoteSource {
    /// Written in the app or any editor.
    User,
    /// Created by Claude through the MCP server.
    Claude,
}

impl From<Source> for NoteSource {
    fn from(source: Source) -> Self {
        match source {
            Source::User => NoteSource::User,
            Source::Claude => NoteSource::Claude,
        }
    }
}

/// What a listing shows of a note.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct NoteMeta {
    /// The note's title: its file name without `.md`.
    pub title: String,
    /// When the file last changed, in milliseconds since the Unix epoch.
    pub modified: f64,
    /// Who created the note.
    pub source: NoteSource,
    /// The start of the body, on one line.
    pub preview: String,
}

impl From<jot_store::NoteMeta> for NoteMeta {
    fn from(meta: jot_store::NoteMeta) -> Self {
        let modified = match meta.modified.duration_since(UNIX_EPOCH) {
            Ok(since) => since.as_secs_f64() * 1000.0,
            Err(before) => -before.duration().as_secs_f64() * 1000.0,
        };
        NoteMeta {
            title: meta.title,
            modified: modified.floor(),
            source: meta.source.into(),
            preview: meta.preview,
        }
    }
}

/// A note with its body.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct Note {
    /// The note's metadata.
    pub meta: NoteMeta,
    /// The Markdown after the frontmatter.
    pub body: String,
}

impl From<jot_store::Note> for Note {
    fn from(note: jot_store::Note) -> Self {
        Note {
            meta: note.meta.into(),
            body: note.body,
        }
    }
}

/// A note that matches a search.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SearchHit {
    /// The note's metadata.
    pub meta: NoteMeta,
    /// The body around its first match, on one line, or the preview when
    /// only the title matches.
    pub snippet: String,
    /// Whether every word of the query is in the title.
    pub title_match: bool,
}

impl From<jot_store::SearchHit> for SearchHit {
    fn from(hit: jot_store::SearchHit) -> Self {
        SearchHit {
            meta: hit.meta.into(),
            snippet: hit.snippet,
            title_match: hit.title_match,
        }
    }
}

/// A Markdown task line (`- [ ] …`) in a note.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct Todo {
    /// The title of the note it is in.
    pub note: String,
    /// Its line in the note's body, from 0.
    pub line: u32,
    /// Its text, without the box, the reminder and the completion date.
    pub text: String,
    /// Whether it is checked.
    pub done: bool,
    /// When it is due, in local time (`"2026-11-14T09:00"`), or `null`.
    pub due: Option<String>,
    /// The day it was checked (`"2026-11-14"`), or `null`.
    pub done_on: Option<String>,
}

impl From<jot_store::Todo> for Todo {
    fn from(todo: jot_store::Todo) -> Self {
        Todo {
            note: todo.note,
            line: u32::try_from(todo.line).unwrap_or(u32::MAX),
            text: todo.text,
            done: todo.done,
            due: todo.due.map(format_due),
            done_on: todo.done_on.map(|date| date.to_string()),
        }
    }
}

/// A due time as TS gets it: `"2026-11-14T09:00"`.
pub(crate) fn format_due(due: jiff::civil::DateTime) -> String {
    due.strftime("%Y-%m-%dT%H:%M").to_string()
}

/// `dir` with a leading `~` replaced by the home folder.
fn expand_home(dir: &str) -> PathBuf {
    let home = || std::env::var_os("HOME").map(PathBuf::from);
    if dir == "~" {
        if let Some(home) = home() {
            return home;
        }
    } else if let Some(rest) = dir.strip_prefix("~/") {
        if let Some(home) = home() {
            return home.join(rest);
        }
    }
    PathBuf::from(dir)
}

/// A store failure as JS gets it: an `Error` whose message says what
/// failed and why, with a `code` the app can match.
pub(crate) fn store_error(error: StoreError, doing: impl Display) -> JsError {
    let (code, why) = match &error {
        StoreError::InvalidTitle => (
            Some("ERR_JOT_INVALID_TITLE"),
            "the title is empty, starts with \".\", or is too long".to_owned(),
        ),
        StoreError::NotFound => (
            Some("ERR_JOT_NOT_FOUND"),
            "no note has this title".to_owned(),
        ),
        StoreError::AlreadyExists => (
            Some("ERR_JOT_ALREADY_EXISTS"),
            "a note with this title already exists".to_owned(),
        ),
        StoreError::Changed => (
            Some("ERR_JOT_CHANGED"),
            "the line changed since it was read".to_owned(),
        ),
        StoreError::Io(io) => (io_code(io), io.to_string()),
    };
    let error = JsError::Error(format!("{doing}: {why}"));
    match code {
        Some(code) => error.with_code(code),
        None => error,
    }
}
