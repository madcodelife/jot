//! Time phrases in to-do text, in Chinese (simplified and traditional), English and Japanese: `明天 9:00`,
//! `週五`, `下午3点`, `半小时后`, `tomorrow 9am`, `next friday`, `in 30 min`, `明日 9時`, `来週の金曜`, `30分後`, ...
//!
//! A phrase is only an input form. When a to-do line is committed, [`normalize_line`] replaces the phrase with
//! the absolute ` ⏰ YYYY-MM-DD HH:mm` form the file keeps, since "明天" stops being true the next day. What is
//! written to the file never depends on the language.
//!
//! Every language's phrases are read in every text, whatever [`Options::lang`] says (that only picks the label's
//! language), and one phrase may mix them: `明天 3pm`, `tomorrow 下午3点`.
//!
//! What a phrase means:
//!
//! - A date: a day (`今天` / `明天` / `后天` / `後天`, `today` / `tomorrow` / `the day after tomorrow`, `今日` /
//!   `明日` / `明後日`), a day with a part of it (`今晚`, `明早`, `tonight`, `this afternoon`, `今夜`, `明朝`), a
//!   weekday (`周五`, `星期五`, `週五`, `fri`, `friday`, `金曜`, `金曜日`), next week's (`下周五`, `下週五`,
//!   `next friday`, `来週の金曜`), a month and day (`11月20日`, `nov 20`, `20 nov`, `11/20`), a day of the month
//!   (`20号`, `20號`, `20日`).
//! - A time of day: `9点`, `9點`, `9点半`, `9:30`, `9am`, `3:30 pm`, `noon`, `9時`, `9時半`, `正午`, optionally
//!   after a part of the day (`下午3点`, `午後3時`, `夜9時`).
//! - A date, then optionally a part of the day and a time (`明天 9:00`, `周五下午3点`, `tomorrow at 3pm`,
//!   `friday afternoon`, `明日の午後3時`); a time, then a date (`3pm tomorrow`, `9am on friday`). A date alone is
//!   [`Options::default_time`]; a date with only a part of the day takes that part's usual hour (`明天下午` and
//!   `tomorrow afternoon` are 15:00).
//! - A time from now: `半小时后`, `2小時後`, `in 30 min`, `in half an hour`, `in 2 hours`, `30分後`, `1時間半後`.
//! - Numbers in Chinese numerals or kanji, as speech-to-text writes them: `九点`, `十一点四十五`, `三点一刻`,
//!   `十一月二十号`, `半个小时后`, `九時`, `三時半`.
//!
//! Dates look forward from `now`: a weekday is this week's, or next week's once this week's is past; `下周五`,
//! `next friday` and `来週の金曜` are always next week's (weeks start on Monday, so on a Friday they are a week
//! away); `11月20日` is next year's once this year's is past; `20号` next month's once this month's is past. A day
//! is not past while it is today. A time with no date is today, or tomorrow once it is past; an explicit `今天`
//! keeps today even when the time is past.
//!
//! An hour without a part of the day or a meridiem is read as calendar apps read it: 1 to 6 o'clock is the
//! afternoon's (`三点开会`, `3点`, `3:30`, `三時`, `tomorrow at 4` are 15:00 / 15:30 / 16:00), 7 to 12, 0 and 13 to
//! 23 are as written (`9点` is 09:00), in every language and with or without a date; `03:00`, with a leading zero,
//! is a 24-hour clock's and stays 03:00.
//!
//! `12am` is 00:00 and `12pm` 12:00; `午前12時` is 00:00 and `午後12時` 12:00, as 12-hour clocks show them.
//! `midnight` and `晚上12点` are the end of the day: the next day's 00:00.
//!
//! A phrase may also say how often the to-do comes back ([`Repeat`], written ` 🔁 every month` in the file): `每天` /
//! `每日`, `每个工作日` / `工作日`, `每周`, `每周一`…`每周日`, `每月`, `每月1号`, `每年`; `every day`, `every weekday`,
//! `every week`, `every monday`, `every month`, `every year`; `毎日`, `平日`, `毎週`, `毎週月曜` / `毎月曜`, `毎月`,
//! `毎年`. Nothing else (`每两周`, `every 2 weeks` are no rule). A time right before or after it goes with it
//! (`每天 9点`, `每周一下午3点`, `every day at 9am`, `9am every day`, `毎月1日 9時`); a weekday (`每周一`, `every
//! monday`) or a day of the month (`每月1号`) is its first date. A rule without a time is first due today at
//! [`Options::default_time`] (a part of the day alone, `每天晚上`, at that part's hour), or by the rule's next
//! once that is past; `every weekday`'s time falls on a weekday.

