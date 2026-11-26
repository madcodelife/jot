//! Jot's notes folder.
//!
//! A note is one `.md` file directly in the folder; its title is the file stem. A note may start with YAML
//! frontmatter between `---` lines: Jot reads `source` (who created the note) from it and keeps everything else untouched.
//! Every write goes to a temporary file in the same folder that is then renamed over the note, so readers
//! (the app, the MCP server, sync clients) never see half a file.
//!
//! The folder may be synced (iCloud Drive): a note whose text is not on this Mac yet is listed all the same,
//! marked `downloading`, and asked for; nothing here waits for a download. See `cloud`.

use std::cmp::Reverse;
use std::fmt;
use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use notify_debouncer_mini::notify::{self, RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, DebouncedEventBatch, Debouncer, new_debouncer};

mod activity;
mod cloud;
mod conflict;
mod lock;
mod moving;
mod settings;
mod source;
mod todo;
mod trash;
pub mod when;

pub use activity::{Action, Activity, ActivityTail, ROTATE_AT, watch_activity};
pub use conflict::{Conflict, Resolution, Resolved};
pub use jiff::civil::DateTime;
pub use moving::Moved;
pub use settings::AiSettings;
pub use source::Source;
pub use todo::{DEFAULT_TODO_NOTE, Todo};
pub use trash::{Replaced, Trashed};

/// How many characters of a note's body `NoteMeta::preview` and `SearchHit::snippet` hold.
const PREVIEW_CHARS: usize = 120;
/// How many characters of context a snippet shows before the match.
const SNIPPET_LEAD_CHARS: usize = 40;
/// The longest file name most file systems accept, in bytes.
const MAX_FILE_NAME_BYTES: usize = 255;
const EXTENSION: &str = "md";
const DEBOUNCE: Duration = Duration::from_millis(150);

/// A notes folder.
#[derive(Debug, Clone)]
pub struct Store {
    root: PathBuf,
    /// How the folder is synced: what is downloaded, and the versions kept in a conflict.
    cloud: Arc<dyn cloud::Cloud>,
    /// Where trashed notes go: the system trash, or a folder in tests.
    bin: Arc<dyn trash::Bin>,
}

impl PartialEq for Store {
    fn eq(&self, other: &Self) -> bool {
        self.root == other.root
    }
}

impl Eq for Store {}

/// What a listing shows of a note.
#[derive(Debug, Clone, PartialEq)]
pub struct NoteMeta {
    /// The file stem.
    pub title: String,
    /// The file's modification time.
    pub modified: SystemTime,
    /// Who created the note.
    pub source: Source,
    /// The first ~120 characters of the body, on one line.
    pub preview: String,
    /// Its text is not on this Mac yet (a synced folder moved it off): the system was asked for it, and the folder's
    /// watcher reports it when it lands. Till then `preview` is empty, `source` is the user and the body is empty.
    pub downloading: bool,
    /// The note is locked (the file's locked flag, or `locked: true` in its frontmatter): nothing changes it until
    /// it is unlocked (`StoreError::Locked`). See `lock`.
    pub locked: bool,
}

/// A note with its body.
#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    /// The note's metadata.
    pub meta: NoteMeta,
    /// The text after the frontmatter.
    pub body: String,
}

/// A note that matches a search.
#[derive(Debug, Clone, PartialEq)]
pub struct SearchHit {
    /// The note's metadata.
    pub meta: NoteMeta,
    /// ~120 characters of the body around its first match, on one line, or the preview when only the title
    /// matches.
    pub snippet: String,
    /// Whether every term of the query is in the title.
    pub title_match: bool,
}

