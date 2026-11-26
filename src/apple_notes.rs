//! `AppleNotes`: the settings' "Import from Apple Notes". Every note of Notes (every account, every folder) is read
//! once, when the user asks for it, and written into the notes folder through `jot_store::Store::import`: a note
//! imported before is left out, nothing here is changed.
//!
//! Reading Notes is the platform's ([`crate::platform::read_apple_notes`]: on macOS, Notes' scripting through
//! `osascript`, which makes the system ask the user to let Jot control Notes the first time). It gives every note as
//! JSON ([`parse`]); each unlocked note's HTML becomes Markdown here ([`html::to_markdown`]), the same on every
//! platform. Locked notes (their text is encrypted) and those in Recently Deleted are counted and left out.

use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant, SystemTime};

use jot_store::{ImportNote, Store};
use nsh_core::prelude::*;
use serde_json::Value;

use crate::folder::{FailedNote, RenamedNote};
use crate::notes::{expand_home, store_error};
use crate::platform;

mod html;
#[cfg(test)]
mod tests;

/// Why Notes could not be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReadError {
    /// There is no Apple Notes here (not macOS).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
    /// The user did not let Jot control Notes (Privacy & Security › Automation).
    NotAuthorized,
    /// Notes did not give every note within [`READ_LIMIT`].
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    TimedOut,
    /// Anything else, as the system said it.
    Failed(String),
}

impl ReadError {
    /// What `osascript` said when it failed: Apple Events' "Not authorized to send Apple events" (-1743) is the
    /// user's refusal (-1744: a consent the system would not ask for); anything else as it said it.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn of_osascript(stderr: &str) -> ReadError {
        if stderr.contains("(-1743)") || stderr.contains("(-1744)") {
            return ReadError::NotAuthorized;
        }
        let why = stderr.trim();
        ReadError::Failed(if why.is_empty() {
            "osascript failed".to_owned()
        } else {
            why.to_owned()
        })
    }
}

/// How long reading Notes may take, all of it: past this, it is stopped (`osascript` killed) and nothing is imported.
/// The system's question whether Jot may control Notes counts too, and Notes may take long over a big folder (one note
/// at a time when all at once failed), but not this long.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) const READ_LIMIT: Duration = Duration::from_secs(10 * 60);

/// Runs `command` as `Command::output` does, its stdout and stderr read meanwhile (on threads of their own, so neither
/// fills up), but for `limit` at most: past it, the process is killed and this is `None`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn output_within(
    mut command: Command,
    limit: Duration,
) -> std::io::Result<Option<Output>> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    fn read_all(
        pipe: Option<impl std::io::Read + Send + 'static>,
    ) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut bytes);
            }
            bytes
        })
    }
    let stdout = read_all(child.stdout.take());
    let stderr = read_all(child.stderr.take());
    let deadline = Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        let now = Instant::now();
        if now >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep((deadline - now).min(Duration::from_millis(50)));
    };
    // The process is gone: its pipes are closed, and the threads end.
    let stdout = stdout.join().unwrap_or_default();
    let stderr = stderr.join().unwrap_or_default();
    Ok(status.map(|status| Output {
        status,
        stdout,
        stderr,
    }))
}

/// Importing from Apple Notes.
#[module]
pub struct AppleNotes;

#[module]
impl AppleNotes {
    /// Whether this platform has Apple Notes to import from (macOS). Asks the system nothing.
    pub fn available() -> bool {
        platform::APPLE_NOTES
    }

    /// Reads every note of Apple Notes and imports it into the notes folder `dir` (a leading `~/` is the home
    /// folder): its HTML as Markdown, `apple-notes-id` and `folder` in its frontmatter, its date as the file's.
    /// A note imported before (its id in the folder) is left out, and no note of the folder is changed: a title
    /// taken is numbered (`Title 2`). Locked notes and those in Recently Deleted are left out and counted.
    ///
    /// The first time, the system asks the user to let Jot control Notes. Rejects with `code`
    /// `ERR_JOT_NOT_AUTHORIZED` when that was refused, `ERR_JOT_TIMED_OUT` when Notes did not give every note within
    /// 10 minutes ([`READ_LIMIT`]; nothing imported), `ERR_JOT_UNSUPPORTED` where there is no Apple Notes; with the
    /// system's words for anything else.
    pub async fn import(dir: String) -> Result<AppleNotesImport, JsError> {
        let dir = expand_home(&dir);
        blocking(move || {
            let json = platform::read_apple_notes().map_err(read_error)?;
            let read = parse(&json).map_err(|why| {
                JsError::Error(format!("cannot read what Apple Notes gave: {why}"))
            })?;
            let store = Store::open(&dir).map_err(|e| {
                store_error(e, format_args!("cannot open the folder {}", dir.display()))
            })?;
            let imported = store
                .import(&read.notes)
                .map_err(|e| store_error(e, "cannot import the notes"))?;
            Ok(AppleNotesImport::new(read, imported))
        })
        .await
        .map_err(|error| JsError::Error(error.to_string()))?
    }
}

