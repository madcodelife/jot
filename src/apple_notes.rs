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
use tokio::sync::mpsc::unbounded_channel;

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
/// fills up), but for `limit` at most: past it, the process is killed and this is `None`. Each line of stderr that is
/// progress (`progress <done> <total>`, [`progress_line`]) goes to `on_progress` as it comes, and is left out of the
/// output's `stderr`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn output_within(
    mut command: Command,
    limit: Duration,
    mut on_progress: impl FnMut(u32, u32) + Send + 'static,
) -> std::io::Result<Option<Output>> {
    use std::io::{BufRead, BufReader, Read};

    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take();
    let stdout = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = stdout {
            let _ = pipe.read_to_end(&mut bytes);
        }
        bytes
    });
    let stderr = child.stderr.take();
    let stderr = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(pipe) = stderr {
            let mut pipe = BufReader::new(pipe);
            let mut line = Vec::new();
            while matches!(pipe.read_until(b'\n', &mut line), Ok(n) if n > 0) {
                match progress_line(&line) {
                    Some((done, total)) => on_progress(done, total),
                    None => bytes.extend_from_slice(&line),
                }
                line.clear();
            }
        }
        bytes
    });
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

/// A line of progress the script writes to stderr, `progress <done> <total>` (src/platform/apple-notes.js): the
/// folders whose text is read, of how many.
pub(crate) fn progress_line(line: &[u8]) -> Option<(u32, u32)> {
    let line = std::str::from_utf8(line)
        .ok()?
        .trim_end_matches(['\n', '\r']);
    let mut words = line.strip_prefix("progress ")?.split(' ');
    let done = words.next()?.parse().ok()?;
    let total = words.next()?.parse().ok()?;
    words.next().is_none().then_some((done, total))
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
    /// Calls `onProgress` as it goes: `reading`, the folders of Notes whose text is read, then `writing`, the notes
    /// written (or left out), each with how many are done of how many.
    ///
    /// The first time, the system asks the user to let Jot control Notes. Rejects with `code`
    /// `ERR_JOT_NOT_AUTHORIZED` when that was refused, `ERR_JOT_TIMED_OUT` when Notes did not give every note within
    /// 10 minutes ([`READ_LIMIT`]; nothing imported), `ERR_JOT_UNSUPPORTED` where there is no Apple Notes; with the
    /// system's words for anything else.
    pub async fn import(
        dir: String,
        #[args(progress)] on_progress: Callback<AppleNotesProgress>,
    ) -> Result<AppleNotesImport, JsError> {
        enum Step {
            Progress(AppleNotesProgress),
            Done(Result<AppleNotesImport, JsError>),
        }
        let dir = expand_home(&dir);
        // The work blocks on its own thread; its steps come back here, on the engine thread, where the callback is
        // posted.
        let (steps, mut receiver) = unbounded_channel();
        let work = blocking(move || {
            let reading = steps.clone();
            let progress =
                |phase, done, total| Step::Progress(AppleNotesProgress { phase, done, total });
            let import = || {
                let json = platform::read_apple_notes(move |done, total| {
                    let _ = reading.send(progress(ImportPhase::Reading, done, total));
                })
                .map_err(read_error)?;
                let read = parse(&json).map_err(|why| {
                    JsError::Error(format!("cannot read what Apple Notes gave: {why}"))
                })?;
                let store = Store::open(&dir).map_err(|e| {
                    store_error(e, format_args!("cannot open the folder {}", dir.display()))
                })?;
                let total = count(read.notes.len());
                let _ = steps.send(progress(ImportPhase::Writing, 0, total));
                let imported = store
                    .import_with_progress(&read.notes, |done| {
                        let _ = steps.send(progress(ImportPhase::Writing, count(done), total));
                    })
                    .map_err(|e| store_error(e, "cannot import the notes"))?;
                Ok(AppleNotesImport::new(read, imported))
            };
            let done = import();
            let _ = steps.send(Step::Done(done));
        });
        while let Some(step) = receiver.recv().await {
            match step {
                Step::Progress(progress) => on_progress.post(progress),
                Step::Done(done) => return done,
            }
        }
        // The thread ended without an answer: it panicked.
        Err(JsError::Error(match work.await {
            Err(error) => error.to_string(),
            Ok(()) => "the import stopped".to_owned(),
        }))
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

/// How far `AppleNotes.import` is.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct AppleNotesProgress {
    /// What it does now.
    pub phase: ImportPhase,
    /// How many are done: folders of Notes read, or notes written.
    pub done: u32,
    /// Of how many.
    pub total: u32,
}

/// What `AppleNotes.import` does now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PropEnum)]
pub enum ImportPhase {
    /// Reading the notes' text from Notes, folder by folder.
    Reading,
    /// Writing the notes into the notes folder.
    Writing,
}

/// `n` as a count for TS.
fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
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
