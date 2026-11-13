//! To-dos: Markdown task lines in any note.
//!
//! A to-do is a line `- [ ] text` (also `*` / `+`, indented or not) outside code fences; a checked one is
//! `- [x] text ✅ 2026-11-14`, the date it was checked. A reminder time is ` ⏰ YYYY-MM-DD HH:mm` anywhere in the
//! line, in local time (the Obsidian Reminder plugin's form); a date alone means 09:00. Relative phrases such as
//! `明天 9:00` are only an input form (`crate::when`), never stored.

use std::cmp::Reverse;
use std::io;
use std::ops::Range;
use std::time::SystemTime;

use jiff::civil::{Date, DateTime};

use crate::{NoteMeta, Source, Store, StoreError, clean_title, load};

/// The note `add_todo` writes to when the caller names none.
pub const DEFAULT_TODO_NOTE: &str = "待办";
/// The marker before a reminder time.
pub(crate) const REMINDER: &str = "⏰";
/// The marker before the date a to-do was checked.
const DONE: &str = "✅";

/// A to-do found in a note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Todo {
    /// The note's title.
    pub note: String,
    /// The 0-based line in the note's body (the text after the frontmatter).
    pub line: usize,
    /// The line's text without the box and the `⏰` and `✅` parts.
    pub text: String,
    /// Whether it is checked.
    pub done: bool,
    /// The reminder time, local.
    pub due: Option<DateTime>,
    /// The day it was checked.
    pub done_on: Option<Date>,
}

/// One task line, read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskLine {
    /// The byte range of the box's mark (` ` or `x`).
    mark: Range<usize>,
    /// Where the content after the box starts.
    pub(crate) content_start: usize,
    pub(crate) done: bool,
    pub(crate) text: String,
    pub(crate) due: Option<DateTime>,
    done_on: Option<Date>,
    /// The `✅ <date>` part with the spaces before it, if any.
    done_range: Option<Range<usize>>,
}

impl TaskLine {
    /// Reads `line` (without its line break) as a task line.
    pub(crate) fn parse(line: &str) -> Option<TaskLine> {
        let indent = line.len() - line.trim_start_matches([' ', '\t']).len();
        let rest = &line[indent..];
        let bullet = rest.chars().next()?;
        if !matches!(bullet, '-' | '*' | '+') {
            return None;
        }
        let after_bullet = indent + 1;
        let spaces =
            line[after_bullet..].len() - line[after_bullet..].trim_start_matches(' ').len();
        if spaces == 0 {
            return None;
        }
        let open = after_bullet + spaces;
        let bytes = line.as_bytes();
        if bytes.get(open) != Some(&b'[') || bytes.get(open + 2) != Some(&b']') {
            return None;
        }
        let done = match bytes[open + 1] {
            b' ' => false,
            b'x' | b'X' => true,
            _ => return None,
        };
        let close = open + 3;
        let content_start = match bytes.get(close) {
            None => close,
            Some(b' ' | b'\t') => close + 1,
            Some(_) => return None,
        };
        let content = &line[content_start..];

        let reminder = find_marker(content, REMINDER, |value| {
            let (at, length) = parse_due_prefix(value)?;
            Some((at, length))
        });
        let checked = find_marker(content, DONE, |value| {
            let date = parse_date(value.get(..10)?)?;
            Some((date, 10))
        });
        let mut cuts: Vec<Range<usize>> = Vec::new();
        if let Some((_, range)) = &reminder {
            cuts.push(range.clone());
        }
        if let Some((_, range)) = &checked {
            cuts.push(range.clone());
        }
        cuts.sort_by_key(|range| range.start);
        let mut text = String::with_capacity(content.len());
        let mut from = 0;
        for cut in &cuts {
            text.push_str(&content[from..cut.start]);
            from = cut.end;
        }
        text.push_str(&content[from..]);

        Some(TaskLine {
            mark: open + 1..open + 2,
            content_start,
            done,
            text: text.trim().to_owned(),
            due: reminder.map(|(at, _)| at),
            done_on: checked.as_ref().map(|(date, _)| *date),
            done_range: checked
                .map(|(_, range)| content_start + range.start..content_start + range.end),
        })
    }
}

