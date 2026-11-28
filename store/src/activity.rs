//! What AI apps wrote, for the app to show: `jot-mcp` adds a line to a log outside the notes folder for every write
//! of its tools, and the app reads the lines added since it started (the island says what happened). It is the only
//! way the two talk: `jot-mcp` runs in each AI app's process and the app is not told of its calls.
//!
//! The log sits beside `ai.json` (`~/Library/Application Support/Jot/activity.jsonl` on macOS): one JSON object a
//! line,
//!
//! ```json
//! {"at":"2026-11-26T14:30:05","dir":"/Users/me/Documents/Jot","agent":"Claude Code","action":"replace","title":"Plan","previous":"Plan (before rewrite · 2026-11-26 14.30)","inTrash":"/Users/me/.Trash/Plan (before rewrite · 2026-11-26 14.30).md"}
//! ```
//!
//! `at` is the local time, `dir` the notes folder (absolute, links resolved), `agent` the app's name as Jot shows it,
//! `action` what it did (`create`, `append`, `edit`, `todo`, `complete`, `reschedule`, `replace`, `trash`), `title`
//! the note's. `previous` is the name a rewritten note's previous version took in the trash, and `inTrash` where a
//! trashed note (or that previous version) went, when the system says.
//!
//! Each line is one `write` to the file opened for appending, so lines from several `jot-mcp` processes never mix.
//! Past [`ROTATE_AT`] the file is renamed `activity.1.jsonl` (over the one before) and a new one started. A reader
//! ([`ActivityTail`]) keeps where it got to and the file it read, and follows a rotation.

use std::fs;
use std::io::{self, Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};

use jiff::civil::DateTime;
use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{DebounceEventResult, DebouncedEventBatch, new_debouncer};

use crate::{AiSettings, DEBOUNCE, StoreError, Watcher};

/// The log grows to about this many bytes before it is rotated.
pub const ROTATE_AT: u64 = 256 * 1024;

/// The log's file name, and the rotated one's.
const FILE: &str = "activity.jsonl";
const ROTATED: &str = "activity.1.jsonl";

/// What an AI app did to a note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Made a new note (`create_note`, or `add_todo` into a note it made).
    Create,
    /// Added text at a note's end (`append_note`).
    Append,
    /// Changed one passage of a note's text (`edit_note`).
    Edit,
    /// Added a to-do to a note that was there (`add_todo`).
    Todo,
    /// Checked a to-do off (`complete_todo`).
    Complete,
    /// Moved a to-do's reminder time, or removed it (`reschedule_todo`).
    Reschedule,
    /// Rewrote a whole note, its previous version going to the trash (`replace_note`).
    Replace,
    /// Moved a note to the trash (`trash_note`).
    Trash,
}

impl Action {
    /// Its name in the log.
    pub fn as_str(self) -> &'static str {
        match self {
            Action::Create => "create",
            Action::Append => "append",
            Action::Edit => "edit",
            Action::Todo => "todo",
            Action::Complete => "complete",
            Action::Reschedule => "reschedule",
            Action::Replace => "replace",
            Action::Trash => "trash",
        }
    }

    /// The action named `name` in the log.
    pub fn parse(name: &str) -> Option<Action> {
        Some(match name {
            "create" => Action::Create,
            "append" => Action::Append,
            "edit" => Action::Edit,
            "todo" => Action::Todo,
            "complete" => Action::Complete,
            "reschedule" => Action::Reschedule,
            "replace" => Action::Replace,
            "trash" => Action::Trash,
            _ => return None,
        })
    }
}

/// One line of the log: a write of an AI app.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Activity {
    /// When, in local time.
    pub at: DateTime,
    /// The notes folder written to.
    pub dir: PathBuf,
    /// The app's name as Jot shows it (`Source::label`): "Claude Code", "Cursor".
    pub agent: String,
    /// What it did.
    pub action: Action,
    /// The note's title.
    pub title: String,
    /// `Replace`: the name the previous version took in the trash.
    pub previous: Option<String>,
    /// Where the trashed note (`Trash`) or the previous version (`Replace`) is in the trash, when the system said.
    pub in_trash: Option<PathBuf>,
}

impl Activity {
    /// A record of `agent` doing `action` to the note `title` in `dir` at `at`.
    pub fn new(
        at: DateTime,
        dir: impl Into<PathBuf>,
        agent: impl Into<String>,
        action: Action,
        title: impl Into<String>,
    ) -> Activity {
        Activity {
            at,
            dir: dir.into(),
            agent: agent.into(),
            action,
            title: title.into(),
            previous: None,
            in_trash: None,
        }
    }

