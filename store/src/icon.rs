//! A note's emoji: `icon: "🍕"` in its frontmatter, shown before its title.
//!
//! Only one emoji counts (one grapheme cluster that is an emoji: `🍕`, `❤️`, `👩🏽‍💻`, `🇯🇵`, `1️⃣`); any other value
//! (text, two emoji, a number) is no icon. Setting or clearing it is no change of the note: its modification time
//! stays, as for a lock, so the list keeps its order.

use std::fmt;

use unicode_properties::UnicodeEmoji as _;
use unicode_segmentation::UnicodeSegmentation as _;

use crate::{NoteMeta, Store, StoreError, frontmatter};

/// The frontmatter key.
const KEY: &str = "icon";
/// The longest emoji taken, in bytes: a family or a flag of tags is under 40.
const MAX_BYTES: usize = 64;
/// COMBINING ENCLOSING KEYCAP: `1️⃣` is `1`, VS16 and it.
const KEYCAP: char = '\u{20E3}';

/// One emoji, as a note's icon.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Icon(String);

impl Icon {
    /// `text`, trimmed, when it is one emoji; `None` for anything else (empty, text, two emoji).
    pub fn parse(text: &str) -> Option<Icon> {
        let text = text.trim();
        if text.is_empty() || text.len() > MAX_BYTES || text.graphemes(true).nth(1).is_some() {
            return None;
        }
        let first = text.chars().next()?;
        let emoji = if first.is_ascii() {
            // `#`, `*` and the digits are emoji only as keycaps.
            text.contains(KEYCAP)
        } else {
            first.is_emoji_char()
        };
        (emoji && !text.chars().any(char::is_whitespace)).then(|| Icon(text.to_owned()))
    }

    /// The emoji.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Icon {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// The icon a note's text names: its frontmatter's first top-level `icon` value, when that is one emoji.
pub(crate) fn icon_of(content: &str) -> Option<String> {
    frontmatter::values(content, KEY)
        .next()
        .and_then(Icon::parse)
        .map(|icon| icon.0)
}

impl Store {
    /// Gives the note this emoji: `icon: "<emoji>"` in its frontmatter (in place of one there), its modification time
    /// kept. Fails with `NotFound`, `NotDownloaded`, `Locked`, as every write does.
    pub fn set_icon(&self, title: &str, icon: &Icon) -> Result<NoteMeta, StoreError> {
        // An emoji holds no quote or backslash: double quotes take it as it is.
        self.write_icon(title, Some(&format!("\"{icon}\"")))
    }

    /// Takes the note's emoji away: its `icon` lines out of the frontmatter (a frontmatter left empty goes), its
    /// modification time kept. A note without one stays as it is. Fails as `set_icon` does.
    pub fn clear_icon(&self, title: &str) -> Result<NoteMeta, StoreError> {
        self.write_icon(title, None)
    }

    fn write_icon(&self, title: &str, value: Option<&str>) -> Result<NoteMeta, StoreError> {
        let entry = self.entry(title)?;
        let content = self.note_text(&entry)?;
        self.ensure_unlocked(&entry, Some(&content))?;
        let changed = frontmatter::with_value(&content, KEY, value);
        if changed != content {
            self.write_keeping_time(&entry.path, &changed)?;
        }
        let (meta, _) = self.load(&entry)?;
        Ok(meta)
    }
}
