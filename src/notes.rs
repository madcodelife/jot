//! `Notes`: the notes folder as a class, wrapping `jot_store::Store`.

use std::fmt::Display;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use jot_store::{ActivityTail, Icon, Resolution, Source, Store, StoreError, Trashed, Watcher};
use nsh_core::element::io_code;
use nsh_core::prelude::*;

use crate::activity::{AgentActivity, resolved, same_folder};
use crate::relay::relay;

/// The notes folder: one Markdown file per note, the file name its title.
/// Every member runs at once and throws an `Error` when it fails, with a
/// `code`: `ERR_JOT_INVALID_TITLE`, `ERR_JOT_NOT_FOUND`,
/// `ERR_JOT_ALREADY_EXISTS`, `ERR_JOT_CHANGED` (a to-do line changed
/// since it was read), `ERR_JOT_NOT_DOWNLOADED` (the note's text is not on
/// this Mac yet: iCloud Drive is downloading it), or the file system's
/// (`EACCES`, `ENOSPC`, ...), or `ERR_JOT_LOCKED` (the note is locked:
/// nothing was changed). Nothing here waits for a download: a note not
/// downloaded is listed (`downloading`), asked for, and reported by `watch`
/// when it lands.
#[class]
pub struct Notes {
    store: Store,
    /// The folder watcher `watch` started; replaced by the next `watch`.
    watcher: Option<Watcher>,
    /// The activity log's watcher `watch_activity` started; replaced by the
    /// next `watch_activity`.
    activity: Option<Watcher>,
    /// The notes `trash` moved to the trash this run, by token, oldest
    /// first: what `restore` brings back.
    trashed: Vec<(u32, Trashed)>,
    /// The token of the next note trashed.
    next_token: u32,
}

