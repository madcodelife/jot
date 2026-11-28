//! Links between notes: `[[Title]]`, or `[[Title|words]]` to show other words, as Notational Velocity, nvALT and
//! Obsidian write them.
//!
//! A link sits on one line, outside fenced and inline code. Its title (before the first `|`, trimmed) names a note as
//! a title does anywhere in the store: in any case, and with the characters a file name cannot hold standing for `-`
//! (`[[a/b]]` is the note `a-b`). Its title holds no `[`, `]` or `|`, and its words no `[` or `]`; the open note's
//! live preview reads the same links (`app/markdown.ts`'s `noteLinks`).
//!
//! Renaming a note points the links to it at the new title ([`Store::rename_links`]): each note is rewritten as one
//! atomic write, its modification time kept (a link following a rename is no change of the note: it keeps its place in
//! the list). A locked note keeps its links as they are, and they are counted; a note not on this Mac yet is left as it
//! is, and not asked for.

use std::ops::Range;

use crate::todo::fence_run;
use crate::{Store, StoreError, clean_title, compose, retry, split};

/// What [`Store::rename_links`] changed, and what it left.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Relinked {
    /// The notes rewritten.
    pub notes: usize,
    /// The links pointed at the new title, in those notes.
    pub links: usize,
    /// The locked notes with links to the old title, left as they are.
    pub locked_notes: usize,
    /// The links in those notes, which kept the old title.
    pub locked_links: usize,
}

/// Whether `title` can be a link's: it holds none of the characters that end one.
pub fn linkable(title: &str) -> bool {
    !title.contains(['[', ']', '|', '\n', '\r'])
}

/// The titles of the links on `line` (a line outside fenced code), as byte ranges of the line, trimmed.
pub(crate) fn link_titles(line: &str) -> Vec<Range<usize>> {
    let bytes = line.as_bytes();
    let mut out = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            // A code span: what is in it is no link. A run of backticks with no run as long after it is text.
            b'`' => {
                let run = bytes[at..].iter().take_while(|b| **b == b'`').count();
                at += run;
                if let Some(end) = closing_run(bytes, at, run) {
                    at = end;
                }
            }
            b'[' if bytes.get(at + 1) == Some(&b'[') => match link_at(line, at) {
                Some((title, end)) => {
                    out.push(title);
                    at = end;
                }
                None => at += 1,
            },
            _ => at += 1,
        }
    }
    out
}

/// Where the run of exactly `run` backticks after `from` ends, if there is one.
fn closing_run(bytes: &[u8], from: usize, run: usize) -> Option<usize> {
    let mut at = from;
    while at < bytes.len() {
        if bytes[at] != b'`' {
            at += 1;
            continue;
        }
        let length = bytes[at..].iter().take_while(|b| **b == b'`').count();
        if length == run {
            return Some(at + length);
        }
        at += length;
    }
    None
}

/// The link starting at `start` (its `[[`): its title, trimmed, and where it ends (after its `]]`).
fn link_at(line: &str, start: usize) -> Option<(Range<usize>, usize)> {
    let inner = start + 2;
    let close = inner + line[inner..].find(['[', ']'])?;
    if !line[close..].starts_with("]]") {
        return None;
    }
    let (title_end, words) = match line[inner..close].find('|') {
        Some(pipe) => (inner + pipe, Some(&line[inner + pipe + 1..close])),
        None => (close, None),
    };
    if words.is_some_and(str::is_empty) {
        return None;
    }
    let raw = &line[inner..title_end];
    let title_start = inner + (raw.len() - raw.trim_start().len());
    let title = title_start..inner + raw.trim_end().len();
    (!title.is_empty()).then_some((title, close + 2))
}

/// `body` with its links to the note titled `from` pointed at `to`, and how many there were.
pub(crate) fn relinked(body: &str, from: &str, to: &str) -> (String, usize) {
    let key = from.to_lowercase();
    let names = |title: &str| clean_title(title).is_ok_and(|t| t.to_lowercase() == key);
    let mut out = String::with_capacity(body.len());
    let mut count = 0;
    let mut fence: Option<&str> = None;
    for line in body.split_inclusive('\n') {
        let content = line.trim_end_matches(['\n', '\r']);
        let run = fence_run(content);
        match (fence, run) {
            (None, Some(run)) => fence = Some(run),
            (Some(open), Some(run))
                if run.as_bytes()[0] == open.as_bytes()[0]
                    && run.len() >= open.len()
                    && content.trim() == run =>
            {
                fence = None
            }
            (Some(_), _) => {}
            (None, None) => {
                let mut kept = 0;
                for title in link_titles(content) {
                    if !names(&content[title.clone()]) {
                        continue;
                    }
                    out.push_str(&line[kept..title.start]);
                    out.push_str(to);
                    kept = title.end;
                    count += 1;
                }
                out.push_str(&line[kept..]);
                continue;
            }
        }
        out.push_str(line);
    }
    (out, count)
}

impl Store {
    /// Points every link to the note titled `from` at `to`, its new title: `[[from]]` becomes `[[to]]`, and
    /// `[[from|words]]` `[[to|words]]` (the title matched in any case). Each note changed is written atomically, its
    /// modification time kept. A locked note is left as it is, and counted with its links (`locked_notes`,
    /// `locked_links`); a note not on this Mac yet is left too. Nothing changes when `to` cannot be a link's title
    /// (it holds `[`, `]` or `|`). Call it after `rename`.
    pub fn rename_links(&self, from: &str, to: &str) -> Result<Relinked, StoreError> {
        let from = clean_title(from)?;
        let to = clean_title(to)?;
        let mut done = Relinked::default();
        if !linkable(&to) || from == to {
            return Ok(done);
        }
        for entry in self.entries()? {
            if entry.placeholder.is_some() {
                continue;
            }
            // Read without asking for a download: a note not here keeps its links.
            let content = match retry(|| self.cloud.read(&entry.path)) {
                Ok(Some(content)) => content,
                Ok(None) => continue,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            let parts = split(&content);
            let (body, count) = relinked(parts.body, &from, &to);
            if count == 0 {
                continue;
            }
            match self.ensure_unlocked(&entry, Some(&content)) {
                Ok(()) => {}
                Err(StoreError::Locked) => {
                    done.locked_notes += 1;
                    done.locked_links += count;
                    continue;
                }
                Err(StoreError::NotFound) => continue,
                Err(error) => return Err(error),
            }
            self.write_keeping_time(&entry.path, &compose(parts.header, &body))?;
            done.notes += 1;
            done.links += count;
        }
        Ok(done)
    }
}
