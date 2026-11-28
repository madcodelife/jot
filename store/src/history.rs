//! A note's version history: its earlier texts, kept on this Mac outside the notes folder, so a bad edit (the
//! user's, an AI app's, another device's) can be taken back later.
//!
//! The history sits beside the AI apps' setting and their activity log
//! (`~/Library/Application Support/Jot/history` on macOS), one folder per notes folder (its path, links resolved,
//! hashed: another notes folder has a history of its own) and in it one folder per note (its title in lowercase,
//! hashed: titles compare case-insensitively). A version is one file, `<when it was saved, ms since 1970>.md`, the
//! note's whole file as it was (frontmatter included), with the file's modification time the note had then. It is
//! local: nothing of it is synced.
//!
//! When: before a write that changes the text of a note that exists ([`Store::write`], `append`, the to-do edits),
//! its text as it is goes to its history if the newest version there was saved more than [`QUIET`] ago, so a
//! session of typing keeps the text from before it. A whole-note rewrite ([`Store::replace`]), taking another
//! device's version in a conflict, and a restore ([`Store::restore_version`]) always save the text first. Versions
//! saved more than [`KEPT_FOR`] ago go, and a note keeps at most [`KEPT`] (the oldest go first): the note's own
//! history is pruned as a version is saved, the whole folder's at most once a day, so a trashed note's history stays
//! until it ages out. A history that cannot be written never stops or fails a note's write: it is reported on
//! stderr and the write goes on (a rewrite and a restore excepted, which stop rather than lose the text).
//!
//! The history is off until [`Store::with_history_folder`] names its folder: the app and `jot-mcp` name the user's
//! ([`Store::default_history_folder`]), tests a folder of their own.

use std::fmt;
use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::{
    AiSettings, EXTENSION, Entry, NoteMeta, Store, StoreError, clean_title, compose, retry, split,
};

/// A version is saved before a change only when the newest one is older than this.
pub const QUIET: Duration = Duration::from_secs(10 * 60);
/// Versions older than this go.
pub const KEPT_FOR: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// The most versions a note keeps.
pub const KEPT: usize = 50;
/// How often the whole folder's history is swept of old versions.
const SWEEP_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// The history's folder name, beside `ai.json`.
const FOLDER: &str = "history";
/// The file whose modification time says when the folder's history was last swept.
const SWEPT: &str = ".swept";

/// An earlier text of a note, kept in its history.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Version {
    /// What [`Store::restore_version`] takes: when it was saved, in milliseconds since 1970.
    pub id: String,
    /// When it was saved to the history.
    pub saved: SystemTime,
    /// When the note had last changed before: the time its text is from.
    pub modified: SystemTime,
    /// The text after the frontmatter.
    pub body: String,
}

/// Where the history is and what time it is.
#[derive(Clone)]
pub(crate) struct History {
    /// The notes folder's own history folder; `None`: no history.
    folder: Option<PathBuf>,
    now: Arc<dyn Fn() -> SystemTime + Send + Sync>,
}

impl fmt::Debug for History {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("History")
            .field("folder", &self.folder)
            .finish_non_exhaustive()
    }
}

impl History {
    /// No history.
    pub(crate) fn off() -> History {
        History {
            folder: None,
            now: Arc::new(SystemTime::now),
        }
    }
}

impl Store {
    /// The history folder under the home folder `home`: beside `ai.json`.
    pub fn history_folder(home: &Path) -> PathBuf {
        AiSettings::path(home).with_file_name(FOLDER)
    }

    /// The history folder under the user's home folder, if there is one.
    pub fn default_history_folder() -> Option<PathBuf> {
        std::env::home_dir().map(|home| Store::history_folder(&home))
    }

    /// The same store keeping its notes' versions under `dir` (in a folder of this notes folder's own).
    pub fn with_history_folder(mut self, dir: impl Into<PathBuf>) -> Store {
        let dir = dir.into();
        self.history.folder = Some(dir.join(folder_key(&self.root)));
        self
    }

    /// The same store reading the time from `now` for its history (tests).
    pub fn with_history_clock(
        mut self,
        now: impl Fn() -> SystemTime + Send + Sync + 'static,
    ) -> Store {
        self.history.now = Arc::new(now);
        self
    }