use std::ops::Range;

use jiff::ToSpan as _;
use jiff::civil::{Date, DateTime, Time, Weekday};

pub use crate::repeat::Repeat;

mod en;
mod ja;
mod zh;

/// A time phrase found in a text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct When {
    /// Where the phrase is in the text, in UTF-8 bytes.
    pub range: Range<usize>,
    /// The local time it means.
    pub at: DateTime,
    /// A short label for the time in [`Options::lang`]: the day (`明天`, `Tomorrow`, `明日`), a weekday within the
    /// coming week (`周五`, `Fri`, `金曜`) or the month and day (`11月20日`, `Nov 20`), a space, then the time
    /// (`09:00`, `9:00 AM`, `9:00`), and the rule after ` · ` when there is one (`明天 09:00 · 每天`).
    pub label: String,
    /// How often it comes back, when the phrase says (`每月`, `every day`).
    pub repeat: Option<Repeat>,
}

/// The language of a [`When`]'s label. Phrases of every language are read whatever it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Lang {
    /// Simplified Chinese: `明天 09:00`, `后天 09:00`, `周五 15:00`, `11月20日 09:00`.
    #[default]
    ZhHans,
    /// Traditional Chinese: `明天 09:00`, `後天 09:00`, `週五 15:00`, `11月20日 09:00`.
    ZhHant,
    /// English: `Tomorrow 9:00 AM`, `Fri 3:00 PM`, `Nov 20 9:00 AM`.
    En,
    /// Japanese: `明日 9:00`, `明後日 9:00`, `金曜 15:00`, `11月20日 9:00`.
    Ja,
}

impl Lang {
    /// The language of a BCP 47 tag (`"en-US"`, `"zh-Hant"`, `"zh-TW"`, `"ja-JP"`; `_` works as `-`): Chinese
    /// tagged `Hant`, or written in Taiwan, Hong Kong or Macau, is traditional, other Chinese simplified; a
    /// language other than Chinese and Japanese is English.
    pub fn from_locale(locale: &str) -> Lang {
        let locale = locale.trim().replace('_', "-").to_ascii_lowercase();
        let mut parts = locale.split('-');
        match parts.next().unwrap_or("") {
            "zh" => {
                if parts.any(|part| matches!(part, "hant" | "tw" | "hk" | "mo")) {
                    Lang::ZhHant
                } else {
                    Lang::ZhHans
                }
            }
            "ja" => Lang::Ja,
            _ => Lang::En,
        }
    }
}

/// How phrases are read and labelled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    /// The time a date alone means (`明天`, `friday`, `11月20日`). 09:00 by default.
    pub default_time: Time,
    /// The label's language. Simplified Chinese by default.
    pub lang: Lang,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            default_time: Time::constant(9, 0, 0, 0),
            lang: Lang::default(),
        }
    }
}

/// The first time phrase in `text`, read relative to `now`, a date alone meaning 09:00 and the label in
/// simplified Chinese.
pub fn parse(text: &str, now: DateTime) -> Option<When> {
    parse_with(text, now, &Options::default())
}

