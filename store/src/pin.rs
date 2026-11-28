//! Pinned notes: `pinned: true` in a note's frontmatter keeps it at the top of the app's list.
//!
//! Pinning or unpinning is no change of the note: its modification time stays, as for a lock or an emoji, so it keeps
//! its place among the others once unpinned.

use crate::{NoteMeta, Store, StoreError, frontmatter};

/// The frontmatter key.
const KEY: &str = "pinned";

/// Whether a note's frontmatter says `pinned: true` (a top-level line, `true` in any case, quoted or not).
pub(crate) fn frontmatter_pinned(content: &str) -> bool {
    frontmatter::values(content, KEY).any(|value| value.eq_ignore_ascii_case("true"))
}

impl Store {
    /// Pins the note: `pinned: true` in its frontmatter (in place of a `pinned` line there), its modification time
    /// kept. A note pinned already stays as it is. Fails with `NotFound`, `NotDownloaded`, `Locked`, as every write
    /// does.
    pub fn pin(&self, title: &str) -> Result<NoteMeta, StoreError> {
        self.write_pinned(title, true)
    }

    /// Unpins the note: its `pinned` lines out of the frontmatter (a frontmatter left empty goes), its modification
    /// time kept. A note not pinned stays as it is. Fails as `pin` does.
    pub fn unpin(&self, title: &str) -> Result<NoteMeta, StoreError> {
        self.write_pinned(title, false)
    }

    fn write_pinned(&self, title: &str, on: bool) -> Result<NoteMeta, StoreError> {
        let entry = self.entry(title)?;
        let content = self.note_text(&entry)?;
        self.ensure_unlocked(&entry, Some(&content))?;
        // Pinned already: its lines stay as written (`pinned: True`, a comment).
        if !(on && frontmatter_pinned(&content)) {
            let changed = frontmatter::with_value(&content, KEY, on.then_some("true"));
            if changed != content {
                self.write_keeping_time(&entry.path, &changed)?;
            }
        }
        let (meta, _) = self.load(&entry)?;
        Ok(meta)
    }
}
