//! Locked notes.
//!
//! A note is locked by two marks, kept in step:
//!
//! - the file's *locked* flag (`UF_IMMUTABLE`, `chflags uchg`; Finder's Get Info › Locked): the system refuses to
//!   change, rename, move or delete the file, whoever asks (`rm`, `rm -f`, `mv`, a write, a rename over it, the
//!   trash), short of clearing the flag first, which the file's owner may do (`chflags nouchg`, Finder);
//! - `locked: true` in the frontmatter, which travels with the text: a sync service does not carry the flag
//!   (iCloud Drive clears it when it uploads the file's new contents), so the flag is put back from it.
//!
//! Either one makes the note locked: every write of the store fails with [`StoreError::Locked`] and leaves the file
//! as it is. [`Store::settle_locks`] puts the missing mark back: the flag on a note whose frontmatter says locked
//! (synced from another Mac, or cleared by the sync service), the frontmatter on a note locked in Finder.

use std::fs;
use std::io;
use std::path::Path;

use crate::{Entry, NoteMeta, Store, StoreError, clean_title, retry, split};

/// The frontmatter key.
const KEY: &str = "locked";

impl Store {
    /// Locks the note: `locked: true` in its frontmatter (its modification time kept) and the file's locked flag.
    /// A note locked already stays as it is. Fails with `NotFound`, `NotDownloaded`.
    pub fn lock(&self, title: &str) -> Result<NoteMeta, StoreError> {
        let entry = self.entry(title)?;
        let content = self.note_text(&entry)?;
        if !frontmatter_locked(&content) {
            self.rewrite_locked(&entry, &with_locked(&content, true))?;
        }
        set_flag(&entry.path, true)?;
        let (meta, _) = self.load(&entry)?;
        Ok(meta)
    }

    /// Unlocks the note: the flag cleared, `locked` taken out of the frontmatter (its modification time kept).
    /// Fails with `NotFound`, `NotDownloaded`.
    pub fn unlock(&self, title: &str) -> Result<NoteMeta, StoreError> {
        let entry = self.entry(title)?;
        let content = self.note_text(&entry)?;
        let flagged = has_flag(&entry.path)?;
        if flagged {
            set_flag(&entry.path, false)?;
        }
        if frontmatter_locked(&content)
            && let Err(error) = self.write_keeping_time(&entry.path, &with_locked(&content, false))
        {
            // Still locked by its frontmatter: the flag goes back too.
            if flagged {
                let _ = set_flag(&entry.path, true);
            }
            return Err(error);
        }
        let (meta, _) = self.load(&entry)?;
        Ok(meta)
    }