/// The first time phrase in `text`, read relative to `now` with `options`.
pub fn parse_with(text: &str, now: DateTime, options: &Options) -> Option<When> {
    let now = to_minute(now);
    let input = Input::new(text);
    text.char_indices().find_map(|(start, _)| {
        let found = found_at(&input, start, now, options)?;
        let mut label = label(found.at, now, options.lang);
        if let Some(repeat) = found.repeat {
            label.push_str(" · ");
            label.push_str(repeat_label(repeat, options.lang));
        }
        Some(When {
            range: found.range,
            at: found.at,
            label,
            repeat: found.repeat,
        })
    })
}

/// A to-do line with its first time phrase replaced by ` ⏰ YYYY-MM-DD HH:mm` (and ` 🔁 every <rule>` when the
/// phrase has a rule) at the end of the line, or `None` when the line is not an open to-do or has no phrase. A
/// to-do that has a reminder already takes only a phrase with a rule (its time then the phrase's, if it says
/// one); one that has a reminder and a rule takes none. A date alone means 09:00.
pub fn normalize_line(line: &str, now: DateTime) -> Option<String> {
    normalize_line_with(line, now, &Options::default())
}

/// [`normalize_line`] with `options` (only [`Options::default_time`] matters: the file's form has no language).
pub fn normalize_line_with(line: &str, now: DateTime, options: &Options) -> Option<String> {
    let task = crate::todo::TaskLine::parse(line)?;
    if task.done || (task.due.is_some() && task.repeat.is_some()) {
        return None;
    }
    let start = task.content_start;
    let content = &line[start..];
    // The time and the rule written already are no phrase (`09:00` would read as one).
    let written: Vec<Range<usize>> = [&task.due_range, &task.repeat_range]
        .into_iter()
        .flatten()
        .map(|range| range.start - start..range.end - start)
        .collect();
    let masked = written.iter().fold(content.to_owned(), |text, range| {
        blanked(&text, range.clone())
    });
    let now = to_minute(now);
    let input = Input::new(&masked);
    let found = masked.char_indices().find_map(|(at, _)| {
        found_at(&input, at, now, options)
            .filter(|found| task.due.is_none() || found.repeat.is_some())
    })?;
    let repeat = found.repeat.or(task.repeat);
    let at = match task.due {
        Some(due) if !found.timed => due,
        _ => repeat.map_or(found.at, |repeat| repeat.align(found.at)),
    };

    let mut cuts = written;
    cuts.push(found.range);
    let text = without(content, cuts);
    let mut out = String::with_capacity(line.len() + 40);
    out.push_str(&line[..start]);
    out.push_str(&text);
    if !text.is_empty() {
        out.push(' ');
    }
    out.push_str(crate::todo::REMINDER);
    out.push(' ');
    out.push_str(&crate::todo::format_due(at));
    if let Some(repeat) = repeat {
        out.push(' ');
        out.push_str(crate::repeat::MARKER);
        out.push_str(&format!(" {repeat}"));
    }
    Some(out)
}

/// `text` without the byte ranges `cuts`; where one stood between words with spaces, they stay one space apart.
fn without(text: &str, mut cuts: Vec<Range<usize>>) -> String {
    // Overlapping ones are one; the later ones go first, so the earlier ones' places hold.
    cuts.sort_by_key(|range| range.start);
    let mut merged: Vec<Range<usize>> = Vec::new();
    for range in cuts {
        match merged.last_mut() {
            Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
            _ => merged.push(range),
        }
    }
    let mut out = text.to_owned();
    for range in merged.into_iter().rev() {
        let before = out[..range.start].trim_end_matches(is_space);
        let after = out[range.end..].trim_start_matches(is_space);
        let apart = !before.is_empty()
            && !after.is_empty()
            && (before.len() < range.start || out.len() - range.end > after.len());
        out = format!("{before}{}{after}", if apart { " " } else { "" });
    }
    out.trim_end_matches(is_space).to_owned()
}

/// `text` with the bytes of `range` (on char boundaries) spaces: the same offsets, nothing there to read.
fn blanked(text: &str, range: Range<usize>) -> String {
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..range.start]);
    out.extend(std::iter::repeat_n(' ', range.len()));
    out.push_str(&text[range.end..]);
    out
}