/// Why a store operation failed.
#[derive(Debug)]
pub enum StoreError {
    /// The title is empty, starts with `.`, or is too long for a file name.
    InvalidTitle,
    /// No note has this title.
    NotFound,
    /// A note with this title (compared case-insensitively) already exists.
    AlreadyExists,
    /// The line a to-do was at no longer holds that to-do: the note changed since it was read.
    Changed,
    /// The note's text is not on this Mac yet (a synced folder moved it off); it is being downloaded. Nothing was
    /// changed: try again once it is here.
    NotDownloaded,
    /// The note is locked: it was left as it is. It has to be unlocked (in Jot) first.
    Locked,
    /// The file system failed.
    Io(io::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::InvalidTitle => f.write_str("invalid note title"),
            StoreError::NotFound => f.write_str("note not found"),
            StoreError::AlreadyExists => f.write_str("a note with this title already exists"),
            StoreError::Changed => f.write_str("the note changed since it was read"),
            StoreError::NotDownloaded => {
                f.write_str("the note is not downloaded to this Mac yet; it is being downloaded")
            }
            StoreError::Locked => f.write_str("the note is locked"),
            StoreError::Io(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StoreError::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for StoreError {
    fn from(error: io::Error) -> Self {
        StoreError::Io(error)
    }
}

impl From<notify::Error> for StoreError {
    fn from(error: notify::Error) -> Self {
        match error.kind {
            notify::ErrorKind::Io(error) => StoreError::Io(error),
            _ => StoreError::Io(io::Error::other(error)),
        }
    }
}

/// Watches a notes folder; dropping it stops watching.
pub struct Watcher {
    _debouncer: Debouncer<RecommendedWatcher>,
}

impl fmt::Debug for Watcher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Watcher").finish_non_exhaustive()
    }
}

/// A note file found in the folder.
struct Entry {
    title: String,
    /// Where its file is (or, for a placeholder, will be once downloaded).
    path: PathBuf,
    /// An older iCloud Drive's hidden placeholder (`.Title.md.icloud`), standing for a file not downloaded yet.
    placeholder: Option<PathBuf>,
}

impl Entry {
    fn new(title: String, path: PathBuf) -> Entry {
        Entry {
            title,
            path,
            placeholder: None,
        }
    }

    /// The file that is in the folder: the note's, or its placeholder.
    fn file(&self) -> &Path {
        self.placeholder.as_deref().unwrap_or(&self.path)
    }
}

impl Store {
    /// Opens the folder, creating it if missing.
    pub fn open(root: impl Into<PathBuf>) -> Result<Store, StoreError> {
        Store::with_cloud(root.into(), cloud::system())
    }

    fn with_cloud(root: PathBuf, cloud: Arc<dyn cloud::Cloud>) -> Result<Store, StoreError> {
        fs::create_dir_all(&root)?;
        Ok(Store {
            root,
            cloud,
            bin: Arc::new(trash::SystemBin),
        })
    }

