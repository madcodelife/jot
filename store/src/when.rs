//! Chinese time phrases in to-do text: `明天 9:00`, `周五`, `下午3点`, `半小时后`, ...
//!
//! A phrase is only an input form. When a to-do line is committed, [`normalize_line`] replaces the phrase with
//! the absolute ` ⏰ YYYY-MM-DD HH:mm` form the file keeps, since "明天" stops being true the next day.
//!
//! What a phrase means:
//!
//! - A date: `今天` / `明天` / `后天`, `今晚` / `明晚` / `明早`, `周五` (also `星期五`, `礼拜五`, `本周五`, `这周五`),
//!   `下周五` (also `下个周五`, `下星期五`), `11月20日` (or `11月20号`, with an optional `2026年`), `20号`.
//! - A time of day: `9点`, `9 点`, `9点30`, `9点30分`, `9点半`, `9:30`, optionally after a part of the day
//!   (`早上`, `上午`, `中午`, `下午`, `傍晚`, `晚上`, `凌晨`): `下午3点` is 15:00, `晚上8点` 20:00.
//! - A date, then optionally a part of the day and a time: `明天 9:00`, `周五下午3点`. A date alone is 09:00; a date
//!   with only a part of the day takes that part's usual hour (`明天下午` is 15:00).
//! - A time from now: `半小时后`, `2小时后`, `一个半小时后`, `10分钟后`.
//!
//! Dates look forward from `now`: `周五` is this week's Friday, or next week's once this week's is past; `下周五`
//! is always next week's; `11月20日` is next year's once this year's is past; `20号` next month's once this month's
//! is past. A day is not past while it is today. A time with no date is today, or tomorrow once it is past; an
//! explicit `今天` keeps today even when the time is past.
//!
//! Hours written as Chinese numerals (`三点`) count only after a date or a part of the day, since `一点` alone
//! usually means "a little".

use std::ops::Range;

use jiff::ToSpan as _;
use jiff::civil::{Date, DateTime, Weekday};

/// A time phrase found in a text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct When {
    /// Where the phrase is in the text, in UTF-8 bytes.
    pub range: Range<usize>,
    /// The local time it means.
    pub at: DateTime,
    /// A short label for the time: `今天 / 明天 / 后天 / 周五 / 11月20日`, a space, then `HH:mm`.
    pub label: String,
}

/// The first time phrase in `text`, read relative to `now`.
pub fn parse(text: &str, now: DateTime) -> Option<When> {
    let now = to_minute(now);
    text.char_indices().find_map(|(start, _)| {
        let (end, at) = phrase_at(text, start, now)?;
        Some(When {
            range: start..end,
            at,
            label: label(at, now),
        })
    })
}

/// A to-do line with its first time phrase replaced by ` ⏰ YYYY-MM-DD HH:mm` at the end of the line, or `None`
/// when the line is not an open to-do, has no phrase, or already has a reminder.
pub fn normalize_line(line: &str, now: DateTime) -> Option<String> {
    let task = crate::todo::TaskLine::parse(line)?;
    if task.done || task.due.is_some() {
        return None;
    }
    let content = &line[task.content_start..];
    let found = parse(content, now)?;
    let before = content[..found.range.start].trim_end_matches(is_space);
    let after = content[found.range.end..].trim_start_matches(is_space);
    let mut text = String::with_capacity(content.len() + 20);
    text.push_str(before);
    // Keep the words on either side apart if the phrase stood between them with spaces.
    if !before.is_empty()
        && !after.is_empty()
        && (before.len() < found.range.start || content.len() - found.range.end > after.len())
    {
        text.push(' ');
    }
    text.push_str(after);
    let text = text.trim_end_matches(is_space);

    let mut out = String::with_capacity(line.len() + 20);
    out.push_str(&line[..task.content_start]);
    out.push_str(text);
    if !text.is_empty() {
        out.push(' ');
    }
    out.push_str(crate::todo::REMINDER);
    out.push(' ');
    out.push_str(&crate::todo::format_due(found.at));
    Some(out)
}