/// What a phrase at a place says.
struct Found {
    range: Range<usize>,
    at: DateTime,
    repeat: Option<Repeat>,
    /// Whether it says a time (else it is a rule's first time).
    timed: bool,
}

/// The phrase starting at byte `start`: a rule with the time right after it (`每天 9点`, `每周一`, `every monday
/// 3pm`) or alone, else a time with a rule right after it (`9点 每天`) or alone.
fn found_at(input: &Input<'_>, start: usize, now: DateTime, options: &Options) -> Option<Found> {
    let text = input.text;
    if let Some((rule_end, repeat, dated)) = rule_at(input, start, now.date()) {
        // What follows is read with the rule's words blanked out: `每月1号`'s `1号` is a day of the month, not the
        // day of a month and day.
        let rest = blanked(text, start..rule_end);
        let rest = Input::new(&rest);
        let after = skip_spaces(text, rule_end);
        if let Some((end, at)) = phrase_at(&rest, after, now, options) {
            return Some(Found {
                range: start..end,
                at: repeat.align(at),
                repeat: Some(repeat),
                timed: true,
            });
        }
        if !dated {
            // `每天晚上`: the part of the day's hour.
            let (end, time) = match period_at(&rest, after) {
                Some((end, part)) => (end, Time::new(part.default_hour(), 0, 0, 0).ok()?),
                None => (rule_end, options.default_time),
            };
            return Some(Found {
                range: start..end,
                at: repeat.first(now, time),
                repeat: Some(repeat),
                timed: false,
            });
        }
    }
    let (end, at) = phrase_at(input, start, now, options)?;
    // `9点 每天`, `9am every day`: a rule that needs no date of its own.
    if let Some((rule_end, repeat, false)) = rule_at(input, skip_spaces(text, end), now.date()) {
        return Some(Found {
            range: start..rule_end,
            at: repeat.align(at),
            repeat: Some(repeat),
            timed: true,
        });
    }
    Some(Found {
        range: start..end,
        at,
        repeat: None,
        timed: true,
    })
}

/// The rule the languages read at `start`: its end, the rule, and whether a date right after it belongs to it.
fn rule_at(input: &Input<'_>, start: usize, today: Date) -> Option<(usize, Repeat, bool)> {
    longest(
        [
            zh::rule(&input.folded, start),
            ja::rule(input.text, start),
            en::rule(input.text, start, today),
        ],
        |found| found.0,
    )
}

/// A rule's short name in `lang`: `每月`, `每個工作日`, `Monthly`, `平日`.
fn repeat_label(repeat: Repeat, lang: Lang) -> &'static str {
    match (lang, repeat) {
        (Lang::ZhHans | Lang::ZhHant, Repeat::Day) => "每天",
        (Lang::ZhHans, Repeat::Weekday) => "每个工作日",
        (Lang::ZhHant, Repeat::Weekday) => "每個工作日",
        (Lang::ZhHans, Repeat::Week) => "每周",
        (Lang::ZhHant, Repeat::Week) => "每週",
        (Lang::ZhHans | Lang::ZhHant, Repeat::Month) => "每月",
        (Lang::ZhHans | Lang::ZhHant, Repeat::Year) => "每年",
        (Lang::En, Repeat::Day) => "Daily",
        (Lang::En, Repeat::Weekday) => "Weekdays",
        (Lang::En, Repeat::Week) => "Weekly",
        (Lang::En, Repeat::Month) => "Monthly",
        (Lang::En, Repeat::Year) => "Yearly",
        (Lang::Ja, Repeat::Day) => "毎日",
        (Lang::Ja, Repeat::Weekday) => "平日",
        (Lang::Ja, Repeat::Week) => "毎週",
        (Lang::Ja, Repeat::Month) => "毎月",
        (Lang::Ja, Repeat::Year) => "毎年",
    }
}

