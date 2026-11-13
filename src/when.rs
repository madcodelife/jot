//! `When`: the time phrases of a to-do line (`jot_store::when`), with the
//! phrase's place in UTF-16 offsets, as JS strings count.

use jot_store::when;
use nsh_core::prelude::*;

use crate::notes::format_due;

/// Reminder times written in words: `明天 9:00`, `下周五`, `半小时后`, ...
#[module]
pub struct When;

#[module]
impl When {
    /// The first time phrase in `text`, read against the current local
    /// time, or `null`.
    pub fn parse(text: String) -> Option<WhenMatch> {
        let found = when::parse(&text, now())?;
        Some(WhenMatch {
            start: utf16_offset(&text, found.range.start),
            end: utf16_offset(&text, found.range.end),
            due: format_due(found.at),
            label: found.label,
        })
    }

    /// `line`, an open to-do, with its time phrase replaced by the absolute
    /// form the file keeps (` ⏰ 2026-11-14 09:00`), or `null` when it has
    /// no phrase or is not an open to-do.
    pub fn normalize_line(line: String) -> Option<String> {
        when::normalize_line(&line, now())
    }
}

/// A time phrase found in a text.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct WhenMatch {
    /// Where the phrase starts, in UTF-16 code units (a JS string's index).
    pub start: u32,
    /// Where it ends (exclusive), in UTF-16 code units.
    pub end: u32,
    /// The time it means, in local time (`"2026-11-14T09:00"`).
    pub due: String,
    /// A short label for it (`"明天 09:00"`).
    pub label: String,
}

/// The local wall-clock time.
fn now() -> jiff::civil::DateTime {
    jiff::Zoned::now().datetime()
}

/// The UTF-16 offset of byte offset `byte` of `text`, which is on a char
/// boundary (else the boundary before it).
fn utf16_offset(text: &str, byte: usize) -> u32 {
    let mut end = byte.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    u32::try_from(text[..end].encode_utf16().count()).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::utf16_offset;

    #[test]
    fn utf16_offsets_count_code_units() {
        let text = "交房租 明天 9:00";
        let start = text.find("明天").unwrap();
        assert_eq!(utf16_offset(text, start), 4);
        assert_eq!(utf16_offset(text, text.len()), 11);
        // An emoji outside the BMP is two code units.
        let text = "🎉 明天";
        assert_eq!(utf16_offset(text, text.find("明天").unwrap()), 3);
    }
}