    /// The notes folder.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Every note, most recently modified first.
    pub fn list(&self) -> Result<Vec<NoteMeta>, StoreError> {
        let mut notes = Vec::new();
        for entry in self.entries()? {
            match self.load(&entry) {
                Ok((meta, _)) => notes.push(meta),
                // Deleted between the listing and the read.
                Err(StoreError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        notes.sort_by(|a, b| {
            b.modified
                .cmp(&a.modified)
                .then_with(|| a.title.cmp(&b.title))
        });
        Ok(notes)
    }

    /// Case-insensitive match of every whitespace-separated term in the title or body.
    ///
    /// Title matches (every term in the title) rank first, then by `modified`, newest first. An empty query
    /// is `list()` truncated.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, StoreError> {
        let terms: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        if terms.is_empty() {
            let mut notes = self.list()?;
            notes.truncate(limit);
            return Ok(notes
                .into_iter()
                .map(|meta| SearchHit {
                    snippet: meta.preview.clone(),
                    meta,
                    title_match: false,
                })
                .collect());
        }

        let mut hits = Vec::new();
        for entry in self.entries()? {
            let (meta, body) = match self.load(&entry) {
                Ok(note) => note,
                Err(StoreError::Io(error)) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            let title = meta.title.to_lowercase();
            let lowered = Lowered::new(&body);
            if !terms
                .iter()
                .all(|term| title.contains(term.as_str()) || lowered.text.contains(term.as_str()))
            {
                continue;
            }
            let title_match = terms.iter().all(|term| title.contains(term.as_str()));
            let snippet = match terms.iter().filter_map(|term| lowered.find(term)).min() {
                Some(at) => snippet_at(&body, at),
                None => meta.preview.clone(),
            };
            hits.push(SearchHit {
                meta,
                snippet,
                title_match,
            });
        }
        hits.sort_by(|a, b| {
            (!a.title_match, Reverse(a.meta.modified), &a.meta.title).cmp(&(
                !b.title_match,
                Reverse(b.meta.modified),
                &b.meta.title,
            ))
        });
        hits.truncate(limit);
        Ok(hits)
    }

    /// The note with this title (compared case-insensitively), if any.
    pub fn read(&self, title: &str) -> Result<Option<Note>, StoreError> {
        let Some(entry) = self.find(&clean_title(title)?)? else {
            return Ok(None);
        };
        match self.load(&entry) {
            Ok((meta, body)) => Ok(Some(Note { meta, body })),
            Err(StoreError::Io(error)) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Creates a note. Fails with `AlreadyExists` if the title exists.
    pub fn create(&self, title: &str, body: &str, source: Source) -> Result<NoteMeta, StoreError> {
        let title = clean_title(title)?;
        if self.find(&title)?.is_some() {
            return Err(StoreError::AlreadyExists);
        }
        let header = source.header();
        let path = self.path_for(&title);
        self.write_file(&path, &compose(&header, body), None)?;
        let (meta, _) = self.load(&Entry::new(title, path))?;
        Ok(meta)
    }

    /// Replaces the body, keeping the frontmatter; creates the note as `Source::User` if missing. The app's
    /// editor saves with it. Fails with `Locked` for a locked note (as every write does).
    pub fn write(&self, title: &str, body: &str) -> Result<NoteMeta, StoreError> {
        let title = clean_title(title)?;
        let Some(entry) = self.find(&title)? else {
            return self.create(&title, body, Source::User);
        };
        self.rewrite(entry, |_| body.to_owned())
    }

    /// Appends `text` after one blank line. Fails with `NotFound`.
    pub fn append(&self, title: &str, text: &str) -> Result<NoteMeta, StoreError> {
        let entry = self
            .find(&clean_title(title)?)?
            .ok_or(StoreError::NotFound)?;
        self.rewrite(entry, |body| {
            let kept = body.trim_end_matches(['\n', '\r']);
            let added = text.trim_end_matches(['\n', '\r']);
            if kept.trim().is_empty() {
                format!("{added}\n")
            } else {
                format!("{kept}\n\n{added}\n")
            }
        })
    }

    /// Renames a note. Fails with `NotFound` / `AlreadyExists`; changing only the case of a title is allowed.
    pub fn rename(&self, from: &str, to: &str) -> Result<NoteMeta, StoreError> {
        let source = self
            .find(&clean_title(from)?)?
            .ok_or(StoreError::NotFound)?;
        let to = clean_title(to)?;
        if let Some(existing) = self.find(&to)?
            && existing.path != source.path
        {
            return Err(StoreError::AlreadyExists);
        }
        self.ensure_unlocked(&source, None)?;
        if source.placeholder.is_some() {
            self.cloud.download(&source.path);
            return Err(StoreError::NotDownloaded);
        }
        let path = self.path_for(&to);
        if path != source.path {
            fs::rename(&source.path, &path)?;
        }
        let (meta, _) = self.load(&Entry::new(to, path))?;
        Ok(meta)
    }

    /// Deletes the note's file for good (`trash` moves it to the system trash instead). Only the app calls it.
    pub fn delete(&self, title: &str) -> Result<(), StoreError> {
        let entry = self
            .find(&clean_title(title)?)?
            .ok_or(StoreError::NotFound)?;
        self.ensure_unlocked(&entry, None)?;
        fs::remove_file(entry.file())?;
        Ok(())
    }

    /// Calls `on_change` (debounced ~150 ms) when `.md` files in the folder change. Dropping the `Watcher`
    /// stops it.
    pub fn watch(&self, on_change: impl Fn() + Send + 'static) -> Result<Watcher, StoreError> {
        let mut debouncer =
            new_debouncer(DEBOUNCE, move |result: DebounceEventResult| match result {
                Ok(DebouncedEventBatch::Events(events)) => {
                    // A placeholder coming or going is a note leaving the Mac or arriving.
                    if events.iter().any(|event| {
                        is_note_path(&event.path) || cloud::placeholder_title(&event.path).is_some()
                    }) {
                        on_change();
                    }
                }
                // The watcher missed events (`Rescan`, or one it may add) or failed: let the caller look again.
                Ok(_) | Err(_) => on_change(),
            })?;
        debouncer
            .watcher()
            .watch(&self.root, RecursiveMode::NonRecursive)?;
        Ok(Watcher {
            _debouncer: debouncer,
        })
    }

    /// Every note file in the folder.
    fn entries(&self) -> Result<Vec<Entry>, StoreError> {
        Ok(retry(|| self.entries_once())?)
    }

    fn entries_once(&self) -> io::Result<Vec<Entry>> {
        let mut entries = Vec::new();
        let mut placeholders = Vec::new();
        for dir_entry in fs::read_dir(&self.root)? {
            let dir_entry = dir_entry?;
            let path = dir_entry.path();
            if let Some(title) = cloud::placeholder_title(&path) {
                placeholders.push(Entry {
                    path: self.path_for(title),
                    title: title.to_owned(),
                    placeholder: Some(path),
                });
                continue;
            }
            if !is_note_path(&path) {
                continue;
            }
            // `fs::metadata` follows symlinks, so a linked note counts.
            match fs::metadata(&path) {
                Ok(metadata) if metadata.is_file() => {}
                Err(error) if error.kind() == io::ErrorKind::Interrupted => return Err(error),
                _ => continue,
            }
            let Some(title) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            entries.push(Entry::new(title.to_owned(), path));
        }
        // A placeholder whose file is here too is on its way out (downloaded, or just being moved off).
        for placeholder in placeholders {
            if !entries.iter().any(|entry| entry.title == placeholder.title) {
                entries.push(placeholder);
            }
        }
        Ok(entries)
    }

    /// The note whose title equals `title` exactly, or else case-insensitively.
    fn find(&self, title: &str) -> Result<Option<Entry>, StoreError> {
        let lowered = title.to_lowercase();
        let mut folded = None;
        for entry in self.entries()? {
            if entry.title == title {
                return Ok(Some(entry));
            }
            if folded.is_none() && entry.title.to_lowercase() == lowered {
                folded = Some(entry);
            }
        }
        Ok(folded)
    }

    fn path_for(&self, title: &str) -> PathBuf {
        self.root.join(format!("{title}.{EXTENSION}"))
    }

    /// Rewrites a note's body with `edit`, keeping its frontmatter.
    fn rewrite(
        &self,
        entry: Entry,
        edit: impl FnOnce(&str) -> String,
    ) -> Result<NoteMeta, StoreError> {
        self.try_rewrite(entry, |body| Ok(Some(edit(body))))
    }

    /// Rewrites a note's body with `edit`, keeping its frontmatter; leaves the file untouched when `edit`
    /// returns `None` or fails, or the note is locked (`Locked`).
    fn try_rewrite(
        &self,
        entry: Entry,
        edit: impl FnOnce(&str) -> Result<Option<String>, StoreError>,
    ) -> Result<NoteMeta, StoreError> {
        let content = self.text(&entry).map_err(|error| match error {
            StoreError::Io(error) if error.kind() == io::ErrorKind::NotFound => {
                StoreError::NotFound
            }
            error => error,
        })?;
        self.ensure_unlocked(&entry, Some(&content))?;
        let parts = split(&content);
        let Some(body) = edit(parts.body)? else {
            let (meta, _) = self.load(&entry)?;
            return Ok(meta);
        };
        let permissions = retry(|| fs::metadata(&entry.path))?.permissions();
        self.write_file(
            &entry.path,
            &compose(parts.header, &body),
            Some(permissions),
        )?;
        let (meta, _) = self.load(&entry)?;
        Ok(meta)
    }

    /// The note file's whole text; `NotDownloaded` (the download asked for) when it is not on this Mac.
    fn text(&self, entry: &Entry) -> Result<String, StoreError> {
        if entry.placeholder.is_none()
            && let Some(content) = retry(|| self.cloud.read(&entry.path))?
        {
            return Ok(content);
        }
        self.cloud.download(&entry.path);
        Err(StoreError::NotDownloaded)
    }

    /// Reads a note file into its metadata and body. A note not on this Mac comes back `downloading`, its body
    /// empty, and is asked for.
    fn load(&self, entry: &Entry) -> Result<(NoteMeta, String), StoreError> {
        let metadata = retry(|| fs::metadata(entry.file()))?;
        let modified = metadata.modified()?;
        let content =
            if entry.placeholder.is_some() || self.cloud.is_dataless(&entry.path, &metadata) {
                None
            } else {
                retry(|| self.cloud.read(&entry.path))?
            };
        let Some(content) = content else {
            self.cloud.download(&entry.path);
            let meta = NoteMeta {
                title: entry.title.clone(),
                modified,
                source: Source::User,
                preview: String::new(),
                downloading: true,
                locked: lock::is_locked(&metadata, None),
            };
            return Ok((meta, String::new()));
        };
        let parts = split(&content);
        let source = parts
            .frontmatter
            .map(Source::of_frontmatter)
            .unwrap_or_default();
        let meta = NoteMeta {
            title: entry.title.clone(),
            modified,
            source,
            preview: one_line(parts.body, PREVIEW_CHARS),
            downloading: false,
            locked: lock::is_locked(&metadata, Some(&content)),
        };
        Ok((meta, parts.body.to_owned()))
    }

    /// Writes `content` to a temporary file in the folder and renames it to `path`. Without `permissions`
    /// (a new note), fails with `AlreadyExists` instead of replacing a file at `path`.
    fn write_file(
        &self,
        path: &Path,
        content: &str,
        permissions: Option<fs::Permissions>,
    ) -> Result<(), StoreError> {
        let mut builder = tempfile::Builder::new();
        builder.prefix(".jot-").suffix(".tmp");
        #[cfg(unix)]
        let new_file_permissions = {
            use std::os::unix::fs::PermissionsExt as _;
            fs::Permissions::from_mode(0o644)
        };
        #[cfg(unix)]
        builder.permissions(permissions.clone().unwrap_or(new_file_permissions));
        let mut file = builder.tempfile_in(&self.root)?;
        file.write_all(content.as_bytes())?;
        file.as_file().sync_all()?;
        if permissions.is_some() {
            file.persist(path).map_err(|error| error.error)?;
        } else {
            file.persist_noclobber(path).map_err(|error| {
                if error.error.kind() == io::ErrorKind::AlreadyExists {
                    StoreError::AlreadyExists
                } else {
                    StoreError::Io(error.error)
                }
            })?;
        }
        Ok(())
    }

    /// Writes `content` over the file at `path` through a temporary file, with these permissions and this
    /// modification time (set before the rename, so the note never shows another).
    fn write_file_at(
        &self,
        path: &Path,
        content: &str,
        permissions: fs::Permissions,
        modified: SystemTime,
    ) -> Result<(), StoreError> {
        let mut builder = tempfile::Builder::new();
        builder.prefix(".jot-").suffix(".tmp");
        #[cfg(unix)]
        builder.permissions(permissions);
        let mut file = builder.tempfile_in(&self.root)?;
        file.write_all(content.as_bytes())?;
        file.as_file().sync_all()?;
        file.as_file().set_modified(modified)?;
        file.persist(path).map_err(|error| error.error)?;
        Ok(())
    }
}

/// Trims a title and replaces the characters a file name cannot hold; rejects what cannot be a note's name.
fn clean_title(title: &str) -> Result<String, StoreError> {
    let cleaned: String = title
        .trim()
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':') || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    // `.` and `..` start with a dot too.
    if cleaned.is_empty()
        || cleaned.starts_with('.')
        || cleaned.len() + EXTENSION.len() + 1 > MAX_FILE_NAME_BYTES
    {
        return Err(StoreError::InvalidTitle);
    }
    Ok(cleaned)
}

/// Whether a path names a note: a `.md` file that is not hidden.
fn is_note_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    !name.starts_with('.')
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case(EXTENSION))
}

/// Runs `call` again while a signal interrupts it (`EINTR`): the system frameworks a desktop app loads (audio,
/// speech, input monitoring) deliver signals to its threads, and `stat` and directory reads are not restarted.
fn retry<T>(mut call: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let mut attempts = 0;
    loop {
        match call() {
            Err(error) if error.kind() == io::ErrorKind::Interrupted && attempts < 16 => {
                attempts += 1
            }
            result => return result,
        }
    }
}

/// A note file's text split at the frontmatter.
struct Parts<'a> {
    /// The frontmatter with its `---` lines, exactly as written, or empty.
    header: &'a str,
    /// The lines between the `---` lines.
    frontmatter: Option<&'a str>,
    body: &'a str,
}

fn split(content: &str) -> Parts<'_> {
    let none = Parts {
        header: "",
        frontmatter: None,
        body: content,
    };
    let Some(first) = content.split_inclusive('\n').next() else {
        return none;
    };
    if first.trim_end_matches(['\n', '\r']) != "---" || !first.ends_with('\n') {
        return none;
    }
    let start = first.len();
    let mut offset = start;
    for line in content[start..].split_inclusive('\n') {
        if line.trim_end_matches(['\n', '\r']) == "---" {
            let end = offset + line.len();
            return Parts {
                header: &content[..end],
                frontmatter: Some(&content[start..offset]),
                body: &content[end..],
            };
        }
        offset += line.len();
    }
    none
}

fn compose(header: &str, body: &str) -> String {
    let mut content = String::with_capacity(header.len() + body.len() + 1);
    content.push_str(header);
    // A closing `---` at the very end of a file has no newline yet.
    if !header.is_empty() && !header.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(body);
    content
}

/// Collapses whitespace and keeps the first `max` characters, ending with `…` when cut.
fn one_line(text: &str, max: usize) -> String {
    let mut line = String::new();
    let mut count = 0;
    for word in text.split_whitespace() {
        let separator = usize::from(count > 0);
        let length = word.chars().count();
        if count + separator + length > max {
            if count == 0 {
                // One word longer than the line: cut inside it.
                line.extend(word.chars().take(max));
            }
            line.push('…');
            return line;
        }
        if separator == 1 {
            line.push(' ');
        }
        line.push_str(word);
        count += separator + length;
    }
    line
}

/// One line of `body` around the byte offset `at`.
fn snippet_at(body: &str, at: usize) -> String {
    let lead_start = body[..at]
        .char_indices()
        .rev()
        .nth(SNIPPET_LEAD_CHARS - 1)
        .map_or(0, |(index, _)| index);
    // Start at a word when the lead cuts into one.
    let start = if lead_start == 0 {
        0
    } else {
        body[lead_start..at]
            .find(char::is_whitespace)
            .map_or(lead_start, |space| lead_start + space)
    };
    let line = one_line(&body[start..], PREVIEW_CHARS);
    if start == 0 {
        line
    } else {
        format!("…{line}")
    }
}

/// A text lowercased, with the way back to the original's byte offsets.
struct Lowered {
    text: String,
    /// For each byte of `text`, the byte offset of the character it came from.
    origin: Vec<usize>,
}

impl Lowered {
    fn new(text: &str) -> Lowered {
        let mut lowered = String::with_capacity(text.len());
        let mut origin = Vec::with_capacity(text.len());
        for (index, c) in text.char_indices() {
            for lower in c.to_lowercase() {
                lowered.push(lower);
                origin.resize(lowered.len(), index);
            }
        }
        Lowered {
            text: lowered,
            origin,
        }
    }

    /// The byte offset in the original text of the first match of a lowercase term.
    fn find(&self, term: &str) -> Option<usize> {
        self.text.find(term).map(|at| self.origin[at])
    }
}

#[cfg(test)]
mod cloud_tests;
#[cfg(test)]
mod lock_tests;
#[cfg(test)]
mod tests;