/// The label of `at` as seen at `now`: today, tomorrow, the day after (in the languages that have a word for
/// it), the weekday within the coming week, else the month and day; then the time.
fn label(at: DateTime, now: DateTime, lang: Lang) -> String {
    let days = now
        .date()
        .until(at.date())
        .map_or(i32::MAX, |span| span.get_days());
    let weekday = at.date().weekday();
    let (month, day) = (at.month(), at.day());
    let (hour, minute) = (at.hour(), at.minute());
    match lang {
        Lang::ZhHans | Lang::ZhHant => {
            let hant = lang == Lang::ZhHant;
            let name = match days {
                0 => "今天".to_owned(),
                1 => "明天".to_owned(),
                2 if hant => "後天".to_owned(),
                2 => "后天".to_owned(),
                3..=6 => format!(
                    "{}{}",
                    if hant { "週" } else { "周" },
                    zh::weekday_char(weekday)
                ),
                _ => format!("{month}月{day}日"),
            };
            format!("{name} {hour:02}:{minute:02}")
        }
        Lang::En => {
            let name = match days {
                0 => "Today".to_owned(),
                1 => "Tomorrow".to_owned(),
                2..=6 => en::weekday_short(weekday).to_owned(),
                _ => format!("{} {day}", en::month_short(month)),
            };
            let (twelve, meridiem) = match hour {
                0 => (12, "AM"),
                1..=11 => (hour, "AM"),
                12 => (12, "PM"),
                _ => (hour - 12, "PM"),
            };
            format!("{name} {twelve}:{minute:02} {meridiem}")
        }
        Lang::Ja => {
            let name = match days {
                0 => "今日".to_owned(),
                1 => "明日".to_owned(),
                2 => "明後日".to_owned(),
                3..=6 => format!("{}曜", ja::weekday_char(weekday)),
                _ => format!("{month}月{day}日"),
            };
            format!("{name} {hour}:{minute:02}")
        }
    }
}

/// `now` without seconds: the file keeps minutes.
fn to_minute(now: DateTime) -> DateTime {
    now.date().at(now.hour(), now.minute(), 0, 0)
}

/// A text as each language's reader sees it.
struct Input<'a> {
    /// The text itself (English, Japanese).
    text: &'a str,
    /// The text with the traditional characters Chinese phrases use folded to simplified ones, at the same byte
    /// offsets (Chinese).
    folded: String,
}

impl<'a> Input<'a> {
    fn new(text: &'a str) -> Self {
        Input {
            text,
            folded: zh::fold(text),
        }
    }
}

/// A date found in a text.
#[derive(Debug, Clone, Copy)]
struct DateHit {
    end: usize,
    date: Date,
    /// The part of the day it implies (`今晚`, `tonight`).
    period: Option<Period>,
}

/// A time of day found in a text.
#[derive(Debug, Clone, Copy)]
struct Clock {
    end: usize,
    /// 0 to 23, or 24 for the end of the day (`midnight`).
    hour: i8,
    minute: i8,
    /// Whether the hour is already on a 24-hour clock (`3pm`, `noon`), so a part of the day does not move it.
    fixed: bool,
}

/// Which week a weekday is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Week {
    /// This week's, or next week's once this week's is past.
    Coming,
    /// Next week's.
    Next,
    /// The week after next's (`再来週`).
    AfterNext,
}

/// The phrase starting at byte `start`, as its end and the time it means: the longest of what the languages
/// read there.
fn phrase_at(
    input: &Input<'_>,
    start: usize,
    now: DateTime,
    options: &Options,
) -> Option<(usize, DateTime)> {
    // A number never starts in the middle of another.
    if input.text[..start].ends_with(is_digit) {
        return None;
    }
    longest(
        [
            relative_at(input, start, now),
            dated(input, start, now, options),
            timed(input, start, now),
        ],
        |found| found.0,
    )
}

/// A time from now.
fn relative_at(input: &Input<'_>, start: usize, now: DateTime) -> Option<(usize, DateTime)> {
    let (end, minutes) = longest(
        [
            zh::relative(&input.folded, start),
            ja::relative(input.text, start),
            en::relative(input.text, start),
        ],
        |found| found.0,
    )?;
    if minutes == 0 {
        return None;
    }
    Some((end, now.checked_add(minutes.minutes()).ok()?))
}

