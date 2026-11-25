//! Moving a note to the system trash, and bringing it back.
//!
//! macOS: Foundation's file manager moves the file into the volume's trash and says where it went, so the note
//! comes back as the same file (Finder's "Put Back" moves it the same way). Elsewhere the `trash` crate moves it
//! (the freedesktop.org trash, the Recycle Bin), which says nothing of where; there the note comes back rebuilt
//! from its text, kept in memory, and the copy in the trash stays for the user to empty.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::{Entry, NoteMeta, Store, StoreError, clean_title};

/// A note moved to the system trash: what it takes to bring it back.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Trashed {
    /// The note's title (its file stem when it was trashed).
    pub title: String,
    /// Where it is in the trash, when the system says (macOS).
    pub in_trash: Option<PathBuf>,
    /// The whole file, frontmatter included: the note is rebuilt from it when the file cannot be moved back.
    pub content: String,
    /// The file's modification time: a rebuilt note keeps its place in the list.
    pub modified: SystemTime,
}

impl Store {
    /// Moves the note to the system trash. Fails with `NotFound`.
    pub fn trash(&self, title: &str) -> Result<Trashed, StoreError> {
        let entry = self
            .find(&clean_title(title)?)?
            .ok_or(StoreError::NotFound)?;
        // Its text goes along, to rebuild it from: a note not downloaded yet stays (`NotDownloaded`).
        let content = self.text(&entry).map_err(|error| match error {
            StoreError::Io(error) => not_found(error),
            error => error,
        })?;
        let modified = crate::retry(|| fs::metadata(&entry.path))?.modified()?;
        let in_trash = move_to_trash(&entry.path)?;
        Ok(Trashed {
            title: entry.title,
            in_trash,
            content,
            modified,
        })
    }

    /// Brings a trashed note back where it was: moved back out of the trash, or rebuilt from its text when the
    /// trash no longer has it (emptied, put back by hand) or the system does not say where it is. Fails with
    /// `AlreadyExists` when a note has its title now.
    pub fn restore(&self, trashed: &Trashed) -> Result<NoteMeta, StoreError> {
        let title = clean_title(&trashed.title)?;
        if self.find(&title)?.is_some() {
            return Err(StoreError::AlreadyExists);
        }
        let path = self.path_for(&title);
        let moved = match &trashed.in_trash {
            Some(from) if from.exists() => move_back(from, &path)?,
            _ => false,
        };
        if !moved {
            self.write_file(&path, &trashed.content, None)?;
            fs::File::options()
                .write(true)
                .open(&path)?
                .set_modified(trashed.modified)?;
        }
        let (meta, _) = self.load(&Entry::new(title, path))?;
        Ok(meta)
    }

    /// The note's file, if there is a note with this title (compared case-insensitively): its placeholder for a
    /// note an older iCloud Drive has not downloaded.
    pub fn path(&self, title: &str) -> Result<Option<PathBuf>, StoreError> {
        Ok(self
            .find(&clean_title(title)?)?
            .map(|entry| entry.file().to_owned()))
    }
}

/// A file gone between the listing and the read is a note not found.
fn not_found(error: io::Error) -> StoreError {
    if error.kind() == io::ErrorKind::NotFound {
        StoreError::NotFound
    } else {
        StoreError::Io(error)
    }
}

/// Moves `path` to the trash; returns where it went.
///
/// `NSFileManager`'s shared instance may be called from any thread (Apple's documentation of `FileManager`),
/// so this runs where the store is called, without a hop to the main thread.
#[cfg(target_os = "macos")]
fn move_to_trash(path: &Path) -> Result<Option<PathBuf>, StoreError> {
    use objc2_foundation::{NSFileManager, NSURL};

    let url = NSURL::from_file_path(path)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "not a file path"))?;
    let mut resulting = None;
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, Some(&mut resulting))
        .map_err(|error| io::Error::other(error.localizedDescription().to_string()))?;
    Ok(resulting.and_then(|url| url.to_file_path()))
}

#[cfg(not(target_os = "macos"))]
fn move_to_trash(path: &Path) -> Result<Option<PathBuf>, StoreError> {
    trash::delete(path).map_err(|error| io::Error::other(error.to_string()))?;
    Ok(None)
}

/// Moves `from` (in the trash) to `to`, never over a file there. Returns false when `from` is gone (the note is
/// then rebuilt).
#[cfg(target_os = "macos")]
fn move_back(from: &Path, to: &Path) -> Result<bool, StoreError> {
    use objc2_foundation::{NSFileManager, NSURL};

    let (Some(from_url), Some(to_url)) = (NSURL::from_file_path(from), NSURL::from_file_path(to))
    else {
        return Ok(false);
    };
    // `moveItemAtURL:toURL:error:` fails rather than replace a file at the destination.
    match NSFileManager::defaultManager().moveItemAtURL_toURL_error(&from_url, &to_url) {
        Ok(()) => Ok(true),
        Err(_) if to.exists() => Err(StoreError::AlreadyExists),
        Err(_) if !from.exists() => Ok(false),
        Err(error) => Err(io::Error::other(error.localizedDescription().to_string()).into()),
    }
}

/// The trash crate does not say where a file went, so nothing is moved back here.
#[cfg(not(target_os = "macos"))]
fn move_back(_from: &Path, _to: &Path) -> Result<bool, StoreError> {
    Ok(false)
}
