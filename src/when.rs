//! `When`: the time phrases of a to-do line (`jot_store::when`), with the
//! phrase's place in UTF-16 offsets, as JS strings count.

use jot_store::when::{self, Lang, Options};
use nsh_core::prelude::*;

use crate::notes::format_due;

/// Reminder times written in words, in Chinese, English or Japanese:
/// `明天 9:00`, `下週五`, `tomorrow 3pm`, `in 30 min`, `来週の金曜`, ...,
/// and how often a to-do repeats: `每月1号`, `every monday`, `毎日9時`.
#[module]
pub struct When;

#[module]
impl When {
    /// The first time phrase in `text`, read against the current local
    /// time, or `null`. Phrases of every language are read; `options`
    /// picks the label's language and what a date alone means. Throws a
    /// `TypeError` for a `defaultTime` that is not `"HH:mm"`.
    pub fn parse(text: String, options: Option<WhenOptions>) -> Result<Option<WhenMatch>, JsError> {
        let options = options.unwrap_or_default().resolve()?;
        let Some(found) = when::parse_with(&text, now(), &options) else {
            return Ok(None);
        };
        Ok(Some(WhenMatch {
            start: utf16_offset(&text, found.range.start),
            end: utf16_offset(&text, found.range.end),
            due: format_due(found.at),
            label: found.label,
            repeat: found.repeat.map(|repeat| repeat.name().to_owned()),
        }))
    }

    /// `line`, an open to-do, with its time phrase replaced by the absolute
    /// form the file keeps (` ⏰ 2026-11-14 09:00`), or `null` when it has
    /// no phrase or is not an open to-do. `options` as `parse`'s (the
    /// file's form has no language, so only `defaultTime` matters).
    pub fn normalize_line(
        line: String,
        options: Option<WhenOptions>,
    ) -> Result<Option<String>, JsError> {
        let options = options.unwrap_or_default().resolve()?;
        Ok(when::normalize_line_with(&line, now(), &options))
    }

    /// The open line that follows `line`, a repeating to-do with a time
    /// (`🔁 every month`), once it is checked off now: the same line
    /// unchecked, due at the rule's next time after now; `null` for any
    /// other line. The store writes it above the checked line; the editor
    /// does the same.
    pub fn next_line(line: String) -> Option<String> {
        jot_store::repeated_line(&line, now())
    }
}

/// How `When` reads and labels phrases.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
#[prop(exact)]
pub struct WhenOptions {
    /// The label's language, a BCP 47 tag: `"zh-Hans"` (`"明天 09:00"`),
    /// `"zh-Hant"` (`"後天 09:00"`), `"en"` (`"Tomorrow 9:00 AM"`), `"ja"`
    /// (`"明日 9:00"`); other languages label in English. Simplified Chinese
    /// when not given.
    pub locale: Option<String>,
    /// What a date alone (`明天`, `friday`) means, `"HH:mm"`. `"09:00"`
    /// when not given.
    pub default_time: Option<String>,
}

impl WhenOptions {
    fn resolve(self) -> Result<Options, JsError> {
        let mut options = Options::default();
        if let Some(locale) = self.locale {
            options.lang = Lang::from_locale(&locale);
        }
        if let Some(time) = self.default_time {
            options.default_time = parse_time(&time).ok_or_else(|| {
                JsError::Type(format!("defaultTime must be \"HH:mm\", got {time:?}"))
            })?;
        }
        Ok(options)
    }
}

/// `"9:00"` or `"09:00"`.
fn parse_time(time: &str) -> Option<jiff::civil::Time> {
    let (hour, minute) = time.trim().split_once(':')?;
    if !(1..=2).contains(&hour.len()) || minute.len() != 2 {
        return None;
    }
    let hour: i8 = hour.parse().ok()?;
    let minute: i8 = minute.parse().ok()?;
    jiff::civil::Time::new(hour, minute, 0, 0).ok()
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
    /// A short label for it in the options' language (`"明天 09:00"`,
    /// `"Tomorrow 9:00 AM"`; `"明天 09:00 · 每天"` with a rule).
    pub label: String,
    /// How often it comes back, when the phrase says (`每月`, `every
    /// day`): `"day"`, `"weekday"`, `"week"`, `"month"` or `"year"`, or
    /// `null`.
    pub repeat: Option<String>,
}

/// The local wall-clock time.
fn now() -> jiff::civil::DateTime {
    jiff::ZonedDateTime::now().datetime()
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
    use jot_store::when::Lang;

    use super::{WhenOptions, parse_time, utf16_offset};

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

    #[test]
    fn options() {
        assert_eq!(parse_time("9:00"), Some(jiff::civil::time(9, 0, 0, 0)));
        assert_eq!(parse_time("18:30"), Some(jiff::civil::time(18, 30, 0, 0)));
        for wrong in ["", "9", "9:0", "24:00", "12:60", "a:bc", "09:00:00"] {
            assert_eq!(parse_time(wrong), None, "{wrong:?}");
        }
        let options = WhenOptions {
            locale: Some("ja-JP".to_owned()),
            default_time: Some("08:15".to_owned()),
        }
        .resolve()
        .unwrap();
        assert_eq!(options.lang, Lang::Ja);
        assert_eq!(options.default_time, jiff::civil::time(8, 15, 0, 0));
        assert_eq!(WhenOptions::default().resolve().unwrap().lang, Lang::ZhHans);
        let wrong = WhenOptions {
            default_time: Some("9am".to_owned()),
            ..WhenOptions::default()
        };
        assert!(wrong.resolve().is_err());
    }
}