/// A date, then optionally a part of the day and a time.
fn dated(
    input: &Input<'_>,
    start: usize,
    now: DateTime,
    options: &Options,
) -> Option<(usize, DateTime)> {
    let text = input.text;
    let found = date_at(input, start, now.date())?;
    let mut end = found.end;
    let mut period = found.period;
    let (mut cursor, mut bare) = after_connector(text, skip_spaces(text, end));
    if let Some((after, part)) = period_at(input, cursor) {
        end = after;
        period = Some(part);
        (cursor, bare) = after_connector(text, skip_spaces(text, after));
    }
    let clock = match clock_at(input, cursor, true, bare) {
        Some(clock) => {
            end = clock.end;
            clock
        }
        None => match period {
            Some(part) => Clock {
                end,
                hour: part.default_hour(),
                minute: 0,
                fixed: false,
            },
            None => Clock {
                end,
                hour: options.default_time.hour(),
                minute: options.default_time.minute(),
                fixed: true,
            },
        },
    };
    let (days, hour) = resolve(clock, period);
    let at = found
        .date
        .checked_add(days.days())
        .ok()?
        .at(hour, clock.minute, 0, 0);
    Some((end, at))
}

/// A time of day, optionally after a part of the day, and optionally followed by a date (`3pm tomorrow`).
fn timed(input: &Input<'_>, start: usize, now: DateTime) -> Option<(usize, DateTime)> {
    let text = input.text;
    // `at 3pm`: the phrase takes the word with it.
    let cursor = en::word(text, start, "at").map_or(start, |after| skip_spaces(text, after));
    let (cursor, period) = match period_at(input, cursor) {
        Some((after, part)) => (skip_spaces(text, after), Some(part)),
        None => (cursor, None),
    };
    let clock = clock_at(input, cursor, period.is_some(), false)?;

    let after = skip_spaces(text, clock.end);
    let after = en::word(text, after, "on").map_or(after, |on| skip_spaces(text, on));
    if let Some(found) = date_at(input, after, now.date()) {
        let (days, hour) = resolve(clock, period.or(found.period));
        let at = found
            .date
            .checked_add(days.days())
            .ok()?
            .at(hour, clock.minute, 0, 0);
        return Some((found.end, at));
    }

    // No date: today, or tomorrow once it is past.
    let (days, hour) = resolve(clock, period);
    let mut at = now
        .date()
        .checked_add(days.days())
        .ok()?
        .at(hour, clock.minute, 0, 0);
    if at < now {
        at = at.checked_add(1.day()).ok()?;
    }
    Some((clock.end, at))
}

/// The date the languages read at `start`.
fn date_at(input: &Input<'_>, start: usize, today: Date) -> Option<DateHit> {
    longest(
        [
            zh::date(&input.folded, start, today),
            ja::date(input.text, start, today),
            en::date(input.text, start, today),
        ],
        |found| found.end,
    )
}

/// The part of the day the languages read at `start`.
fn period_at(input: &Input<'_>, start: usize) -> Option<(usize, Period)> {
    longest(
        [
            zh::period(&input.folded, start),
            ja::period(input.text, start),
            en::period(input.text, start),
        ],
        |found| found.0,
    )
}

/// The time of day the languages read at `start`. `dated`: after a date or a part of the day, where every hour in
/// Chinese numerals or kanji counts (`明天一点`; on its own `一点` is "a little"); a bare hour (`tomorrow at 9`)
/// only when `bare`.
fn clock_at(input: &Input<'_>, start: usize, dated: bool, bare: bool) -> Option<Clock> {
    longest(
        [
            colon_clock(input.text, start),
            zh::clock(&input.folded, start, dated),
            ja::clock(input.text, start, dated),
            en::clock(input.text, start, bare),
        ],
        |found| found.end,
    )
}