    /// The same, with the previous version's name in the trash.
    pub fn with_previous(mut self, previous: impl Into<String>) -> Activity {
        self.previous = Some(previous.into());
        self
    }

    /// The same, with where the note went in the trash.
    pub fn with_in_trash(mut self, path: Option<PathBuf>) -> Activity {
        self.in_trash = path;
        self
    }

    /// The log under the home folder `home`: beside `ai.json`.
    pub fn path(home: &Path) -> PathBuf {
        AiSettings::path(home).with_file_name(FILE)
    }

    /// The log under the user's home folder, if there is one.
    pub fn default_path() -> Option<PathBuf> {
        std::env::home_dir().map(|home| Activity::path(&home))
    }

    /// Its line in the log, the line break included: its keys in the order above, absent ones left out.
    pub fn to_line(&self) -> String {
        let string = |value: &str| serde_json::Value::from(value).to_string();
        let mut line = format!(
            "{{\"at\":{},\"dir\":{},\"agent\":{},\"action\":{},\"title\":{}",
            string(&self.at.strftime("%Y-%m-%dT%H:%M:%S").to_string()),
            string(&self.dir.to_string_lossy()),
            string(&self.agent),
            string(self.action.as_str()),
            string(&self.title),
        );
        if let Some(previous) = &self.previous {
            line.push_str(&format!(",\"previous\":{}", string(previous)));
        }
        if let Some(path) = &self.in_trash {
            line.push_str(&format!(",\"inTrash\":{}", string(&path.to_string_lossy())));
        }
        line.push_str("}\n");
        line
    }

    /// The record a line of the log holds; `None` for a line that is not one (another version's, a broken one).
    pub fn parse(line: &str) -> Option<Activity> {
        let serde_json::Value::Object(map) = serde_json::from_str(line.trim()).ok()? else {
            return None;
        };
        let text = |key: &str| map.get(key).and_then(serde_json::Value::as_str);
        Some(Activity {
            at: text("at")?.parse().ok()?,
            dir: PathBuf::from(text("dir")?),
            agent: text("agent")?.to_owned(),
            action: Action::parse(text("action")?)?,
            title: text("title")?.to_owned(),
            previous: text("previous").map(str::to_owned),
            in_trash: text("inTrash").map(PathBuf::from),
        })
    }

    /// Adds the record to the log at `path` (its folder created as needed), in one write; a log past
    /// [`ROTATE_AT`] is rotated first.
    pub fn append(&self, path: &Path) -> io::Result<()> {
        let dir = path
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no folder"))?;
        fs::create_dir_all(dir)?;
        let line = self.to_line();
        let mut file = open_for_append(path)?;
        let metadata = file.metadata()?;
        if metadata.len() > 0 && metadata.len() + line.len() as u64 > ROTATE_AT {
            // Another process may have rotated it since it was opened: only the file it opened is moved.
            if fs::metadata(path).is_ok_and(|now| same_file(&now, &metadata)) {
                match fs::rename(path, path.with_file_name(ROTATED)) {
                    // Rotated by another process in between.
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    result => result?,
                }
            }
            file = open_for_append(path)?;
        }
        // One `write` of the whole line: appends are atomic, so lines of other processes never cut into it.
        let written = file.write(line.as_bytes())?;
        if written != line.len() {
            return Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "the line was written in part",
            ));
        }
        Ok(())
    }
}

fn open_for_append(path: &Path) -> io::Result<fs::File> {
    fs::OpenOptions::new().create(true).append(true).open(path)
}