/// The label of `at` as seen at `now`: `今天 09:00`, `明天 09:00`, `后天 09:00`, `周五 09:00` within the coming
/// week, else `11月20日 09:00`.
fn label(at: DateTime, now: DateTime) -> String {
    let days = now
        .date()
        .until(at.date())
        .map_or(i32::MAX, |span| span.get_days());
    let day = match days {
        0 => "今天".to_owned(),
        1 => "明天".to_owned(),
        2 => "后天".to_owned(),
        3..=6 => weekday_name(at.date().weekday()).to_owned(),
        _ => format!("{}月{}日", at.month(), at.day()),
    };
    format!("{day} {:02}:{:02}", at.hour(), at.minute())
}

fn weekday_name(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Monday => "周一",
        Weekday::Tuesday => "周二",
        Weekday::Wednesday => "周三",
        Weekday::Thursday => "周四",
        Weekday::Friday => "周五",
        Weekday::Saturday => "周六",
        Weekday::Sunday => "周日",
    }
}

/// `now` without seconds: the file keeps minutes.
fn to_minute(now: DateTime) -> DateTime {
    now.date().at(now.hour(), now.minute(), 0, 0)
}

/// The phrase starting at byte `start`, as its end and the time it means.
fn phrase_at(text: &str, start: usize, now: DateTime) -> Option<(usize, DateTime)> {
    // A number never starts in the middle of another.
    if text[..start].ends_with(|c: char| c.is_ascii_digit()) {
        return None;
    }
    if let Some(found) = relative(text, start, now) {
        return Some(found);
    }
    if let Some(found) = dated(text, start, now) {
        return Some(found);
    }
    // A time with no date: today, or tomorrow once it is past.
    let (end, period) = match part_of_day(text, start) {
        Some((end, period)) => (skip_spaces(text, end), Some(period)),
        None => (start, None),
    };
    let (end, hour, minute) = clock(text, end, period.is_some())?;
    let (days, hour) = apply_period(period, hour);
    let mut at = now
        .date()
        .checked_add(days.days())
        .ok()?
        .at(hour, minute, 0, 0);
    if at < now {
        at = at.checked_add(1.day()).ok()?;
    }
    Some((end, at))
}

/// `半小时后`, `2小时后`, `一个半小时后`, `10分钟后`.
fn relative(text: &str, start: usize, now: DateTime) -> Option<(usize, DateTime)> {
    let (mut end, whole) = match number(text, start, true) {
        Some((end, value)) => (end, value),
        None => (start, 0),
    };
    let had_number = end > start;
    if had_number {
        end = skip_spaces(text, end);
        end = eat(text, end, "个").unwrap_or(end);
    }
    let half = eat(text, end, "半");
    if let Some(after) = half {
        end = after;
    }
    if !had_number && half.is_none() {
        return None;
    }
    let minutes = if let Some(after) = eat(text, end, "小时").or_else(|| eat(text, end, "钟头"))
    {
        end = after;
        i64::from(whole) * 60 + if half.is_some() { 30 } else { 0 }
    } else {
        let after = eat(text, end, "分钟")?;
        // `半分钟` and `分钟后` are no reminder.
        if half.is_some() || !had_number {
            return None;
        }
        end = after;
        i64::from(whole)
    };
    end = ["之后", "以后", "后"]
        .iter()
        .find_map(|word| eat(text, end, word))?;
    if minutes == 0 {
        return None;
    }
    let at = now.checked_add(minutes.minutes()).ok()?;
    Some((end, at))
}

/// A date, then optionally a part of the day and a time.
fn dated(text: &str, start: usize, now: DateTime) -> Option<(usize, DateTime)> {
    let (date_end, date, implied) = date(text, start, now.date())?;
    let mut end = date_end;
    let mut period = implied;
    let after_date = skip_spaces(text, end);
    let mut cursor = after_date;
    if let Some((after, found)) = part_of_day(text, after_date) {
        end = after;
        period = Some(found);
        cursor = skip_spaces(text, after);
    }
    let (hour, minute) = match clock(text, cursor, true) {
        Some((after, hour, minute)) => {
            end = after;
            (hour, minute)
        }
        None => (period.map_or(9, Period::default_hour), 0),
    };
    let (days, hour) = apply_period(period, hour);
    let at = date.checked_add(days.days()).ok()?.at(hour, minute, 0, 0);
    Some((end, at))
}