/// What may stand between a date and its time: `at` (after which a bare hour counts) or `の`; `start` and no
/// bare hour when there is none.
fn after_connector(text: &str, start: usize) -> (usize, bool) {
    if let Some(after) = en::word(text, start, "at") {
        return (skip_spaces(text, after), true);
    }
    if let Some(after) = eat(text, start, "の") {
        return (skip_spaces(text, after), false);
    }
    (start, false)
}

/// The one of `found` that ends last; the first of those on a tie.
fn longest<T>(found: impl IntoIterator<Item = Option<T>>, end: impl Fn(&T) -> usize) -> Option<T> {
    let mut best: Option<T> = None;
    for item in found.into_iter().flatten() {
        if best.as_ref().is_none_or(|best| end(&item) > end(best)) {
            best = Some(item);
        }
    }
    best
}

/// A part of the day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Period {
    /// 凌晨, 深夜
    Night,
    /// 早上, 上午, morning, 朝
    Morning,
    /// 午前: like `Morning`, but its 12 o'clock is 00:00.
    Am,
    /// 中午, 昼
    Noon,
    /// 下午, afternoon, 午後
    Afternoon,
    /// 傍晚, 晚上, evening, night, 夕方, 夜
    Evening,
}

impl Period {
    /// The hour a date with only this part of the day means: `明天下午` is 15:00.
    fn default_hour(self) -> i8 {
        match self {
            Period::Night => 1,
            Period::Morning | Period::Am => 9,
            Period::Noon => 12,
            Period::Afternoon => 15,
            Period::Evening => 20,
        }
    }
}

/// The hour on a 24-hour clock, and how many days later, that `clock` in `period` is: `下午3点` is 15:00,
/// `晚上12点` the next day's 00:00. Without a part of the day, 1 to 6 o'clock is the afternoon's, as calendar apps
/// read it (`三点开会` is 15:00); 7 to 12, 0 and 13 to 23 are as written.
fn resolve(clock: Clock, period: Option<Period>) -> (i64, i8) {
    if clock.fixed {
        return (i64::from(clock.hour / 24), clock.hour % 24);
    }
    let hour = clock.hour;
    match period {
        None if (1..=6).contains(&hour) => (0, hour + 12),
        Some(Period::Afternoon | Period::Evening) if hour < 12 => (0, hour + 12),
        Some(Period::Evening) if hour == 12 => (1, 0),
        Some(Period::Noon) if hour < 6 => (0, hour + 12),
        Some(Period::Night | Period::Am) if hour == 12 => (0, 0),
        _ => (0, hour),
    }
}

/// `9:30`, `9：30`, `15:00`: the same in every language.
fn colon_clock(text: &str, start: usize) -> Option<Clock> {
    let (after, hour) = digits(text, start)?;
    let colon = eat(text, after, ":").or_else(|| eat(text, after, "："))?;
    let (end, minute) = digits(text, colon)?;
    if text[colon..end].chars().count() != 2 || hour > 23 || minute > 59 {
        return None;
    }
    Some(Clock {
        end,
        hour: hour as i8,
        minute: minute as i8,
        // `03:00` with its leading zero is a 24-hour clock's: no afternoon.
        fixed: text[start..after].chars().count() == 2,
    })
}

/// The date `weekday` names in `week`, seen from `today`.
fn weekday_date(today: Date, weekday: Weekday, week: Week) -> Option<Date> {
    let monday = today
        .checked_sub(i64::from(today.weekday().to_monday_zero_offset()).days())
        .ok()?;
    let date = monday
        .checked_add(i64::from(weekday.to_monday_zero_offset()).days())
        .ok()?;
    let weeks: i64 = match week {
        Week::Coming if date < today => 1,
        Week::Coming => 0,
        Week::Next => 1,
        Week::AfterNext => 2,
    };
    date.checked_add((7 * weeks).days()).ok()
}