/// The first `marker` in `content` followed by a value `read` accepts, and the byte range of the marker, its value
/// and the spaces before it.
fn find_marker<T>(
    content: &str,
    marker: &str,
    read: impl Fn(&str) -> Option<(T, usize)>,
) -> Option<(T, Range<usize>)> {
    content.match_indices(marker).find_map(|(at, _)| {
        let after = at + marker.len();
        let value_start =
            after + content[after..].len() - content[after..].trim_start_matches(' ').len();
        let (value, length) = read(&content[value_start..])?;
        let end = value_start + length;
        // The value must end at a word's end.
        if content[end..].starts_with(|c: char| !c.is_whitespace()) {
            return None;
        }
        let start = content[..at].trim_end_matches([' ', '\t']).len();
        Some((value, start..end))
    })
}

/// `YYYY-MM-DD`.
fn parse_date(text: &str) -> Option<Date> {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let number = |range: Range<usize>| -> Option<i16> {
        let part = &text[range];
        if !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    let year = number(0..4)?;
    let month = i8::try_from(number(5..7)?).ok()?;
    let day = i8::try_from(number(8..10)?).ok()?;
    Date::new(year, month, day).ok()
}

/// `YYYY-MM-DD HH:mm` (or `T` between them), or `YYYY-MM-DD` for 09:00, at the start of `text`, and its length.
fn parse_due_prefix(text: &str) -> Option<(DateTime, usize)> {
    let date = parse_date(text.get(..10)?)?;
    let time = text.get(10..16).and_then(|time| {
        let bytes = time.as_bytes();
        if !matches!(bytes[0], b' ' | b'T') || bytes[3] != b':' {
            return None;
        }
        if !time[1..3]
            .bytes()
            .chain(time[4..6].bytes())
            .all(|b| b.is_ascii_digit())
        {
            return None;
        }
        let hour: i8 = time[1..3].parse().ok()?;
        let minute: i8 = time[4..6].parse().ok()?;
        (hour <= 23 && minute <= 59).then_some((hour, minute))
    });
    match time {
        Some((hour, minute)) => Some((date.at(hour, minute, 0, 0), 16)),
        None => Some((date.at(9, 0, 0, 0), 10)),
    }
}

/// How a reminder time is written in a note: `YYYY-MM-DD HH:mm`.
pub(crate) fn format_due(at: DateTime) -> String {
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}",
        at.year(),
        at.month(),
        at.day(),
        at.hour(),
        at.minute()
    )
}

/// The lines of a body with their line breaks, and each line's content without them.
fn lines(body: &str) -> impl Iterator<Item = (&str, &str)> {
    body.split_inclusive('\n')
        .map(|line| (line, line.trim_end_matches(['\n', '\r'])))
}

/// The task lines of a body outside code fences, with their line numbers.
fn task_lines(body: &str) -> impl Iterator<Item = (usize, TaskLine)> + '_ {
    let mut fence: Option<&str> = None;
    lines(body)
        .enumerate()
        .filter_map(move |(index, (_, line))| {
            let trimmed = line.trim_start();
            let marker = ["```", "~~~"]
                .into_iter()
                .find(|marker| trimmed.starts_with(marker));
            match (fence, marker) {
                (None, Some(marker)) => {
                    fence = Some(marker);
                    return None;
                }
                (Some(open), Some(marker)) if open == marker => {
                    fence = None;
                    return None;
                }
                (Some(_), _) => return None,
                (None, None) => {}
            }
            TaskLine::parse(line).map(|task| (index, task))
        })
}