/// A date: its end, the date, and the part of the day it implies (`今晚`).
fn date(text: &str, start: usize, today: Date) -> Option<(usize, Date, Option<Period>)> {
    const DAYS: [(&str, i64, Option<Period>); 7] = [
        ("今天", 0, None),
        ("明天", 1, None),
        ("后天", 2, None),
        ("今晚", 0, Some(Period::Evening)),
        ("明晚", 1, Some(Period::Evening)),
        ("明早", 1, Some(Period::Morning)),
        ("今早", 0, Some(Period::Morning)),
    ];
    for (word, offset, period) in DAYS {
        if let Some(end) = eat(text, start, word) {
            return Some((end, today.checked_add(offset.days()).ok()?, period));
        }
    }
    if let Some((end, date)) = weekday_date(text, start, today) {
        return Some((end, date, None));
    }
    if let Some((end, date)) = month_day(text, start, today) {
        return Some((end, date, None));
    }
    let (end, date) = day_of_month(text, start, today)?;
    Some((end, date, None))
}

/// `周五`, `本周五`, `下周五`, `星期五`, `下个礼拜五`, ...
fn weekday_date(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    // `上周五` is past, `一周一次` and `两周` are lengths: none of them is a date.
    if text[..start].ends_with([
        '上', '一', '二', '两', '三', '四', '五', '六', '七', '八', '九', '十', '个',
    ]) {
        return None;
    }
    let mut end = start;
    let mut next_week = false;
    for prefix in ["下个", "下"] {
        if let Some(after) = eat(text, end, prefix) {
            end = after;
            next_week = true;
            break;
        }
    }
    if !next_week {
        for prefix in ["本", "这个", "这"] {
            if let Some(after) = eat(text, end, prefix) {
                end = after;
                break;
            }
        }
    }
    end = ["星期", "礼拜", "周"]
        .iter()
        .find_map(|word| eat(text, end, word))?;
    let (end, weekday) = weekday(text, end)?;
    let monday = today
        .checked_sub(i64::from(today.weekday().to_monday_zero_offset()).days())
        .ok()?;
    let mut date = monday
        .checked_add(i64::from(weekday.to_monday_zero_offset()).days())
        .ok()?;
    if next_week || date < today {
        date = date.checked_add(7.days()).ok()?;
    }
    Some((end, date))
}

fn weekday(text: &str, start: usize) -> Option<(usize, Weekday)> {
    let c = text[start..].chars().next()?;
    let weekday = match c {
        '一' | '1' => Weekday::Monday,
        '二' | '2' => Weekday::Tuesday,
        '三' | '3' => Weekday::Wednesday,
        '四' | '4' => Weekday::Thursday,
        '五' | '5' => Weekday::Friday,
        '六' | '6' => Weekday::Saturday,
        '日' | '天' | '七' | '7' => Weekday::Sunday,
        _ => return None,
    };
    Some((start + c.len_utf8(), weekday))
}

/// `11月20日`, `11月20号`, `2026年11月20日`: this year's, or next year's once it is past (unless a year is given).
fn month_day(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    let (mut end, first) = digits(text, start)?;
    let mut year = None;
    if let Some(after) = eat(text, end, "年") {
        year = Some(i16::try_from(first).ok()?);
        end = after;
    }
    let (after, month) = if year.is_some() {
        digits(text, end)?
    } else {
        (end, first)
    };
    end = eat(text, after, "月")?;
    let (after, day) = digits(text, end)?;
    end = eat(text, after, "日").or_else(|| eat(text, after, "号"))?;
    let month = i8::try_from(month).ok()?;
    let day = i8::try_from(day).ok()?;
    let date = match year {
        Some(year) => Date::new(year, month, day).ok()?,
        None => {
            let this_year = Date::new(today.year(), month, day);
            match this_year {
                Ok(date) if date >= today => date,
                // 2月29日 in a year without one waits for the next leap year.
                _ => (1..=8).find_map(|ahead| Date::new(today.year() + ahead, month, day).ok())?,
            }
        }
    };
    Some((end, date))
}

/// What a number followed by `号` usually counts rather than a day of the month (`3号线`, `5号楼`).
const NOT_A_DAY: [char; 16] = [
    '线', '楼', '房', '门', '位', '口', '车', '机', '店', '馆', '院', '厅', '窗', '台', '桌', '床',
];