fn read_error(error: ReadError) -> JsError {
    match error {
        ReadError::Unsupported => {
            JsError::Error("there is no Apple Notes on this system".into()).with_code("ERR_JOT_UNSUPPORTED")
        }
        ReadError::NotAuthorized => JsError::Error(
            "Jot is not allowed to control Notes (System Settings › Privacy & Security › Automation)".into(),
        )
        .with_code("ERR_JOT_NOT_AUTHORIZED"),
        ReadError::TimedOut => JsError::Error(format!(
            "Apple Notes did not give its notes within {} minutes",
            READ_LIMIT.as_secs() / 60
        ))
        .with_code("ERR_JOT_TIMED_OUT"),
        ReadError::Failed(why) => JsError::Error(format!("cannot read Apple Notes: {why}")),
    }
}

/// What `AppleNotes.import` did.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct AppleNotesImport {
    /// How many notes were imported (`renamed` among them).
    pub imported: u32,
    /// The notes imported under another title: the folder had a different note of theirs.
    pub renamed: Vec<RenamedNote>,
    /// How many were imported before, and left out.
    pub already: u32,
    /// How many are locked in Notes (their text cannot be read), left out.
    pub locked: u32,
    /// How many are in Notes' Recently Deleted, left out.
    pub deleted: u32,
    /// How many were left out for now: a note with their title is not downloaded to this Mac yet (it may be the
    /// same one, imported before). Importing again once it is here brings them in.
    pub waiting: u32,
    /// The notes that could not be imported, and why.
    pub failed: Vec<FailedNote>,
}

impl AppleNotesImport {
    fn new(read: ReadNotes, imported: jot_store::Imported) -> AppleNotesImport {
        let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
        let mut failed: Vec<FailedNote> = read
            .unreadable
            .into_iter()
            .map(|(title, why)| FailedNote {
                title,
                error: why.to_owned(),
            })
            .collect();
        failed.extend(
            imported
                .failed
                .into_iter()
                .map(|(title, error)| FailedNote { title, error }),
        );
        AppleNotesImport {
            imported: count(imported.imported.len() + imported.renamed.len()),
            renamed: imported
                .renamed
                .into_iter()
                .map(|(from, to)| RenamedNote { from, to })
                .collect(),
            already: count(imported.already.len()),
            locked: count(read.locked),
            deleted: count(read.deleted),
            waiting: count(imported.waiting.len()),
            failed,
        }
    }
}

/// What Notes gave, made ready for the store.
#[derive(Debug, Default)]
pub(crate) struct ReadNotes {
    /// The notes to import, newest first (so the newest of two with one title keeps it).
    pub notes: Vec<ImportNote>,
    /// How many are locked.
    pub locked: usize,
    /// How many are in Recently Deleted.
    pub deleted: usize,
    /// The notes Notes gave no text for (neither locked nor deleted), or no id (without one, importing again would
    /// import it again): their titles, and which ([`NO_TEXT`], [`NO_ID`]).
    pub unreadable: Vec<(String, &'static str)>,
}

/// Why a note is not imported: Notes gave no text for it.
pub(crate) const NO_TEXT: &str = "Apple Notes did not give its text";
/// Why a note is not imported: Notes gave no id for it.
pub(crate) const NO_ID: &str = "Apple Notes did not give its id";

/// Reads the platform's JSON: `{"folders": [{"path": ["Work", "Projects"], "deleted": false, "notes": [{"id",
/// "name", "modified" (ms since 1970), "locked", "body" (HTML, null when not read)}]}]}`.
pub(crate) fn parse(json: &str) -> Result<ReadNotes, String> {
    let value: Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let folders = value
        .get("folders")
        .and_then(Value::as_array)
        .ok_or("no folders")?;
    let mut read = ReadNotes::default();
    for folder in folders {
        let notes = folder
            .get("notes")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice);
        if folder.get("deleted").and_then(Value::as_bool) == Some(true) {
            read.deleted += notes.len();
            continue;
        }
        let path: Vec<&str> = folder
            .get("path")
            .and_then(Value::as_array)
            .map(|path| path.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let path = path.join("/");
        for note in notes {
            let text = |key: &str| note.get(key).and_then(Value::as_str);
            let name = text("name").unwrap_or_default();
            if note.get("locked").and_then(Value::as_bool) == Some(true) {
                read.locked += 1;
                continue;
            }
            let Some(id) = text("id").filter(|id| !id.is_empty()) else {
                read.unreadable.push((name.to_owned(), NO_ID));
                continue;
            };
            let Some(body) = text("body") else {
                read.unreadable.push((name.to_owned(), NO_TEXT));
                continue;
            };
            let modified = note
                .get("modified")
                .and_then(Value::as_f64)
                .filter(|ms| ms.is_finite() && *ms >= 0.0)
                .map_or_else(SystemTime::now, |ms| {
                    SystemTime::UNIX_EPOCH + Duration::from_millis(ms as u64)
                });
            read.notes.push(ImportNote {
                id: id.to_owned(),
                title: name.to_owned(),
                body: html::to_markdown(body, Some(name)),
                folder: (!path.is_empty()).then(|| path.clone()),
                modified,
            });
        }
    }
    read.notes
        .sort_by_key(|note| std::cmp::Reverse(note.modified));
    Ok(read)
}
