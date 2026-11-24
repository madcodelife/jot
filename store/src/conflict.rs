//! Conflicts: the other versions a sync service (iCloud Drive) kept when a note changed on two devices at once,
//! and the user's choice among them. Nothing is lost until the user chooses: the file keeps one version, the
//! service keeps the others.

use std::fs;
use std::io;
use std::time::SystemTime;

use crate::{Entry, NoteMeta, Store, StoreError, clean_title, retry, split};

/// Another version of a note, kept by the sync service in a conflict.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Conflict {
    /// What [`Store::resolve`] takes.
    pub id: String,
    /// The device it was saved on ("Floyd’s iPhone"), when the service says.
    pub device: Option<String>,
    /// When it was saved.
    pub modified: SystemTime,
    /// Its text after the frontmatter.
    pub body: String,
}

/// What to do with a conflict version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    /// The note stays as it is; the other version goes.
    KeepCurrent,
    /// The other version becomes the note (the note's text it replaces goes).
    UseOther,
    /// The other version becomes a note of its own, titled `title` (made unique: `title 2`, `title 3`…, as the
    /// sync services name a copy); the note stays as it is.
    KeepBoth {
        /// The new note's title.
        title: String,
    },
}

/// What [`Store::resolve`] did.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct Resolved {
    /// The note.
    pub note: NoteMeta,
    /// The other version's own note, for [`Resolution::KeepBoth`].
    pub copy: Option<NoteMeta>,
}

impl Store {
    /// The other versions of the note a sync service kept in a conflict, newest first; empty when there are none
    /// (or the note is not downloaded yet). A version whose text cannot be read is left out.
    pub fn conflicts(&self, title: &str) -> Result<Vec<Conflict>, StoreError> {
        let Some(entry) = self.find(&clean_title(title)?)? else {
            return Err(StoreError::NotFound);
        };
        if entry.placeholder.is_some() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for version in self.cloud.conflicts(&entry.path)? {
            let Ok(content) = retry(|| fs::read_to_string(&version.file)) else {
                continue;
            };
            out.push(Conflict {
                id: version.id,
                device: version.device,
                modified: version.modified,
                body: split(&content).body.to_owned(),
            });
        }
        Ok(out)
    }

    /// Settles the conflict version `id` of the note as `resolution` says. Fails with `NotFound` when the note is
    /// gone, `Changed` when the version is no longer in conflict (settled here or on another device), and
    /// `NotDownloaded` when the note is not on this Mac.
    pub fn resolve(
        &self,
        title: &str,
        id: &str,
        resolution: Resolution,
    ) -> Result<Resolved, StoreError> {
        let entry = self
            .find(&clean_title(title)?)?
            .ok_or(StoreError::NotFound)?;
        if entry.placeholder.is_some() {
            self.cloud.download(&entry.path);
            return Err(StoreError::NotDownloaded);
        }
        let version = self
            .cloud
            .conflicts(&entry.path)?
            .into_iter()
            .find(|version| version.id == id)
            .ok_or(StoreError::Changed)?;
        let mut copy = None;
        match resolution {
            Resolution::KeepCurrent => {}
            Resolution::UseOther => {
                // The whole file, frontmatter included: the version is the note as the other device saved it.
                let content = retry(|| fs::read_to_string(&version.file))?;
                let permissions = retry(|| fs::metadata(&entry.path))?.permissions();
                self.write_file(&entry.path, &content, Some(permissions))?;
            }
            Resolution::KeepBoth { title } => {
                let content = retry(|| fs::read_to_string(&version.file))?;
                copy = Some(self.create_copy(&title, &content, version.modified)?);
            }
        }
        self.cloud.resolve(&entry.path, id)?;
        let (note, _) = self.load(&entry)?;
        Ok(Resolved { note, copy })
    }

    /// Writes `content` (frontmatter included) as a new note titled `title`, or `title 2`, `title 3`… when taken,
    /// modified at `modified`.
    fn create_copy(
        &self,
        title: &str,
        content: &str,
        modified: SystemTime,
    ) -> Result<NoteMeta, StoreError> {
        let base = clean_title(title)?;
        for n in 1..1000 {
            let title = if n == 1 {
                base.clone()
            } else {
                clean_title(&format!("{base} {n}"))?
            };
            if self.find(&title)?.is_some() {
                continue;
            }
            let path = self.path_for(&title);
            match self.write_file(&path, content, None) {
                Err(StoreError::AlreadyExists) => continue,
                result => result?,
            }
            fs::File::options()
                .write(true)
                .open(&path)?
                .set_modified(modified)?;
            let (meta, _) = self.load(&Entry::new(title, path))?;
            return Ok(meta);
        }
        Err(StoreError::Io(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "no free title for the copy",
        )))
    }
}