/// `20号`: this month's, or the next month that has that day once it is past.
fn day_of_month(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    let (after, day) = digits(text, start)?;
    let end = eat(text, after, "号")?;
    if text[end..].starts_with(NOT_A_DAY) {
        return None;
    }
    let day = i8::try_from(day)
        .ok()
        .filter(|day| (1..=31).contains(day))?;
    let first = today.first_of_month();
    (0..=12)
        .filter_map(|ahead| first.checked_add(ahead.months()).ok())
        .filter_map(|month| Date::new(month.year(), month.month(), day).ok())
        .find(|date| *date >= today)
        .map(|date| (end, date))
}

/// A part of the day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Period {
    /// 凌晨
    Night,
    /// 早上, 上午
    Morning,
    /// 中午
    Noon,
    /// 下午
    Afternoon,
    /// 傍晚, 晚上
    Evening,
}

impl Period {
    /// The hour a date with only this part of the day means: `明天下午` is 15:00.
    fn default_hour(self) -> i8 {
        match self {
            Period::Night => 1,
            Period::Morning => 9,
            Period::Noon => 12,
            Period::Afternoon => 15,
            Period::Evening => 20,
        }
    }
}

fn part_of_day(text: &str, start: usize) -> Option<(usize, Period)> {
    const PERIODS: [(&str, Period); 9] = [
        ("凌晨", Period::Night),
        ("早上", Period::Morning),
        ("早晨", Period::Morning),
        ("上午", Period::Morning),
        ("中午", Period::Noon),
        ("下午", Period::Afternoon),
        ("傍晚", Period::Evening),
        ("晚上", Period::Evening),
        ("今晚", Period::Evening),
    ];
    PERIODS
        .iter()
        .find_map(|(word, period)| Some((eat(text, start, word)?, *period)))
}

/// The hour on a 24-hour clock, and how many days later, that `hour` in `period` is: `下午3点` is 15:00,
/// `晚上12点` the next day's 00:00.
fn apply_period(period: Option<Period>, hour: i8) -> (i64, i8) {
    match period {
        Some(Period::Afternoon | Period::Evening) if hour < 12 => (0, hour + 12),
        Some(Period::Evening) if hour == 12 => (1, 0),
        Some(Period::Noon) if hour < 6 => (0, hour + 12),
        Some(Period::Night) if hour == 12 => (0, 0),
        _ => (0, hour),
    }
}

/// `9点`, `9 点`, `9点30`, `9点30分`, `9点半`, `9:30`, `9：30`; Chinese numerals (`三点`) only when
/// `numerals` allows them.
fn clock(text: &str, start: usize, numerals: bool) -> Option<(usize, i8, i8)> {
    if let Some((after, hour)) = digits(text, start)
        && let Some(colon) = eat(text, after, ":").or_else(|| eat(text, after, "："))
        && let Some((end, minute)) = digits(text, colon)
        && end - colon == 2
        && hour <= 23
        && minute <= 59
    {
        return Some((end, hour as i8, minute as i8));
    }
    let (after, hour) = number(text, start, numerals)?;
    let mut end = eat(text, skip_spaces(text, after), "点")?;
    if hour > 23 {
        return None;
    }
    let mut minute = 0;
    if let Some(after) = eat(text, end, "半") {
        minute = 30;
        end = after;
    } else if let Some((after, value)) = digits(text, end)
        && value <= 59
    {
        minute = value as i8;
        end = eat(text, after, "分").unwrap_or(after);
    }
    Some((end, hour as i8, minute))
}

/// A number in ASCII digits or, when `numerals` allows, Chinese numerals up to 99.
fn number(text: &str, start: usize, numerals: bool) -> Option<(usize, u32)> {
    digits(text, start).or_else(|| numerals.then(|| chinese_number(text, start)).flatten())
}