impl Store {
    /// Every to-do in every note: open ones first, by due time (none last), then by note `modified`, newest first.
    pub fn todos(&self) -> Result<Vec<Todo>, StoreError> {
        let mut found: Vec<(SystemTime, Todo)> = Vec::new();
        for entry in self.entries()? {
            let (meta, body) = match load(&entry) {
                Ok(note) => note,
                Err(StoreError::Io(error)) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            for (line, task) in task_lines(&body) {
                found.push((meta.modified, todo(&meta.title, line, task)));
            }
        }
        found.sort_by(|(a_modified, a), (b_modified, b)| {
            (
                a.done,
                a.due.is_none(),
                a.due,
                Reverse(a_modified),
                &a.note,
                a.line,
            )
                .cmp(&(
                    b.done,
                    b.due.is_none(),
                    b.due,
                    Reverse(b_modified),
                    &b.note,
                    b.line,
                ))
        });
        Ok(found.into_iter().map(|(_, todo)| todo).collect())
    }

    /// Checks or unchecks the to-do at `line` of `note`, if that line's text is still `text` (else
    /// `StoreError::Changed`); checking adds ` ✅ <today>`, unchecking removes it. Fails with `NotFound` when the
    /// note is gone. A to-do already in that state is left as it is.
    pub fn set_todo_done(
        &self,
        note: &str,
        line: usize,
        text: &str,
        done: bool,
        today: Date,
    ) -> Result<NoteMeta, StoreError> {
        let entry = self
            .find(&clean_title(note)?)?
            .ok_or(StoreError::NotFound)?;
        self.try_rewrite(entry, |body| {
            // `task_lines` skips code fences, so a task-looking line in one is not a to-do.
            let task = task_lines(body)
                .find(|(task_line, _)| *task_line == line)
                .map(|(_, task)| task)
                .filter(|task| task.text == text.trim())
                .ok_or(StoreError::Changed)?;
            if task.done == done {
                return Ok(None);
            }
            let mut out = String::with_capacity(body.len() + 16);
            for (index, (whole, content)) in lines(body).enumerate() {
                if index == line {
                    out.push_str(&toggled(content, &task, done, today));
                    out.push_str(&whole[content.len()..]);
                } else {
                    out.push_str(whole);
                }
            }
            Ok(Some(out))
        })
    }

    /// Appends `- [ ] text[ ⏰ due]` to `note` (default "待办"), creating the note with `source` as needed. The
    /// line goes right after a to-do at the end of the note, else after a blank line. Line breaks in `text`
    /// become spaces; an empty text fails with an `InvalidInput` I/O error.
    pub fn add_todo(
        &self,
        note: Option<&str>,
        text: &str,
        due: Option<DateTime>,
        source: Source,
    ) -> Result<Todo, StoreError> {
        let text = text.replace(['\r', '\n'], " ");
        let text = text.trim();
        if text.is_empty() {
            return Err(StoreError::Io(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a to-do needs text",
            )));
        }
        let mut new_line = format!("- [ ] {text}");
        if let Some(due) = due {
            new_line.push_str(&format!(" {REMINDER} {}", format_due(due)));
        }
        let title = clean_title(note.unwrap_or(DEFAULT_TODO_NOTE))?;

        let mut attempts = 0;
        let (meta, line) = loop {
            attempts += 1;
            match self.find(&title)? {
                Some(entry) => {
                    let mut line = 0;
                    let meta = self.rewrite(entry, |body| {
                        let (appended, index) = append_line(body, &new_line);
                        line = index;
                        appended
                    })?;
                    break (meta, line);
                }
                None => match self.create(&title, &format!("{new_line}\n"), source) {
                    Ok(meta) => break (meta, 0),
                    // Created by someone else in between: append to theirs.
                    Err(StoreError::AlreadyExists) if attempts < 3 => continue,
                    Err(error) => return Err(error),
                },
            }
        };
        let task = TaskLine::parse(&new_line).expect("a to-do line Jot wrote");
        Ok(todo(&meta.title, line, task))
    }
}

fn todo(note: &str, line: usize, task: TaskLine) -> Todo {
    Todo {
        note: note.to_owned(),
        line,
        text: task.text,
        done: task.done,
        due: task.due,
        done_on: task.done_on,
    }
}

/// `line` (without its line break) checked or unchecked.
fn toggled(line: &str, task: &TaskLine, done: bool, today: Date) -> String {
    if task.done == done {
        return line.to_owned();
    }
    let mut out = String::with_capacity(line.len() + 16);
    out.push_str(&line[..task.mark.start]);
    out.push(if done { 'x' } else { ' ' });
    let rest = task.mark.end;
    match &task.done_range {
        Some(range) => {
            out.push_str(&line[rest..range.start]);
            out.push_str(&line[range.end..]);
        }
        None => out.push_str(&line[rest..]),
    }
    if done {
        let kept = out.trim_end_matches([' ', '\t']).len();
        out.truncate(kept);
        out.push_str(&format!(" {DONE} {today}"));
    }
    out
}

