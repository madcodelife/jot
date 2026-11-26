//! Importing notes from another app (the settings' "Import from Apple Notes"): each note written once as a new
//! note, never over one here, marked with where it came from so importing again adds only the new ones.

use std::collections::HashSet;
use std::io::{self, Write as _};
use std::time::SystemTime;

use crate::source::{top_level_string, yaml_string};
use crate::{EXTENSION, MAX_FILE_NAME_BYTES, Store, StoreError, clean_title, split};

/// The frontmatter key an imported note keeps its Apple Notes id under (`x-coredata://…/ICNote/p123`).
pub const APPLE_NOTES_ID: &str = "apple-notes-id";
/// The frontmatter key an imported note keeps its Apple Notes folder under.
const FOLDER: &str = "folder";
/// The title a note with none (or none a file can have) is imported under.
const UNTITLED: &str = "Untitled";
/// Room left in a title for the number a taken one gets (` 1000`).
const NUMBER_ROOM: usize = 5;

/// A note to import, its body already Markdown.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportNote {
    /// Its id in the app it comes from, kept as `apple-notes-id`: a note whose id is in the folder already is not
    /// imported again.
    pub id: String,
    /// Its title there; made a file's name here as every title is (`/` → `-`, …).
    pub title: String,
    /// Its text, Markdown, without the title.
    pub body: String,
    /// The folder it is in there, kept as `folder`.
    pub folder: Option<String>,
    /// When it was last changed there: the file's modification time, so the list orders it as that app did.
    pub modified: SystemTime,
}

/// What [`Store::import`] did with each note.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct Imported {
    /// The notes written under their own titles (as written: cleaned as every title is).
    pub imported: Vec<String>,
    /// The notes written under another title, `(title, title written)`: the folder had a different note of theirs
    /// (`Title 2`, `Title 3`…).
    pub renamed: Vec<(String, String)>,
    /// The notes left out because the folder has them already (their id, from an earlier import).
    pub already: Vec<String>,
    /// The notes left out for now because a note with their title is not downloaded to this Mac: it may be the
    /// very note, imported before. It is being downloaded; importing again later brings them in.
    pub waiting: Vec<String>,
    /// The notes left out, `(title, why)`: writing them failed.
    pub failed: Vec<(String, String)>,
}

impl Store {
    /// Writes each note as a new note: `apple-notes-id` and `folder` in its frontmatter, the body after it, the
    /// file's modification time its `modified`. Nothing here is ever changed: a note whose id a note of the folder
    /// has already is left out (`already`), and a title taken by another note is numbered (`Title 2`, as
    /// [`Store::move_into`] does). A title taken by a note not downloaded yet leaves the note out for now
    /// (`waiting`): that one cannot be read to tell whether it is the same note. Fails only when the folder cannot
    /// be read; a note that cannot be written is reported in `failed`.
    pub fn import(&self, notes: &[ImportNote]) -> Result<Imported, StoreError> {
        let mut report = Imported::default();
        // The ids imported before, and the titles taken (lowercase: titles compare case-insensitively), with
        // whether that note could be read.
        let mut ids = HashSet::new();
        let mut taken = HashSet::new();
        let mut unread = HashSet::new();
        for entry in self.entries()? {
            let lower = entry.title.to_lowercase();
            match self.text(&entry) {
                Ok(content) => {
                    if let Some(id) = imported_id(&content) {
                        ids.insert(id);
                    }
                    taken.insert(lower);
                }
                Err(StoreError::NotDownloaded) => {
                    unread.insert(lower);
                }
                // Gone between the listing and the read.
                Err(StoreError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }

        for note in notes {
            let id = one_line(&note.id);
            if ids.contains(&id) {
                report.already.push(note.title.clone());
                continue;
            }
            let base = import_title(&note.title);
            let content = import_content(note);
            let mut placed = None;
            for n in 1..=1000 {
                let title = if n == 1 {
                    base.clone()
                } else {
                    format!("{base} {n}")
                };
                let lower = title.to_lowercase();
                if unread.contains(&lower) {
                    placed = Some(Err(StoreError::NotDownloaded));
                    break;
                }
                if taken.contains(&lower) {
                    continue;
                }
                match self.write_new(&title, &content, note.modified) {
                    Ok(()) => {
                        taken.insert(lower);
                        placed = Some(Ok((title, n)));
                        break;
                    }
                    // Taken since the folder was read.
                    Err(StoreError::AlreadyExists) => {
                        taken.insert(lower);
                    }
                    Err(error) => {
                        placed = Some(Err(error));
                        break;
                    }
                }
            }
            match placed.unwrap_or(Err(StoreError::AlreadyExists)) {
                Ok((title, n)) => {
                    ids.insert(id);
                    if n == 1 {
                        report.imported.push(title);
                    } else {
                        report.renamed.push((note.title.clone(), title));
                    }
                }
                Err(StoreError::NotDownloaded) => report.waiting.push(note.title.clone()),
                Err(error) => report.failed.push((note.title.clone(), error.to_string())),
            }
        }
        Ok(report)
    }

    /// Writes a new note file for `title` (never over a file there: `AlreadyExists`), with this modification
    /// time, set before the rename so the note never shows another.
    fn write_new(
        &self,
        title: &str,
        content: &str,
        modified: SystemTime,
    ) -> Result<(), StoreError> {
        let mut builder = tempfile::Builder::new();
        builder.prefix(".jot-").suffix(".tmp");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            builder.permissions(std::fs::Permissions::from_mode(0o644));
        }
        let mut file = builder.tempfile_in(&self.root)?;
        file.write_all(content.as_bytes())?;
        file.as_file().sync_all()?;
        file.as_file().set_modified(modified)?;
        file.persist_noclobber(self.path_for(title))
            .map_err(|error| {
                if error.error.kind() == io::ErrorKind::AlreadyExists {
                    StoreError::AlreadyExists
                } else {
                    StoreError::Io(error.error)
                }
            })?;
        Ok(())
    }
}

/// The `apple-notes-id` a note's frontmatter records, if any.
fn imported_id(content: &str) -> Option<String> {
    split(content)
        .frontmatter?
        .lines()
        .find_map(|line| top_level_string(line, APPLE_NOTES_ID))
        .filter(|id| !id.is_empty())
}

/// The title a note is imported under: cleaned as every title is, without leading dots (a hidden file), cut to
/// leave room for a number, `Untitled` when nothing is left.
fn import_title(title: &str) -> String {
    let max = MAX_FILE_NAME_BYTES - EXTENSION.len() - 1 - NUMBER_ROOM;
    let trimmed = title.trim().trim_start_matches('.');
    let mut cut = String::new();
    for c in trimmed.chars() {
        if cut.len() + c.len_utf8() > max {
            break;
        }
        cut.push(c);
    }
    clean_title(&cut).unwrap_or_else(|_| UNTITLED.to_owned())
}

/// The note's file: its frontmatter, then its body ending with a line break.
fn import_content(note: &ImportNote) -> String {
    let mut content = String::from("---\n");
    content.push_str(&format!(
        "{APPLE_NOTES_ID}: {}\n",
        yaml_string(&one_line(&note.id))
    ));
    if let Some(folder) = note.folder.as_deref().map(one_line)
        && !folder.is_empty()
    {
        content.push_str(&format!("{FOLDER}: {}\n", yaml_string(&folder)));
    }
    content.push_str("---\n");
    let body = note.body.trim_end_matches(['\n', '\r']);
    if !body.trim().is_empty() {
        content.push_str(body);
        content.push('\n');
    }
    content
}

/// `text` on one line: control characters as spaces, trimmed.
fn one_line(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_owned()
}