    /// Brings the two marks of every locked note in line: the flag on a note whose frontmatter says `locked: true`,
    /// `locked: true` on a note with the flag (locked in Finder). Notes not on this Mac wait. Returns the titles it
    /// changed. The app calls it as the folder changes.
    pub fn settle_locks(&self) -> Result<Vec<String>, StoreError> {
        let mut settled = Vec::new();
        for entry in self.entries()? {
            match self.settle_lock(&entry) {
                Ok(true) => settled.push(entry.title),
                Ok(false) => {}
                // Gone, or not here yet: the next change looks again.
                Err(StoreError::NotDownloaded | StoreError::NotFound) => {}
                Err(StoreError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        Ok(settled)
    }

    /// Settles the marks of one note (`settle_locks`); true when it changed them.
    pub(crate) fn settle_lock_of(&self, entry: &Entry) -> Result<bool, StoreError> {
        self.settle_lock(entry)
    }

    fn settle_lock(&self, entry: &Entry) -> Result<bool, StoreError> {
        if entry.placeholder.is_some() {
            return Ok(false);
        }
        let metadata = retry(|| fs::metadata(&entry.path))?;
        if self.cloud.is_dataless(&entry.path, &metadata) {
            return Ok(false);
        }
        let flagged = flag_of(&metadata);
        let content = self.note_text(entry)?;
        match (flagged, frontmatter_locked(&content)) {
            (true, false) => {
                self.rewrite_locked(entry, &with_locked(&content, true))?;
                Ok(true)
            }
            (false, true) => {
                set_flag(&entry.path, true)?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    /// Fails with `Locked` when the note is locked: by the file's flag, or by `content`'s frontmatter when it is
    /// read (`None`: the flag alone, for a note not on this Mac).
    pub(crate) fn ensure_unlocked(
        &self,
        entry: &Entry,
        content: Option<&str>,
    ) -> Result<(), StoreError> {
        let flagged = match retry(|| fs::metadata(entry.file())) {
            Ok(metadata) => flag_of(&metadata),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(StoreError::NotFound);
            }
            Err(error) => return Err(error.into()),
        };
        let content = match content {
            Some(content) => Some(content.to_owned()),
            None if entry.placeholder.is_none() => retry(|| self.cloud.read(&entry.path))?,
            None => None,
        };
        if flagged || content.as_deref().is_some_and(frontmatter_locked) {
            return Err(StoreError::Locked);
        }
        Ok(())
    }

    fn entry(&self, title: &str) -> Result<Entry, StoreError> {
        self.find(&clean_title(title)?)?.ok_or(StoreError::NotFound)
    }

    /// The note's whole text; a file gone meanwhile is `NotFound`.
    pub(crate) fn note_text(&self, entry: &Entry) -> Result<String, StoreError> {
        self.text(entry).map_err(|error| match error {
            StoreError::Io(error) if error.kind() == io::ErrorKind::NotFound => {
                StoreError::NotFound
            }
            error => error,
        })
    }

    /// Writes `content` over a note that may carry the flag: the flag is cleared for the write and put back after
    /// it, also when the write fails. The modification time stays.
    fn rewrite_locked(&self, entry: &Entry, content: &str) -> Result<(), StoreError> {
        let flagged = has_flag(&entry.path)?;
        if flagged {
            set_flag(&entry.path, false)?;
        }
        let written = self.write_keeping_time(&entry.path, content);
        if flagged {
            set_flag(&entry.path, true)?;
        }
        written
    }

    /// Writes `content` over the file at `path`, its permissions and modification time kept.
    fn write_keeping_time(&self, path: &Path, content: &str) -> Result<(), StoreError> {
        let metadata = retry(|| fs::metadata(path))?;
        self.write_file_at(path, content, metadata.permissions(), metadata.modified()?)
    }
}

/// Whether the file has the locked flag.
pub(crate) fn has_flag(path: &Path) -> io::Result<bool> {
    Ok(flag_of(&retry(|| fs::metadata(path))?))
}

/// Whether a note's frontmatter says `locked: true`.
pub(crate) fn frontmatter_locked(content: &str) -> bool {
    split(content).frontmatter.is_some_and(|frontmatter| {
        frontmatter
            .lines()
            .filter_map(top_level_value)
            .any(|value| value.eq_ignore_ascii_case("true"))
    })
}

/// The value of a top-level `locked:` line, unquoted and without a trailing comment.
fn top_level_value(line: &str) -> Option<&str> {
    let rest = line.strip_prefix(KEY)?.trim_start();
    let value = rest.strip_prefix(':')?;
    let value = match value.find(" #") {
        Some(at) => &value[..at],
        None => value,
    };
    let value = value.trim();
    Some(
        value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value),
    )
}

/// `content` with `locked: true` in its frontmatter (`on`), or without a `locked` line (a frontmatter left empty
/// goes). The rest of the frontmatter and the body stay as they are.
pub(crate) fn with_locked(content: &str, on: bool) -> String {
    let parts = split(content);
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let Some(frontmatter) = parts.frontmatter else {
        return if on {
            format!("---{newline}{KEY}: true{newline}---{newline}{content}")
        } else {
            content.to_owned()
        };
    };
    let mut lines: Vec<&str> = frontmatter
        .split_inclusive('\n')
        .filter(|line| top_level_value(line.trim_end_matches(['\n', '\r'])).is_none())
        .collect();
    let added = format!("{KEY}: true{newline}");
    if on {
        lines.push(&added);
    }
    let kept: String = lines.concat();
    // What follows the closing `---` line.
    let closing = &parts.header[parts.header.len() - closing_len(parts.header)..];
    if kept.trim().is_empty() {
        return parts.body.to_owned();
    }
    let mut out = String::with_capacity(content.len() + added.len());
    out.push_str(&parts.header[..parts.header.len() - frontmatter.len() - closing.len()]);
    out.push_str(&kept);
    if !kept.ends_with('\n') {
        out.push_str(newline);
    }
    out.push_str(closing);
    out.push_str(parts.body);
    out
}

/// The length of the header's closing `---` line, its line break included.
fn closing_len(header: &str) -> usize {
    let without_break = header.trim_end_matches(['\n', '\r']);
    header.len() - without_break.len() + 3
}

#[cfg(target_os = "macos")]
fn flag_of(metadata: &fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt as _;

    /// `<sys/stat.h>`: the file may not be changed.
    const UF_IMMUTABLE: u32 = 0x0000_0002;
    metadata.st_flags() & UF_IMMUTABLE != 0
}

/// Other systems have no flag the owner sets: the frontmatter alone locks a note there.
#[cfg(not(target_os = "macos"))]
fn flag_of(_metadata: &fs::Metadata) -> bool {
    false
}

/// Sets or clears the file's locked flag, keeping its other flags.
#[cfg(target_os = "macos")]
pub(crate) fn set_flag(path: &Path, on: bool) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::macos::fs::MetadataExt as _;
    use std::os::raw::{c_char, c_int, c_uint};
    use std::os::unix::ffi::OsStrExt as _;

    const UF_IMMUTABLE: u32 = 0x0000_0002;
    unsafe extern "C" {
        fn chflags(path: *const c_char, flags: c_uint) -> c_int;
    }
    let flags = retry(|| fs::metadata(path))?.st_flags();
    let wanted = if on {
        flags | UF_IMMUTABLE
    } else {
        flags & !UF_IMMUTABLE
    };
    if wanted == flags {
        return Ok(());
    }
    let path = CString::new(path.as_os_str().as_bytes())?;
    retry(|| {
        // SAFETY: a NUL-terminated path that lives through the call.
        if unsafe { chflags(path.as_ptr(), wanted) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    })
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_flag(_path: &Path, _on: bool) -> io::Result<()> {
    Ok(())
}

/// For `NoteMeta::locked`: the flag, or the frontmatter when the text is here.
pub(crate) fn is_locked(metadata: &fs::Metadata, content: Option<&str>) -> bool {
    flag_of(metadata) || content.is_some_and(frontmatter_locked)
}