/// One to four ASCII digits not followed by another.
fn digits(text: &str, start: usize) -> Option<(usize, u32)> {
    let rest = &text[start..];
    let length = rest.bytes().take_while(u8::is_ascii_digit).count();
    if length == 0 || length > 4 {
        return None;
    }
    Some((start + length, rest[..length].parse().ok()?))
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

fn is_space(c: char) -> bool {
    c == ' ' || c == '\t' || c == '\u{3000}'
}

fn skip_spaces(text: &str, start: usize) -> usize {
    start + text[start..].len() - text[start..].trim_start_matches(is_space).len()
}

#[cfg(test)]
mod tests {
    use jiff::civil::date;

    use super::*;

    /// Friday 2026-11-13 10:30:20.
    fn now() -> DateTime {
        date(2026, 11, 13).at(10, 30, 20, 0)
    }

    fn at(y: i16, m: i8, d: i8, h: i8, min: i8) -> DateTime {
        date(y, m, d).at(h, min, 0, 0)
    }

    #[test]
    fn phrases() {
        // (text, phrase, time, label)
        let cases: &[(&str, &str, DateTime, &str)] = &[
            // Days.
            ("今天", "今天", at(2026, 11, 13, 9, 0), "今天 09:00"),
            ("明天", "明天", at(2026, 11, 14, 9, 0), "明天 09:00"),
            ("后天", "后天", at(2026, 11, 15, 9, 0), "后天 09:00"),
            (
                "明天 9:00",
                "明天 9:00",
                at(2026, 11, 14, 9, 0),
                "明天 09:00",
            ),
            ("明天9点", "明天9点", at(2026, 11, 14, 9, 0), "明天 09:00"),
            (
                "明天 9 点",
                "明天 9 点",
                at(2026, 11, 14, 9, 0),
                "明天 09:00",
            ),
            (
                "明天 9点半",
                "明天 9点半",
                at(2026, 11, 14, 9, 30),
                "明天 09:30",
            ),
            (
                "明天9点15分",
                "明天9点15分",
                at(2026, 11, 14, 9, 15),
                "明天 09:15",
            ),
            (
                "明天 9：05",
                "明天 9：05",
                at(2026, 11, 14, 9, 5),
                "明天 09:05",
            ),
            (
                "明天下午3点",
                "明天下午3点",
                at(2026, 11, 14, 15, 0),
                "明天 15:00",
            ),
            (
                "明天 下午 三点",
                "明天 下午 三点",
                at(2026, 11, 14, 15, 0),
                "明天 15:00",
            ),
            (
                "明天下午",
                "明天下午",
                at(2026, 11, 14, 15, 0),
                "明天 15:00",
            ),
            ("明晚", "明晚", at(2026, 11, 14, 20, 0), "明天 20:00"),
            ("今晚8点", "今晚8点", at(2026, 11, 13, 20, 0), "今天 20:00"),
            ("明早7点", "明早7点", at(2026, 11, 14, 7, 0), "明天 07:00"),
            // An explicit 今天 keeps today even when the time is past.
            (
                "今天 9 点",
                "今天 9 点",
                at(2026, 11, 13, 9, 0),
                "今天 09:00",
            ),
            // Times alone: today, or tomorrow once past.
            ("9点", "9点", at(2026, 11, 14, 9, 0), "明天 09:00"),
            ("11点", "11点", at(2026, 11, 13, 11, 0), "今天 11:00"),
            ("9:30", "9:30", at(2026, 11, 14, 9, 30), "明天 09:30"),
            ("下午3点", "下午3点", at(2026, 11, 13, 15, 0), "今天 15:00"),
            ("晚上8点", "晚上8点", at(2026, 11, 13, 20, 0), "今天 20:00"),
            (
                "下午三点",
                "下午三点",
                at(2026, 11, 13, 15, 0),
                "今天 15:00",
            ),
            (
                "中午12点",
                "中午12点",
                at(2026, 11, 13, 12, 0),
                "今天 12:00",
            ),
            ("中午1点", "中午1点", at(2026, 11, 13, 13, 0), "今天 13:00"),
            ("晚上12点", "晚上12点", at(2026, 11, 14, 0, 0), "明天 00:00"),
            (
                "下午15点",
                "下午15点",
                at(2026, 11, 13, 15, 0),
                "今天 15:00",
            ),
            ("早上8点", "早上8点", at(2026, 11, 14, 8, 0), "明天 08:00"),
            // Weekdays (now is a Friday).
            ("周五", "周五", at(2026, 11, 13, 9, 0), "今天 09:00"),
            ("周六", "周六", at(2026, 11, 14, 9, 0), "明天 09:00"),
            ("周日", "周日", at(2026, 11, 15, 9, 0), "后天 09:00"),
            ("星期天", "星期天", at(2026, 11, 15, 9, 0), "后天 09:00"),
            ("周四", "周四", at(2026, 11, 19, 9, 0), "周四 09:00"),
            (
                "周一 10点",
                "周一 10点",
                at(2026, 11, 16, 10, 0),
                "周一 10:00",
            ),
            ("礼拜三", "礼拜三", at(2026, 11, 18, 9, 0), "周三 09:00"),
            ("本周六", "本周六", at(2026, 11, 14, 9, 0), "明天 09:00"),
            ("下周五", "下周五", at(2026, 11, 20, 9, 0), "11月20日 09:00"),
            ("下周一", "下周一", at(2026, 11, 16, 9, 0), "周一 09:00"),
            (
                "下个星期日下午2点",
                "下个星期日下午2点",
                at(2026, 11, 22, 14, 0),
                "11月22日 14:00",
            ),
            // Month and day.
            (
                "11月20日",
                "11月20日",
                at(2026, 11, 20, 9, 0),
                "11月20日 09:00",
            ),
            ("11月13号", "11月13号", at(2026, 11, 13, 9, 0), "今天 09:00"),
            (
                "11月12日",
                "11月12日",
                at(2027, 11, 12, 9, 0),
                "11月12日 09:00",
            ),
            (
                "1月3日 8:00",
                "1月3日 8:00",
                at(2027, 1, 3, 8, 0),
                "1月3日 08:00",
            ),
            ("2月29日", "2月29日", at(2028, 2, 29, 9, 0), "2月29日 09:00"),
            (
                "2026年12月1日",
                "2026年12月1日",
                at(2026, 12, 1, 9, 0),
                "12月1日 09:00",
            ),
            // Day of the month.
            ("20号", "20号", at(2026, 11, 20, 9, 0), "11月20日 09:00"),
            ("13号", "13号", at(2026, 11, 13, 9, 0), "今天 09:00"),
            ("5号", "5号", at(2026, 12, 5, 9, 0), "12月5日 09:00"),
            ("31号", "31号", at(2026, 12, 31, 9, 0), "12月31日 09:00"),
            (
                "15号 下午4点",
                "15号 下午4点",
                at(2026, 11, 15, 16, 0),
                "后天 16:00",
            ),
            // From now (seconds dropped).
            (
                "半小时后",
                "半小时后",
                at(2026, 11, 13, 11, 0),
                "今天 11:00",
            ),
            ("2小时后", "2小时后", at(2026, 11, 13, 12, 30), "今天 12:30"),
            (
                "两小时后",
                "两小时后",
                at(2026, 11, 13, 12, 30),
                "今天 12:30",
            ),
            (
                "一个半小时后",
                "一个半小时后",
                at(2026, 11, 13, 12, 0),
                "今天 12:00",
            ),
            (
                "10分钟后",
                "10分钟后",
                at(2026, 11, 13, 10, 40),
                "今天 10:40",
            ),
            (
                "十分钟之后",
                "十分钟之后",
                at(2026, 11, 13, 10, 40),
                "今天 10:40",
            ),
            (
                "20小时后",
                "20小时后",
                at(2026, 11, 14, 6, 30),
                "明天 06:30",
            ),
            // In a sentence.
            (
                "交房租 明天 9:00",
                "明天 9:00",
                at(2026, 11, 14, 9, 0),
                "明天 09:00",
            ),
            (
                "提醒我周五交周报",
                "周五",
                at(2026, 11, 13, 9, 0),
                "今天 09:00",
            ),
            (
                "开会 下午3点 带电脑",
                "下午3点",
                at(2026, 11, 13, 15, 0),
                "今天 15:00",
            ),
            (
                "给妈妈打电话半小时后",
                "半小时后",
                at(2026, 11, 13, 11, 0),
                "今天 11:00",
            ),
            // Only the first phrase counts.
            ("明天 或 后天", "明天", at(2026, 11, 14, 9, 0), "明天 09:00"),
            (
                "下周五前 交 周四的报告",
                "下周五",
                at(2026, 11, 20, 9, 0),
                "11月20日 09:00",
            ),
        ];
        for &(text, phrase, expected, label) in cases {
            let found = parse(text, now()).unwrap_or_else(|| panic!("no phrase in {text:?}"));
            assert_eq!(&text[found.range.clone()], phrase, "{text:?}");
            assert_eq!(found.at, expected, "{text:?}");
            assert_eq!(found.label, label, "{text:?}");
        }
    }

    #[test]
    fn across_month_and_year_ends() {
        // Wednesday 2026-12-30 18:00.
        let now = date(2026, 12, 30).at(18, 0, 0, 0);
        let cases: &[(&str, DateTime, &str)] = &[
            ("明天", at(2026, 12, 31, 9, 0), "明天 09:00"),
            ("后天", at(2027, 1, 1, 9, 0), "后天 09:00"),
            ("周二", at(2027, 1, 5, 9, 0), "周二 09:00"),
            ("下周一", at(2027, 1, 4, 9, 0), "周一 09:00"),
            ("3号", at(2027, 1, 3, 9, 0), "周日 09:00"),
            ("29号", at(2027, 1, 29, 9, 0), "1月29日 09:00"),
            ("30号", at(2026, 12, 30, 9, 0), "今天 09:00"),
            ("12月1日", at(2027, 12, 1, 9, 0), "12月1日 09:00"),
            ("8小时后", at(2026, 12, 31, 2, 0), "明天 02:00"),
            ("晚上7点", at(2026, 12, 30, 19, 0), "今天 19:00"),
            ("下午5点", at(2026, 12, 31, 17, 0), "明天 17:00"),
        ];
        for &(text, expected, label) in cases {
            let found = parse(text, now).unwrap_or_else(|| panic!("no phrase in {text:?}"));
            assert_eq!(found.at, expected, "{text:?}");
            assert_eq!(found.label, label, "{text:?}");
        }
        // 31号 in a month without one: the next month that has it.
        let found = parse("31号", date(2027, 1, 31).at(12, 0, 0, 0)).unwrap();
        assert_eq!(found.at, at(2027, 1, 31, 9, 0));
        let found = parse("31号", date(2027, 2, 1).at(12, 0, 0, 0)).unwrap();
        assert_eq!(found.at, at(2027, 3, 31, 9, 0));
    }

    #[test]
    fn byte_ranges() {
        let found = parse("交房租 明天 9:00", now()).unwrap();
        assert_eq!(found.range, 10..21);
        let found = parse("ab 20号", now()).unwrap();
        assert_eq!(found.range, 3..8);
    }

    #[test]
    fn no_phrase() {
        for text in [
            "",
            "买牛奶",
            "吃一点东西",
            "差一点忘了",
            "上周五的会议纪要",
            "一周一次",
            "两周后再说",
            "坐3号线",
            "住在5号楼",
            "版本 120号",
            "3月份",
            "13:5",
            "25点",
            "2月30日",
            "0分钟后",
            "小时后",
            "milk, eggs",
        ] {
            assert_eq!(parse(text, now()), None, "{text:?}");
        }
    }

    #[test]
    fn numbers_inside_numbers_do_not_count() {
        // "13:30" is one time, not "3:30".
        let found = parse("x13:30", now()).unwrap();
        assert_eq!(found.range, 1..6);
        assert_eq!(found.at, at(2026, 11, 13, 13, 30));
    }

    #[test]
    fn normalizes_lines() {
        let now = now();
        let cases: &[(&str, Option<&str>)] = &[
            (
                "- [ ] 交房租 明天 9:00",
                Some("- [ ] 交房租 ⏰ 2026-11-14 09:00"),
            ),
            ("- [ ] 明天交房租", Some("- [ ] 交房租 ⏰ 2026-11-14 09:00")),
            (
                "- [ ] 交 明天 房租",
                Some("- [ ] 交 房租 ⏰ 2026-11-14 09:00"),
            ),
            (
                "  * [ ] 下午3点 开会",
                Some("  * [ ] 开会 ⏰ 2026-11-13 15:00"),
            ),
            ("- [ ] 半小时后", Some("- [ ] ⏰ 2026-11-13 11:00")),
            (
                "- [ ] 周五 或 下周五",
                Some("- [ ] 或 下周五 ⏰ 2026-11-13 09:00"),
            ),
            // Not an open to-do, or nothing to change.
            ("交房租 明天", None),
            ("- 交房租 明天", None),
            ("- [x] 交房租 明天 ✅ 2026-11-13", None),
            ("- [ ] 交房租", None),
            ("- [ ] 交房租 ⏰ 2026-11-14 09:00", None),
            ("- [ ] 交房租 明天 ⏰ 2026-11-14 09:00", None),
        ];
        for &(line, expected) in cases {
            assert_eq!(normalize_line(line, now).as_deref(), expected, "{line:?}");
        }
    }
}