    /// The versions of the note `title` in its history, newest first; none without a history. A title no note has
    /// any more (a trashed note's) still has its versions until they age out.
    pub fn versions(&self, title: &str) -> Result<Vec<Version>, StoreError> {
        let Some(dir) = self.note_history(&clean_title(title)?) else {
            return Ok(Vec::new());
        };
        let mut versions = Vec::new();
        for (saved, path) in saved_versions(&dir)?.into_iter().rev() {
            let content = match retry(|| fs::read_to_string(&path)) {
                Ok(content) => content,
                // Pruned by another process meanwhile.
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            let modified = retry(|| fs::metadata(&path))?.modified()?;
            versions.push(Version {
                id: saved.to_string(),
                saved: UNIX_EPOCH + Duration::from_millis(saved),
                modified,
                body: split(&content).body.to_owned(),
            });
        }
        Ok(versions)
    }

    /// Saves the note's text as it is now to its history, whenever the last version was saved: what the app does
    /// before it puts an earlier version back in the open note. Fails with `NotFound`, `NotDownloaded`, and with an
    /// I/O error when there is no history or it cannot be written.
    pub fn save_version(&self, title: &str) -> Result<Version, StoreError> {
        let entry = self.entry(title)?;
        let content = self.note_text(&entry)?;
        let modified = retry(|| fs::metadata(&entry.path))?.modified()?;
        Ok(self.snapshot(&entry.title, &content, modified)?)
    }

    /// Puts the version `id` of the note back as its text (the body; the note's frontmatter, its lock and emoji,
    /// stays as it is now). The text it has now is saved to its history first; when that fails, nothing changes.
    /// The same text changes nothing. Fails with `NotFound` (the note, or the version, is gone), `NotDownloaded`,
    /// `Locked`.
    pub fn restore_version(&self, title: &str, id: &str) -> Result<NoteMeta, StoreError> {
        let entry = self.entry(title)?;
        let content = self.note_text(&entry)?;
        self.ensure_unlocked(&entry, Some(&content))?;
        let body = self
            .versions(&entry.title)?
            .into_iter()
            .find(|version| version.id == id)
            .ok_or(StoreError::NotFound)?
            .body;
        let parts = split(&content);
        if parts.body == body {
            let (meta, _) = self.load(&entry)?;
            return Ok(meta);
        }
        let metadata = retry(|| fs::metadata(&entry.path))?;
        self.snapshot(&entry.title, &content, metadata.modified()?)?;
        self.write_file(
            &entry.path,
            &compose(parts.header, &body),
            Some(metadata.permissions()),
            None,
        )?;
        let (meta, _) = self.load(&entry)?;
        Ok(meta)
    }

    /// Before a write changes the note's text: saves `content` (the file as it is, modified at `modified`) to its
    /// history unless the newest version is recent ([`QUIET`]). A failure is reported, never returned.
    pub(crate) fn keep_version(&self, entry: &Entry, content: &str, modified: SystemTime) {
        let Some(dir) = self.note_history(&entry.title) else {
            return;
        };
        let now = (self.history.now)();
        let recent = match saved_versions(&dir) {
            Ok(saved) => saved.last().is_some_and(|(newest, _)| {
                now.duration_since(UNIX_EPOCH + Duration::from_millis(*newest))
                    .is_ok_and(|age| age < QUIET)
            }),
            Err(error) => {
                report(&entry.title, &error);
                return;
            }
        };
        if recent {
            return;
        }
        if let Err(error) = self.snapshot(&entry.title, content, modified) {
            report(&entry.title, &error);
        }
    }

    /// [`Store::keep_version`] whatever the newest version: before a note's text is replaced as a whole. A failure
    /// is reported, never returned.
    pub(crate) fn keep_version_now(&self, entry: &Entry, content: &str, modified: SystemTime) {
        if self.history.folder.is_none() {
            return;
        }
        if let Err(error) = self.snapshot(&entry.title, content, modified) {
            report(&entry.title, &error);
        }
    }

    /// Saves `content` (modified at `modified`) as a version of the note `title` now, then prunes its history (and
    /// the folder's, once a day). An I/O error when there is no history or it cannot be written.
    pub(crate) fn snapshot(
        &self,
        title: &str,
        content: &str,
        modified: SystemTime,
    ) -> io::Result<Version> {
        let Some(dir) = self.note_history(title) else {
            return Err(io::Error::other("the notes' version history is off"));
        };
        fs::create_dir_all(&dir)?;
        let now = (self.history.now)();
        let mut saved = millis(now);
        let mut file = tempfile::Builder::new()
            .prefix(".version-")
            .suffix(".tmp")
            .tempfile_in(&dir)?;
        file.write_all(content.as_bytes())?;
        file.as_file().set_modified(modified)?;
        // Another process saving a version in the same millisecond: the next one.
        let mut attempts = 0;
        loop {
            let path = dir.join(format!("{saved}.{EXTENSION}"));
            match file.persist_noclobber(&path) {
                Ok(_) => break,
                Err(error)
                    if error.error.kind() == io::ErrorKind::AlreadyExists && attempts < 16 =>
                {
                    file = error.file;
                    saved += 1;
                    attempts += 1;
                }
                Err(error) => return Err(error.error),
            }
        }
        prune(&dir, now)?;
        self.sweep(now);
        Ok(Version {
            id: saved.to_string(),
            saved: UNIX_EPOCH + Duration::from_millis(saved),
            modified,
            body: split(content).body.to_owned(),
        })
    }

    /// Moves the history of the note `from` to the note `to`, as the note is renamed. A failure is reported: the
    /// rename stands.
    pub(crate) fn move_history(&self, from: &str, to: &str) {
        let (Some(from_dir), Some(to_dir)) = (self.note_history(from), self.note_history(to))
        else {
            return;
        };
        if from_dir == to_dir || !from_dir.exists() {
            return;
        }
        if let Err(error) = move_versions(&from_dir, &to_dir) {
            report(from, &error);
        }
    }

    /// The history folder of the note titled `title` (cleaned), when there is a history.
    fn note_history(&self, title: &str) -> Option<PathBuf> {
        let folder = self.history.folder.as_ref()?;
        Some(folder.join(format!("{:016x}", fnv(title.to_lowercase().as_bytes()))))
    }

    /// Once a day: every note's versions older than [`KEPT_FOR`] go, and so does a note's folder left empty (a
    /// trashed note's, once its versions aged out). Failures are left for the next sweep.
    fn sweep(&self, now: SystemTime) {
        let Some(folder) = self.history.folder.as_deref() else {
            return;
        };
        let marker = folder.join(SWEPT);
        if let Ok(swept) = fs::metadata(&marker).and_then(|m| m.modified())
            && now
                .duration_since(swept)
                .is_ok_and(|since| since < SWEEP_EVERY)
        {
            return;
        }
        let marked = fs::File::create(&marker).and_then(|file| file.set_modified(now));
        if marked.is_err() {
            return;
        }
        let Ok(notes) = fs::read_dir(folder) else {
            return;
        };
        for note in notes.flatten() {
            let dir = note.path();
            if !dir.is_dir() {
                continue;
            }
            let _ = prune(&dir, now);
            // Only an empty folder goes.
            let _ = fs::remove_dir(&dir);
        }
    }
}

/// The versions in a note's history folder, by when they were saved (oldest first), with their files.
fn saved_versions(dir: &Path) -> io::Result<Vec<(u64, PathBuf)>> {
    let entries = match retry(|| fs::read_dir(dir)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut saved = Vec::new();
    for entry in entries {
        let path = entry?.path();
        let Some(stem) = path
            .extension()
            .filter(|extension| *extension == EXTENSION)
            .and_then(|_| path.file_stem())
            .and_then(|stem| stem.to_str())
        else {
            continue;
        };
        if let Ok(at) = stem.parse::<u64>() {
            saved.push((at, path));
        }
    }
    saved.sort();
    Ok(saved)
}

/// Drops the versions saved more than [`KEPT_FOR`] before `now`, then the oldest past [`KEPT`].
fn prune(dir: &Path, now: SystemTime) -> io::Result<()> {
    let saved = saved_versions(dir)?;
    let cutoff = now.checked_sub(KEPT_FOR).map(millis).unwrap_or(0);
    let old = saved.iter().take_while(|(at, _)| *at < cutoff).count();
    let over = (saved.len() - old).saturating_sub(KEPT);
    for (_, path) in &saved[..old + over] {
        match fs::remove_file(path) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
    }
    Ok(())
}

/// Moves every version from `from` to `to` (a note renamed onto a title that has a history of its own, a trashed
/// note's: the two histories become one), then removes `from`.
fn move_versions(from: &Path, to: &Path) -> io::Result<()> {
    if !to.exists() {
        return fs::rename(from, to);
    }
    for (mut saved, path) in saved_versions(from)? {
        // A version saved at the very same millisecond keeps both: the moved one a millisecond later.
        while to.join(format!("{saved}.{EXTENSION}")).exists() {
            saved += 1;
        }
        fs::rename(&path, to.join(format!("{saved}.{EXTENSION}")))?;
    }
    fs::remove_dir_all(from)
}

/// The folder of a notes folder's history: its absolute path (links resolved; on macOS in lowercase, as its file
/// systems ignore case) hashed, after its name.
fn folder_key(root: &Path) -> String {
    let resolved = fs::canonicalize(root).unwrap_or_else(|_| root.to_owned());
    let mut path = resolved.to_string_lossy().into_owned();
    if cfg!(target_os = "macos") {
        path = path.to_lowercase();
    }
    let name: String = resolved
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("notes")
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | ' '))
        .take(32)
        .collect();
    format!("{name}-{:016x}", fnv(path.as_bytes()))
}

/// FNV-1a, 64 bits: a hash that stays the same across builds and versions of Rust.
fn fnv(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |since| {
        u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
    })
}

/// A history that could not be written: said on stderr (the app's log, `jot-mcp`'s), and the write goes on.
fn report(title: &str, error: &io::Error) {
    eprintln!("jot-store: cannot keep a version of the note {title:?}: {error}");
}