/// Which file this is (its device and inode), where the platform says.
#[cfg(unix)]
fn file_id(metadata: &fs::Metadata) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt as _;
    Some((metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn file_id(_metadata: &fs::Metadata) -> Option<(u64, u64)> {
    None
}

fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    match (file_id(a), file_id(b)) {
        (Some(a), Some(b)) => a == b,
        // Without inodes, a file as long or longer is taken to be the same.
        _ => a.len() >= b.len(),
    }
}

/// Reads the lines added to the log since it last looked.
#[derive(Debug)]
pub struct ActivityTail {
    path: PathBuf,
    /// How far into the file it has read.
    offset: u64,
    /// The file it read (`None`: none yet).
    file: Option<(u64, u64)>,
    /// The start of a line whose end is not there yet.
    partial: Vec<u8>,
}

impl ActivityTail {
    /// A reader of the log at `path` from its end now: what was written before is not read. A log that is not
    /// there yet is read from its start once it is.
    pub fn from_end(path: impl Into<PathBuf>) -> ActivityTail {
        let path = path.into();
        let (offset, file) = match fs::metadata(&path) {
            Ok(metadata) => (metadata.len(), file_id(&metadata)),
            Err(_) => (0, None),
        };
        ActivityTail {
            path,
            offset,
            file,
            partial: Vec::new(),
        }
    }

    /// The log's file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The records added since the last read, oldest first. After a rotation it reads the rest of the file it was
    /// reading (now `activity.1.jsonl`), then the new file from its start. A line that does not parse is skipped.
    pub fn read(&mut self) -> Vec<Activity> {
        let mut bytes = Vec::new();
        let Ok(mut file) = fs::File::open(&self.path) else {
            // Gone (being rotated, or removed): the next file is read from its start.
            self.offset = 0;
            self.partial.clear();
            return Vec::new();
        };
        let Ok(metadata) = file.metadata() else {
            return Vec::new();
        };
        let id = file_id(&metadata);
        let replaced = match (self.file, id) {
            (Some(was), Some(now)) => was != now,
            _ => false,
        };
        if replaced || metadata.len() < self.offset {
            // Rotated: first what is left of the file it was reading.
            let rotated = self.path.with_file_name(ROTATED);
            if let (Some(was), Ok(mut old)) = (self.file, fs::File::open(&rotated))
                && old.metadata().ok().as_ref().and_then(file_id) == Some(was)
                && old.seek(SeekFrom::Start(self.offset)).is_ok()
            {
                let _ = old.read_to_end(&mut bytes);
            }
            self.offset = 0;
        }
        self.file = id;
        let mut lines = self.take_lines(bytes);
        if file.seek(SeekFrom::Start(self.offset)).is_ok() {
            let mut added = Vec::new();
            if let Ok(read) = file.read_to_end(&mut added) {
                self.offset += read as u64;
                lines.extend(self.take_lines(added));
            }
        }
        lines
    }

    /// The whole lines of `partial` and `bytes`, parsed; what follows the last line break waits for its end.
    fn take_lines(&mut self, bytes: Vec<u8>) -> Vec<Activity> {
        self.partial.extend(bytes);
        let Some(end) = self.partial.iter().rposition(|&b| b == b'\n') else {
            return Vec::new();
        };
        let rest = self.partial.split_off(end + 1);
        let whole = std::mem::replace(&mut self.partial, rest);
        String::from_utf8_lossy(&whole)
            .lines()
            .filter_map(Activity::parse)
            .collect()
    }
}

/// Calls `on_change` (debounced ~150 ms) when the log at `path` changes or is rotated, its folder created as
/// needed. Dropping the `Watcher` stops it.
pub fn watch_activity(
    path: &Path,
    on_change: impl Fn() + Send + 'static,
) -> Result<Watcher, StoreError> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no folder"))?;
    fs::create_dir_all(dir)?;
    let names = [
        path.file_name().map(ToOwned::to_owned),
        Some(ROTATED.into()),
    ];
    let mut debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| match result {
        Ok(DebouncedEventBatch::Events(events)) => {
            if events
                .iter()
                .any(|event| names.contains(&event.path.file_name().map(ToOwned::to_owned)))
            {
                on_change();
            }
        }
        Ok(_) | Err(_) => on_change(),
    })?;
    debouncer
        .watcher()
        .watch(dir, RecursiveMode::NonRecursive)?;
    Ok(Watcher {
        _debouncer: debouncer,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(title: &str, action: Action) -> Activity {
        Activity::new(
            jiff::civil::date(2026, 11, 26).at(14, 30, 5, 0),
            "/Users/me/Documents/Jot",
            "Claude Code",
            action,
            title,
        )
    }

    #[test]
    fn a_line_and_back() {
        let plain = record("Plan", Action::Append);
        assert_eq!(
            plain.to_line(),
            "{\"at\":\"2026-11-26T14:30:05\",\"dir\":\"/Users/me/Documents/Jot\",\"agent\":\"Claude Code\",\
             \"action\":\"append\",\"title\":\"Plan\"}\n"
        );
        assert_eq!(Activity::parse(&plain.to_line()), Some(plain));
        let replaced = record("计划 \"A\"\n", Action::Replace)
            .with_previous("计划（改写前 · 2026-11-26 14.30）")
            .with_in_trash(Some("/Users/me/.Trash/计划.md".into()));
        let line = replaced.to_line();
        assert_eq!(line.matches('\n').count(), 1, "{line}");
        assert_eq!(Activity::parse(&line), Some(replaced));
        for broken in ["", "{", "[]", "{\"action\":\"create\"}", "{\"at\":\"x\"}"] {
            assert_eq!(Activity::parse(broken), None, "{broken:?}");
        }
        for action in [
            Action::Create,
            Action::Append,
            Action::Edit,
            Action::Todo,
            Action::Complete,
            Action::Reschedule,
            Action::Replace,
            Action::Trash,
        ] {
            assert_eq!(Action::parse(action.as_str()), Some(action));
        }
    }

    #[test]
    fn beside_the_settings() {
        let home = Path::new("/Users/me");
        assert_eq!(
            Activity::path(home).parent(),
            AiSettings::path(home).parent()
        );
        assert!(Activity::path(home).ends_with("activity.jsonl"));
    }

    #[test]
    fn read_from_the_end_then_what_is_added() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Jot/activity.jsonl");
        // Not there yet: read from its start once it is.
        let mut early = ActivityTail::from_end(&path);
        assert_eq!(early.read(), []);
        record("Old", Action::Create).append(&path).unwrap();
        let mut tail = ActivityTail::from_end(&path);
        assert_eq!(tail.read(), []);
        assert_eq!(early.read(), [record("Old", Action::Create)]);

        record("New", Action::Todo).append(&path).unwrap();
        // A line still being written waits for its end; one that is not a record is skipped.
        let mut file = open_for_append(&path).unwrap();
        file.write_all(b"not json\n{\"at\":\"2026-11-26T14:30:05\"")
            .unwrap();
        assert_eq!(tail.read(), [record("New", Action::Todo)]);
        file.write_all(b",\"dir\":\"/d\",\"agent\":\"A\",\"action\":\"trash\",\"title\":\"T\"}\n")
            .unwrap();
        let read = tail.read();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].title, "T");
        assert_eq!(tail.read(), []);
    }

    #[test]
    fn rotated_past_its_size_and_followed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("activity.jsonl");
        let rotated = dir.path().join("activity.1.jsonl");
        let mut tail = ActivityTail::from_end(&path);
        let line = record("x", Action::Append).to_line().len() as u64;
        let fill = ROTATE_AT / line;
        for _ in 0..fill {
            record("x", Action::Append).append(&path).unwrap();
        }
        assert_eq!(tail.read().len() as u64, fill);
        assert!(!rotated.exists());
        // The next line would take it past the size: it goes to a new file, and so does the one after it.
        record("before", Action::Append).append(&path).unwrap();
        record("after", Action::Append).append(&path).unwrap();
        assert!(rotated.exists());
        assert!(fs::metadata(&path).unwrap().len() < ROTATE_AT);
        assert!(fs::metadata(&rotated).unwrap().len() <= ROTATE_AT);
        let titles: Vec<String> = tail.read().into_iter().map(|a| a.title).collect();
        assert_eq!(titles, ["before", "after"]);

        // A rotation over the one before: only the newest two files stay.
        for _ in 0..fill {
            record("y", Action::Append).append(&path).unwrap();
        }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
        assert_eq!(tail.read().len() as u64, fill);
    }

    #[test]
    fn lines_of_several_writers_never_mix() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("activity.jsonl");
        let write = |writers: usize, lines: usize| {
            let handles: Vec<_> = (0..writers)
                .map(|writer| {
                    let path = path.clone();
                    std::thread::spawn(move || {
                        for n in 0..lines {
                            let title = format!("{writer}-{n}-{}", "长".repeat(n % 7));
                            record(&title, Action::Append).append(&path).unwrap();
                        }
                    })
                })
                .collect();
            for handle in handles {
                handle.join().unwrap();
            }
        };
        let read = |file: &Path| -> usize {
            let text = fs::read_to_string(file).unwrap_or_default();
            for line in text.lines() {
                assert!(Activity::parse(line).is_some(), "{line}");
            }
            text.lines().count()
        };
        // Under the size: every line is there, whole.
        write(8, 100);
        assert!(!dir.path().join(ROTATED).exists());
        assert_eq!(read(&path), 800);
        // Rotating while they write: a line may go with a file rotated over, but none is ever cut.
        write(8, 400);
        assert!(dir.path().join(ROTATED).exists());
        read(&path);
        read(&dir.path().join(ROTATED));
    }
}