/// How many trashed notes `restore` can still bring back: the oldest go
/// first (they stay in the system trash).
const TRASHED_KEPT: usize = 64;

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
            activity: None,
            trashed: Vec::new(),
            next_token: 1,
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

    /// Appends `text` to the note titled `title` after one blank line, or
    /// creates the note with it when there is none.
    pub fn append(&mut self, title: String, text: String) -> Result<NoteMeta, JsError> {
        let failed = |e| store_error(e, format_args!("cannot append to the note {title:?}"));
        // A note made in between (by Claude, a sync client) is appended to.
        for _ in 0..3 {
            match self.store.append(&title, &text) {
                Err(StoreError::NotFound) => {}
                done => return done.map(NoteMeta::from).map_err(failed),
            }
            let body = format!("{}\n", text.trim_end_matches(['\n', '\r']));
            match self.store.create(&title, &body, Source::User) {
                Err(StoreError::AlreadyExists) => continue,
                done => return done.map(NoteMeta::from).map_err(failed),
            }
        }
        Err(failed(StoreError::AlreadyExists))
    }

    /// Adds the to-do `- [ ] text` (with ` ⏰ due` when `due` is given,
    /// `"YYYY-MM-DDTHH:mm"` local time) at the end of the note titled
    /// `note`, `"待办"` when not given, creating the note as needed.
    /// Throws a `TypeError` for another form of `due`.
    pub fn add_todo(
        &mut self,
        text: String,
        due: Option<String>,
        note: Option<String>,
    ) -> Result<Todo, JsError> {
        let due = due
            .map(|due| {
                parse_due(&due).ok_or_else(|| {
                    JsError::Type(format!("due must be \"YYYY-MM-DDTHH:mm\", got {due:?}"))
                })
            })
            .transpose()?;
        let todo = self
            .store
            .add_todo(note.as_deref(), &text, due, Source::User)
            .map_err(|e| store_error(e, format_args!("cannot add the to-do {text:?}")))?;
        Ok(todo.into())
    }

    /// Renames the note `from` to `to`; throws `ERR_JOT_NOT_FOUND` or
    /// `ERR_JOT_ALREADY_EXISTS`.
    pub fn rename(&mut self, from: String, to: String) -> Result<NoteMeta, JsError> {
        let meta = self.store.rename(&from, &to).map_err(|e| {
            store_error(e, format_args!("cannot rename the note {from:?} to {to:?}"))
        })?;
        Ok(meta.into())
    }

    /// Points the links to the note once titled `from` (`[[from]]`,
    /// `[[from|words]]`, in any case) at `to`, its new title, in every
    /// note: after `rename`. Locked notes keep theirs, counted.
    pub fn rename_links(&mut self, from: String, to: String) -> Result<RenamedLinks, JsError> {
        let done = self.store.rename_links(&from, &to).map_err(|e| {
            store_error(
                e,
                format_args!("cannot point the links to {from:?} at {to:?}"),
            )
        })?;
        Ok(RenamedLinks {
            notes: done.notes as u32,
            links: done.links as u32,
            locked_notes: done.locked_notes as u32,
            locked_links: done.locked_links as u32,
        })
    }

    /// Deletes the note's file for good (`trash` moves it to the system
    /// trash, which can be undone).
    pub fn delete(&mut self, title: String) -> Result<(), JsError> {
        self.store
            .delete(&title)
            .map_err(|e| store_error(e, format_args!("cannot delete the note {title:?}")))
    }

    /// Moves the note titled `title` to the system trash; `restore` with
    /// the token it returns brings it back. Throws `ERR_JOT_NOT_FOUND`.
    pub fn trash(&mut self, title: String) -> Result<TrashedNote, JsError> {
        let trashed = self.store.trash(&title).map_err(|e| {
            store_error(
                e,
                format_args!("cannot move the note {title:?} to the trash"),
            )
        })?;
        let token = self.next_token;
        self.next_token = self.next_token.wrapping_add(1).max(1);
        let note = TrashedNote {
            title: trashed.title.clone(),
            token,
        };
        if self.trashed.len() == TRASHED_KEPT {
            self.trashed.remove(0);
        }
        self.trashed.push((token, trashed));
        Ok(note)
    }

    /// Brings back the note `trash` returned `token` for, where it was:
    /// moved out of the trash, or rebuilt from its text when the trash no
    /// longer has it. Throws `ERR_JOT_ALREADY_EXISTS` when a note has its
    /// title now (the token stays good), `ERR_JOT_NOT_FOUND` for a token
    /// this folder did not give or already restored.
    pub fn restore(&mut self, token: u32) -> Result<NoteMeta, JsError> {
        let Some(at) = self.trashed.iter().position(|(t, _)| *t == token) else {
            return Err(store_error(
                StoreError::NotFound,
                format_args!("cannot restore the trashed note {token}"),
            ));
        };
        let trashed = &self.trashed[at].1;
        let meta = self.store.restore(trashed).map_err(|e| {
            store_error(
                e,
                format_args!("cannot restore the note {:?}", trashed.title),
            )
        })?;
        self.trashed.remove(at);
        Ok(meta.into())
    }

    /// The path of the note titled `title` (case does not matter), or
    /// `null` when there is none: what the file manager shows.
    pub fn path(&self, title: String) -> Result<Option<String>, JsError> {
        let path = self
            .store
            .path(&title)
            .map_err(|e| store_error(e, format_args!("cannot find the note {title:?}")))?;
        Ok(path.map(|path| path.to_string_lossy().into_owned()))
    }

    /// The other versions of the note iCloud Drive kept when it changed on
    /// two devices at once, newest first; empty when there are none.
    /// Throws `ERR_JOT_NOT_FOUND`.
    pub fn conflicts(&self, title: String) -> Result<Vec<Conflict>, JsError> {
        let conflicts = self.store.conflicts(&title).map_err(|e| {
            store_error(
                e,
                format_args!("cannot read the versions of the note {title:?}"),
            )
        })?;
        Ok(conflicts.into_iter().map(Conflict::from).collect())
    }

    /// Settles the conflict version `id` of the note: `"mine"` keeps the
    /// note as it is, `"theirs"` makes the version the note, `"both"` keeps
    /// the note and makes the version a note of its own titled `copyTitle`
    /// (or `copyTitle 2`… when taken). Throws `ERR_JOT_CHANGED` when the
    /// version is settled already, `ERR_JOT_NOT_FOUND`,
    /// `ERR_JOT_NOT_DOWNLOADED`.
    pub fn resolve_conflict(
        &mut self,
        title: String,
        id: String,
        choice: ConflictChoice,
        copy_title: Option<String>,
    ) -> Result<ResolvedConflict, JsError> {
        let resolution = match choice {
            ConflictChoice::Mine => Resolution::KeepCurrent,
            ConflictChoice::Theirs => Resolution::UseOther,
            ConflictChoice::Both => Resolution::KeepBoth {
                title: copy_title.unwrap_or_else(|| format!("{title} 2")),
            },
        };
        let resolved = self.store.resolve(&title, &id, resolution).map_err(|e| {
            store_error(
                e,
                format_args!("cannot settle the versions of the note {title:?}"),
            )
        })?;
        Ok(ResolvedConflict {
            note: resolved.note.into(),
            copy: resolved.copy.map(NoteMeta::from),
        })
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

    /// Calls the listener for each write an AI app makes to this folder
    /// from now on, as `jot-mcp` records them in the activity log at `log`
    /// (`ActivityLog.path()`): the lines added to it, not those before; a
    /// rotated log is followed. Writes to other folders are left out (the
    /// folder compared with links resolved). Replaces the previous listener.
    pub fn watch_activity(
        &mut self,
        log: String,
        #[args(activity)] on_activity: Callback<AgentActivity>,
        cx: CallCx<'_>,
    ) -> Result<(), JsError> {
        self.activity = None;
        let log = expand_home(&log);
        let folder = resolved(self.store.root());
        let activity = relay(cx, move |activity: AgentActivity| {
            on_activity.post(activity)
        });
        let tail = std::sync::Mutex::new(ActivityTail::from_end(&log));
        let watcher = jot_store::watch_activity(&log, move || {
            let Ok(mut tail) = tail.lock() else {
                return;
            };
            for record in tail.read() {
                if same_folder(&record.dir, &folder) {
                    let _ = activity.send(record.into());
                }
            }
        })
        .map_err(|e| store_error(e, "cannot watch the AI apps' activity"))?;
        self.activity = Some(watcher);
        Ok(())
    }

    /// Locks the note: `locked: true` in its frontmatter and the file's
    /// locked flag (Finder's "Locked"), so nothing changes, moves or deletes
    /// it, Jot and AI apps included, until it is unlocked. Its modification
    /// time stays. Throws `ERR_JOT_NOT_FOUND`, `ERR_JOT_NOT_DOWNLOADED`.
    pub fn lock(&mut self, title: String) -> Result<NoteMeta, JsError> {
        let meta = self
            .store
            .lock(&title)
            .map_err(|e| store_error(e, format_args!("cannot lock the note {title:?}")))?;
        Ok(meta.into())
    }

    /// Unlocks the note: the flag cleared, `locked` out of its frontmatter.
    pub fn unlock(&mut self, title: String) -> Result<NoteMeta, JsError> {
        let meta = self
            .store
            .unlock(&title)
            .map_err(|e| store_error(e, format_args!("cannot unlock the note {title:?}")))?;
        Ok(meta.into())
    }

    /// Gives the note an emoji, shown before its title: `icon: "🍕"` in its
    /// frontmatter. Its modification time stays (no change of the note).
    /// Throws a `TypeError` when `icon` is not one emoji (surrounding
    /// spaces aside), `ERR_JOT_LOCKED`, `ERR_JOT_NOT_FOUND`,
    /// `ERR_JOT_NOT_DOWNLOADED`.
    pub fn set_icon(&mut self, title: String, icon: String) -> Result<NoteMeta, JsError> {
        let parsed = Icon::parse(&icon)
            .ok_or_else(|| JsError::Type(format!("icon must be one emoji, got {icon:?}")))?;
        let meta = self
            .store
            .set_icon(&title, &parsed)
            .map_err(|e| store_error(e, format_args!("cannot set the emoji of {title:?}")))?;
        Ok(meta.into())
    }

    /// Takes the note's emoji away (its modification time stays); a note
    /// without one stays as it is.
    pub fn clear_icon(&mut self, title: String) -> Result<NoteMeta, JsError> {
        let meta = self
            .store
            .clear_icon(&title)
            .map_err(|e| store_error(e, format_args!("cannot remove the emoji of {title:?}")))?;
        Ok(meta.into())
    }

    /// Brings each note's two marks of a lock in line: the flag back on a
    /// note whose frontmatter says locked (synced from another Mac, or
    /// cleared by iCloud Drive as it uploaded the note), `locked: true` on a
    /// note locked in Finder. Returns the titles it changed. The app calls it
    /// as the folder changes.
    pub fn settle_locks(&mut self) -> Result<Vec<String>, JsError> {
        self.store
            .settle_locks()
            .map_err(|e| store_error(e, "cannot settle the locked notes"))
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
        let today = jiff::ZonedDateTime::now().date();
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

    /// Sets the reminder time of the to-do at `line` of `note` to `due`
    /// (`"YYYY-MM-DDTHH:mm"` local time), or removes it for `null`, if
    /// that line's text is still `text` (else throws `ERR_JOT_CHANGED`).
    /// Throws a `TypeError` for another form of `due`.
    pub fn set_todo_due(
        &mut self,
        note: String,
        line: u32,
        text: String,
        due: Option<String>,
    ) -> Result<NoteMeta, JsError> {
        let due = due
            .map(|due| {
                parse_due(&due).ok_or_else(|| {
                    JsError::Type(format!("due must be \"YYYY-MM-DDTHH:mm\", got {due:?}"))
                })
            })
            .transpose()?;
        let meta = self
            .store
            .set_todo_due(&note, line as usize, &text, due)
            .map_err(|e| {
                store_error(
                    e,
                    format_args!("cannot change the reminder at line {line} of {note:?}"),
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

/// What a listing shows of a note.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct NoteMeta {
    /// The note's title: its file name without `.md`.
    pub title: String,
    /// When the file last changed, in milliseconds since the Unix epoch.
    pub modified: f64,
    /// Who created the note: `null` for the user, else the AI app's name to show (`"Claude"`, `"Cursor"`,
    /// `"VS Code"`, or the name an unknown app gave itself).
    pub source: Option<String>,
    /// The start of the body, on one line.
    pub preview: String,
    /// Its text is not on this Mac yet (iCloud Drive moved it off): it is
    /// being downloaded, and `watch` reports it when it lands. Till then its
    /// `preview` is empty, `source` null, and it cannot be changed
    /// (`ERR_JOT_NOT_DOWNLOADED`).
    pub downloading: bool,
    /// The note is locked (in Jot or in Finder): read-only until it is
    /// unlocked; every change throws `ERR_JOT_LOCKED`.
    pub locked: bool,
    /// The emoji shown before its title (`"🍕"`), or `null`.
    pub icon: Option<String>,
}

/// A time as TS gets it: milliseconds since the Unix epoch.
fn millis(time: std::time::SystemTime) -> f64 {
    let millis = match time.duration_since(UNIX_EPOCH) {
        Ok(since) => since.as_secs_f64() * 1000.0,
        Err(before) => -before.duration().as_secs_f64() * 1000.0,
    };
    millis.floor()
}

impl From<jot_store::NoteMeta> for NoteMeta {
    fn from(meta: jot_store::NoteMeta) -> Self {
        NoteMeta {
            title: meta.title,
            modified: millis(meta.modified),
            source: meta.source.label(),
            preview: meta.preview,
            downloading: meta.downloading,
            locked: meta.locked,
            icon: meta.icon,
        }
    }
}

/// Another version of a note, kept by iCloud Drive when the note changed on
/// two devices at once.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct Conflict {
    /// What `Notes.resolveConflict` takes.
    pub id: String,
    /// The device it was saved on ("Floyd’s iPhone"), or `null`.
    pub device: Option<String>,
    /// When it was saved, in milliseconds since the Unix epoch.
    pub modified: f64,
    /// Its Markdown after the frontmatter.
    pub body: String,
}

impl From<jot_store::Conflict> for Conflict {
    fn from(conflict: jot_store::Conflict) -> Self {
        Conflict {
            id: conflict.id,
            device: conflict.device,
            modified: millis(conflict.modified),
            body: conflict.body,
        }
    }
}

/// Which version of a note in conflict to keep.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PropEnum)]
pub enum ConflictChoice {
    /// The note as it is on this Mac.
    Mine,
    /// The other device's version.
    Theirs,
    /// Both: the other version becomes a note of its own.
    Both,
}

/// What `Notes.resolveConflict` did.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ResolvedConflict {
    /// The note.
    pub note: NoteMeta,
    /// The other version's own note, for `"both"`.
    pub copy: Option<NoteMeta>,
}

/// What `Notes.renameLinks` changed, and what it left.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct RenamedLinks {
    /// The notes rewritten.
    pub notes: u32,
    /// The links that took the new title.
    pub links: u32,
    /// The locked notes that kept links to the old title.
    pub locked_notes: u32,
    /// The links in them, which kept the old title.
    pub locked_links: u32,
}

/// A note `Notes.trash` moved to the system trash.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct TrashedNote {
    /// The note's title.
    pub title: String,
    /// What `Notes.restore` takes to bring it back.
    pub token: u32,
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

/// A due time as TS gives it, `"2026-11-14T09:00"` (what [`format_due`]
/// writes), or `None` for any other form.
pub(crate) fn parse_due(due: &str) -> Option<jiff::civil::DateTime> {
    let (date, time) = due.split_once('T')?;
    let (hour, minute) = time.split_once(':')?;
    let mut parts = date.split('-');
    let (year, month, day) = (parts.next()?, parts.next()?, parts.next()?);
    let fields = [(year, 4), (month, 2), (day, 2), (hour, 2), (minute, 2)];
    if parts.next().is_some()
        || fields
            .iter()
            .any(|(field, len)| field.len() != *len || !field.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    jiff::civil::DateTime::new(
        year.parse().ok()?,
        month.parse().ok()?,
        day.parse().ok()?,
        hour.parse().ok()?,
        minute.parse().ok()?,
        0,
        0,
    )
    .ok()
}

/// `dir` with a leading `~` replaced by the home folder.
pub(crate) fn expand_home(dir: &str) -> PathBuf {
    let home = || std::env::var_os("HOME").map(PathBuf::from);
    if dir == "~" {
        if let Some(home) = home() {
            return home;
        }
    } else if let Some(rest) = dir.strip_prefix("~/")
        && let Some(home) = home()
    {
        return home.join(rest);
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
            "it changed since it was read".to_owned(),
        ),
        StoreError::NotDownloaded => (
            Some("ERR_JOT_NOT_DOWNLOADED"),
            "it is not downloaded to this Mac yet (iCloud Drive is downloading it)".to_owned(),
        ),
        StoreError::Locked => (
            Some("ERR_JOT_LOCKED"),
            "it is locked (unlock it first)".to_owned(),
        ),
        StoreError::Io(io) => (io_code(io), io.to_string()),
    };
    let error = JsError::Error(format!("{doing}: {why}"));
    match code {
        Some(code) => error.with_code(code),
        None => error,
    }
}

#[cfg(test)]
mod tests {
    use super::{Notes, format_due, parse_due};

    #[test]
    fn due_times() {
        let due = parse_due("2026-11-14T09:00").unwrap();
        assert_eq!(due, jiff::civil::date(2026, 11, 14).at(9, 0, 0, 0));
        assert_eq!(format_due(due), "2026-11-14T09:00");
        assert_eq!(
            parse_due("2026-02-28T23:59"),
            Some(jiff::civil::date(2026, 2, 28).at(23, 59, 0, 0))
        );
        for wrong in [
            "",
            "2026-11-14",
            "2026-11-14 09:00",
            "2026-11-14T9:00",
            "2026-11-14T09:00:00",
            "2026-11-14T24:00",
            "2026-02-30T09:00",
            "26-11-14T09:00",
            "2026-11-14T09:0a",
            "+026-11-14T09:00",
            "明天 9点",
        ] {
            assert_eq!(parse_due(wrong), None, "{wrong:?}");
        }
    }

    /// The tokens `trash` gives bring each note back once; the real trash
    /// is used, and the test takes back what it put there.
    #[cfg(target_os = "macos")]
    #[test]
    fn trashed_notes_come_back_by_token() {
        let dir = std::env::temp_dir().join(format!(
            "jot-notes-trash-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut notes = Notes::new(dir.to_string_lossy().into_owned()).unwrap();
        notes.create("One".into(), "1".into()).unwrap();
        notes.create("Two".into(), "2".into()).unwrap();
        assert!(
            notes
                .path("one".into())
                .unwrap()
                .unwrap()
                .ends_with("One.md")
        );

        let one = notes.trash("one".into()).unwrap();
        let two = notes.trash("Two".into()).unwrap();
        assert_eq!(one.title, "One");
        assert_ne!(one.token, two.token);
        assert!(notes.list().unwrap().is_empty());
        assert_eq!(notes.path("One".into()).unwrap(), None);

        // Two first, as an undo stack takes them back.
        assert_eq!(notes.restore(two.token).unwrap().title, "Two");
        assert!(notes.restore(two.token).is_err(), "restored once");
        assert!(notes.restore(9999).is_err(), "never given");

        // A note that took the title: the token stays good.
        notes.create("One".into(), "new".into()).unwrap();
        assert!(notes.restore(one.token).is_err());
        notes.delete("One".into()).unwrap();
        assert_eq!(notes.restore(one.token).unwrap().title, "One");
        assert_eq!(notes.read("One".into()).unwrap().unwrap().body, "1");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