/// `body` with `line` appended, and the new line's index.
fn append_line(body: &str, line: &str) -> (String, usize) {
    let kept = body.trim_end_matches(['\n', '\r']);
    if kept.trim().is_empty() {
        return (format!("{line}\n"), 0);
    }
    let newline = if body.contains("\r\n") { "\r\n" } else { "\n" };
    let count = kept.split('\n').count();
    let last = kept
        .rsplit('\n')
        .next()
        .unwrap_or(kept)
        .trim_end_matches('\r');
    if TaskLine::parse(last).is_some() {
        (format!("{kept}{newline}{line}{newline}"), count)
    } else {
        (
            format!("{kept}{newline}{newline}{line}{newline}"),
            count + 1,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::Duration;

    use jiff::civil::date;

    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        (dir, store)
    }

    fn touch(store: &Store, title: &str, seconds: u64) {
        let file = fs::File::options()
            .write(true)
            .open(store.root().join(format!("{title}.md")))
            .unwrap();
        file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(seconds))
            .unwrap();
    }

    #[test]
    fn task_lines_are_read() {
        // (line, done, text, due, done_on)
        type Case = (
            &'static str,
            bool,
            &'static str,
            Option<DateTime>,
            Option<Date>,
        );
        let cases: &[Case] = &[
            ("- [ ] 买牛奶", false, "买牛奶", None, None),
            ("- [x] 买牛奶", true, "买牛奶", None, None),
            (
                "- [X] 买牛奶 ✅ 2026-11-14",
                true,
                "买牛奶",
                None,
                Some(date(2026, 11, 14)),
            ),
            ("  * [ ] nested", false, "nested", None, None),
            ("+ [ ] plus", false, "plus", None, None),
            ("- [ ]", false, "", None, None),
            (
                "- [ ] 交房租 ⏰ 2026-11-14 09:00",
                false,
                "交房租",
                Some(date(2026, 11, 14).at(9, 0, 0, 0)),
                None,
            ),
            (
                "- [ ] 交 ⏰ 2026-11-14 18:30 房租",
                false,
                "交 房租",
                Some(date(2026, 11, 14).at(18, 30, 0, 0)),
                None,
            ),
            (
                "- [ ] 交房租 ⏰2026-11-14",
                false,
                "交房租",
                Some(date(2026, 11, 14).at(9, 0, 0, 0)),
                None,
            ),
            (
                "- [x] 交房租 ⏰ 2026-11-14 09:00 ✅ 2026-11-13",
                true,
                "交房租",
                Some(date(2026, 11, 14).at(9, 0, 0, 0)),
                Some(date(2026, 11, 13)),
            ),
            // A marker without a valid value stays in the text.
            ("- [ ] 交房租 ⏰ soon", false, "交房租 ⏰ soon", None, None),
            (
                "- [ ] 交房租 ⏰ 2026-13-01 09:00",
                false,
                "交房租 ⏰ 2026-13-01 09:00",
                None,
                None,
            ),
        ];
        for &(line, done, text, due, done_on) in cases {
            let task = TaskLine::parse(line).unwrap_or_else(|| panic!("{line:?}"));
            assert_eq!(
                (task.done, task.text.as_str(), task.due, task.done_on),
                (done, text, due, done_on),
                "{line:?}"
            );
        }
        for line in [
            "买牛奶",
            "- 买牛奶",
            "-[ ] x",
            "- [] x",
            "- [y] x",
            "- [ ]x",
            "1. [ ] x",
        ] {
            assert_eq!(TaskLine::parse(line), None, "{line:?}");
        }
    }

    #[test]
    fn todos_are_listed_in_order() {
        let (_dir, store) = store();
        fs::write(
            store.root().join("Work.md"),
            "---\ntags: x\n---\n# Work\n- [ ] 写周报 ⏰ 2026-11-14 09:00\n- [x] 发版 ✅ 2026-11-12\n\
             ```\n- [ ] in a fence\n```\n- [ ] 整理桌面\n",
        )
        .unwrap();
        fs::write(
            store.root().join("Home.md"),
            "- [ ] 交房租 ⏰ 2026-11-13 20:00\r\n- [ ] 买牛奶\r\n",
        )
        .unwrap();
        fs::write(store.root().join("Empty.md"), "nothing to do\n").unwrap();
        touch(&store, "Work", 200);
        touch(&store, "Home", 100);

        let todos = store.todos().unwrap();
        let summary: Vec<(&str, usize, &str, bool)> = todos
            .iter()
            .map(|todo| (todo.note.as_str(), todo.line, todo.text.as_str(), todo.done))
            .collect();
        assert_eq!(
            summary,
            [
                ("Home", 0, "交房租", false),
                ("Work", 1, "写周报", false),
                ("Work", 6, "整理桌面", false),
                ("Home", 1, "买牛奶", false),
                ("Work", 2, "发版", true),
            ]
        );
        assert_eq!(todos[4].done_on, Some(date(2026, 11, 12)));
    }

    #[test]
    fn checking_and_unchecking() {
        let (_dir, store) = store();
        let path = store.root().join("Work.md");
        fs::write(
            &path,
            "---\nsource: claude\n---\n- [ ] 写周报 ⏰ 2026-11-14 09:00\r\n- [ ] 发版\n",
        )
        .unwrap();
        let today = date(2026, 11, 13);

        store
            .set_todo_done("work", 0, "写周报", true, today)
            .unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "---\nsource: claude\n---\n- [x] 写周报 ⏰ 2026-11-14 09:00 ✅ 2026-11-13\r\n- [ ] 发版\n"
        );
        // Already checked: unchanged.
        store
            .set_todo_done("Work", 0, "写周报", true, date(2026, 11, 20))
            .unwrap();
        assert!(
            fs::read_to_string(&path)
                .unwrap()
                .contains("✅ 2026-11-13\r\n")
        );

        store
            .set_todo_done("Work", 0, "写周报", false, today)
            .unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "---\nsource: claude\n---\n- [ ] 写周报 ⏰ 2026-11-14 09:00\r\n- [ ] 发版\n"
        );

        // The last line has no break.
        fs::write(&path, "- [ ] 发版").unwrap();
        store.set_todo_done("Work", 0, "发版", true, today).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "- [x] 发版 ✅ 2026-11-13"
        );
    }

    #[test]
    fn a_changed_line_is_not_toggled() {
        let (_dir, store) = store();
        let path = store.root().join("Work.md");
        fs::write(&path, "intro\n- [ ] 发版\n").unwrap();
        let today = date(2026, 11, 13);
        for (line, text) in [(1, "写周报"), (0, "发版"), (5, "发版")] {
            assert!(matches!(
                store.set_todo_done("Work", line, text, true, today),
                Err(StoreError::Changed)
            ));
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), "intro\n- [ ] 发版\n");
        assert!(matches!(
            store.set_todo_done("Nope", 0, "发版", true, today),
            Err(StoreError::NotFound)
        ));
    }

    #[test]
    fn adding_todos() {
        let (_dir, store) = store();
        let due = date(2026, 11, 14).at(9, 0, 0, 0);

        // Creates 待办 with the source.
        let todo = store
            .add_todo(None, " 交房租\n给房东 ", Some(due), Source::Claude)
            .unwrap();
        assert_eq!(
            todo,
            Todo {
                note: "待办".to_owned(),
                line: 0,
                text: "交房租 给房东".to_owned(),
                done: false,
                due: Some(due),
                done_on: None,
            }
        );
        let path = store.root().join("待办.md");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "---\nsource: claude\n---\n- [ ] 交房租 给房东 ⏰ 2026-11-14 09:00\n"
        );

        // Right after the last to-do.
        let todo = store
            .add_todo(Some("待办"), "买牛奶", None, Source::User)
            .unwrap();
        assert_eq!(todo.line, 1);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "---\nsource: claude\n---\n- [ ] 交房租 给房东 ⏰ 2026-11-14 09:00\n- [ ] 买牛奶\n"
        );

        // After a blank line when the note ends with other text.
        let notes = store.root().join("Notes.md");
        fs::write(&notes, "# Notes\nsome text\n\n").unwrap();
        let todo = store
            .add_todo(Some("notes"), "回电话", None, Source::Claude)
            .unwrap();
        assert_eq!((todo.note.as_str(), todo.line), ("Notes", 3));
        assert_eq!(
            fs::read_to_string(&notes).unwrap(),
            "# Notes\nsome text\n\n- [ ] 回电话\n"
        );
        // The listing agrees with the returned line.
        let listed = store.todos().unwrap();
        assert!(listed.contains(&todo));

        assert!(matches!(
            store.add_todo(None, " \n", None, Source::User),
            Err(StoreError::Io(error)) if error.kind() == io::ErrorKind::InvalidInput
        ));
        assert!(matches!(
            store.add_todo(Some(".x"), "a", None, Source::User),
            Err(StoreError::InvalidTitle)
        ));
    }

    #[test]
    fn appending_lines() {
        assert_eq!(append_line("", "- [ ] a"), ("- [ ] a\n".to_owned(), 0));
        assert_eq!(append_line("\n\n", "- [ ] a"), ("- [ ] a\n".to_owned(), 0));
        assert_eq!(
            append_line("- [ ] x", "- [ ] a"),
            ("- [ ] x\n- [ ] a\n".to_owned(), 1)
        );
        assert_eq!(
            append_line("text\r\n", "- [ ] a"),
            ("text\r\n\r\n- [ ] a\r\n".to_owned(), 2)
        );
    }
}