/// A month and day: in `year` when given, else this year's, or next year's once it is past (a 29 February
/// waits for the next leap year).
fn month_day_date(today: Date, year: Option<u32>, month: u32, day: u32) -> Option<Date> {
    let month = i8::try_from(month).ok()?;
    let day = i8::try_from(day).ok()?;
    match year {
        Some(year) => Date::new(i16::try_from(year).ok()?, month, day).ok(),
        None => match Date::new(today.year(), month, day) {
            Ok(date) if date >= today => Some(date),
            _ => (1..=8).find_map(|ahead| Date::new(today.year() + ahead, month, day).ok()),
        },
    }
}

/// A day of the month: this month's, or the next month that has that day once it is past.
fn day_of_month_date(today: Date, day: u32) -> Option<Date> {
    let day = i8::try_from(day)
        .ok()
        .filter(|day| (1..=31).contains(day))?;
    let first = today.first_of_month();
    (0..=12)
        .filter_map(|ahead| first.checked_add(ahead.months()).ok())
        .filter_map(|month| Date::new(month.year(), month.month(), day).ok())
        .find(|date| *date >= today)
}

/// A number in digits or, when `numerals` allows, Chinese numerals up to 99 (which Japanese shares).
fn number(text: &str, start: usize, numerals: bool) -> Option<(usize, u32)> {
    digits(text, start).or_else(|| numerals.then(|| chinese_number(text, start)).flatten())
}

fn is_digit(c: char) -> bool {
    c.is_ascii_digit() || ('０'..='９').contains(&c)
}

/// One to four digits (ASCII or full-width, as Japanese and Chinese input methods type them) not followed by
/// another.
fn digits(text: &str, start: usize) -> Option<(usize, u32)> {
    let mut value = 0;
    let mut end = start;
    let mut count = 0;
    for c in text[start..].chars() {
        let digit = match c {
            '0'..='9' => c as u32 - '0' as u32,
            '０'..='９' => c as u32 - '０' as u32,
            _ => break,
        };
        count += 1;
        if count > 4 {
            return None;
        }
        value = value * 10 + digit;
        end += c.len_utf8();
    }
    (count > 0).then_some((end, value))
}

/// `三`, `十`, `十二`, `二十`, `二十五`, `两`.
fn chinese_number(text: &str, start: usize) -> Option<(usize, u32)> {
    fn digit(c: char) -> Option<u32> {
        Some(match c {
            '零' => 0,
            '一' => 1,
            '二' | '两' => 2,
            '三' => 3,
            '四' => 4,
            '五' => 5,
            '六' => 6,
            '七' => 7,
            '八' => 8,
            '九' => 9,
            _ => return None,
        })
    }
    let mut chars = text[start..].char_indices().peekable();
    let mut value = 0;
    let mut end = start;
    if let Some(&(index, c)) = chars.peek()
        && let Some(d) = digit(c)
    {
        value = d;
        end = start + index + c.len_utf8();
        chars.next();
    }
    if let Some(&(index, '十')) = chars.peek() {
        value = if end == start { 10 } else { value * 10 };
        end = start + index + '十'.len_utf8();
        chars.next();
        if let Some(&(index, c)) = chars.peek()
            && let Some(d) = digit(c)
        {
            value += d;
            end = start + index + c.len_utf8();
        }
    }
    (end > start).then_some((end, value))
}

/// The end of `word` if `text` has it at `start`.
fn eat(text: &str, start: usize, word: &str) -> Option<usize> {
    text[start..]
        .starts_with(word)
        .then_some(start + word.len())
}

/// The end of the first of `words` `text` has at `start`.
fn eat_any(text: &str, start: usize, words: &[&str]) -> Option<usize> {
    words.iter().find_map(|word| eat(text, start, word))
}

/// Whether a word starts at `start`: no letter (CJK included) or digit right before it.
fn at_word_start(text: &str, start: usize) -> bool {
    !text[..start].ends_with(char::is_alphanumeric)
}

fn is_space(c: char) -> bool {
    c == ' ' || c == '\t' || c == '\u{3000}'
}

fn skip_spaces(text: &str, start: usize) -> usize {
    start + text[start..].len() - text[start..].trim_start_matches(is_space).len()
}

#[cfg(test)]
mod tests;
