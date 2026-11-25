//! Moving every note to another folder (the settings' "Move to iCloud Drive"), never over a note there.

use std::fs;
use std::io;
use std::path::Path;

use crate::{Entry, Store, StoreError, clean_title, retry};

/// What [`Store::move_into`] did with each note.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct Moved {
    /// Notes moved under their own title.
    pub moved: Vec<String>,
    /// Notes moved under another title, `(title, new title)`: the folder had a different note of theirs
    /// (`Title 2`, `Title 3`…, as the sync services name a copy).
    pub renamed: Vec<(String, String)>,
    /// Notes left where they were because the folder has the very same note (the same text).
    pub same: Vec<String>,
    /// Notes left where they were, `(title, why)`: not downloaded yet, or the move failed.
    pub failed: Vec<(String, String)>,
}

impl Store {
    /// Moves every note of this folder into `to`, keeping its file (dates, frontmatter) as it is. A note never
    /// replaces one there: when `to` has its title, the same text is left here (`same`), another text moves in
    /// under the next free title (`renamed`). Files that are not notes stay. A note not downloaded yet is moved
    /// as it is when the move is a rename, else left (`failed`).
    pub fn move_into(&self, to: &Store) -> Result<Moved, StoreError> {
        let mut report = Moved::default();
        if to.root == self.root {
            return Ok(report);
        }
        for entry in self.entries()? {
            let title = entry.title.clone();
            match self.move_one(&entry, to) {
                Ok(Placed::Moved) => report.moved.push(title),
                Ok(Placed::Renamed(new)) => report.renamed.push((title, new)),
                Ok(Placed::Same) => report.same.push(title),
                Err(error) => report.failed.push((title, error.to_string())),
            }
        }
        Ok(report)
    }

    fn move_one(&self, entry: &Entry, to: &Store) -> Result<Placed, StoreError> {
        if entry.placeholder.is_some() {
            self.cloud.download(&entry.path);
            return Err(StoreError::NotDownloaded);
        }
        for n in 1..=1000 {
            let title = if n == 1 {
                entry.title.clone()
            } else {
                clean_title(&format!("{} {n}", entry.title))?
            };
            match to.find(&title)? {
                // A copy moved before (a move cut short) is the same note too.
                Some(existing) if same_text(self, &entry.path, to, &existing.path) => {
                    return Ok(Placed::Same);
                }
                Some(_) => {}
                None => match move_file(self, &entry.path, to, &to.path_for(&title)) {
                    Ok(()) if n == 1 => return Ok(Placed::Moved),
                    Ok(()) => return Ok(Placed::Renamed(title)),
                    // Taken between the look and the move.
                    Err(StoreError::AlreadyExists) => {}
                    Err(error) => return Err(error),
                },
            }
        }
        Err(StoreError::AlreadyExists)
    }
}

enum Placed {
    Moved,
    Renamed(String),
    Same,
}

/// Whether two note files hold the same text (both readable here).
fn same_text(from: &Store, a: &Path, to: &Store, b: &Path) -> bool {
    match (
        retry(|| from.cloud.read(a)).ok().flatten(),
        retry(|| to.cloud.read(b)).ok().flatten(),
    ) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// Moves the note file `from` to `dest`, never over a file there (`AlreadyExists`). Within a volume it is a
/// rename (a note not downloaded moves as it is); across volumes its text is written anew (dates kept) and the
/// old file removed.
fn move_file(store: &Store, from: &Path, to: &Store, dest: &Path) -> Result<(), StoreError> {
    match rename_new(from, dest) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return Err(StoreError::AlreadyExists);
        }
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {}
        Err(error) => return Err(error.into()),
    }
    let content = match retry(|| store.cloud.read(from))? {
        Some(content) => content,
        None => {
            store.cloud.download(from);
            return Err(StoreError::NotDownloaded);
        }
    };
    let metadata = retry(|| fs::metadata(from))?;
    to.write_file(dest, &content, None)?;
    fs::File::options()
        .write(true)
        .open(dest)?
        .set_modified(metadata.modified()?)?;
    fs::remove_file(from)?;
    Ok(())
}

/// Renames `from` to `to`, failing with `AlreadyExists` rather than replace a file there.
#[cfg(target_os = "macos")]
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int, c_uint};
    use std::os::unix::ffi::OsStrExt as _;

    /// `<stdio.h>`: fail with `EEXIST` when `to` exists.
    const RENAME_EXCL: c_uint = 0x0000_0004;
    unsafe extern "C" {
        fn renamex_np(from: *const c_char, to: *const c_char, flags: c_uint) -> c_int;
    }
    let from = CString::new(from.as_os_str().as_bytes())?;
    let to = CString::new(to.as_os_str().as_bytes())?;
    // SAFETY: two NUL-terminated paths that live through the call.
    if unsafe { renamex_np(from.as_ptr(), to.as_ptr(), RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    fs::rename(from, to)
}
