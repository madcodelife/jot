//! Japanese phrases: `今日` / `明日` / `明後日`, `今夜`, `金曜` / `金曜日`, `来週の金曜`, `11月20日`, `20日`,
//! `9時` / `9時半` / `午後3時` / `正午`, `30分後` / `2時間後` / `1時間半後`.
//!
//! As in Chinese, hours written in kanji (`三時`) count only after a date or a part of the day.

use jiff::ToSpan as _;
use jiff::civil::{Date, Weekday};

use super::{
    Clock, DateHit, Period, Week, day_of_month_date, digits, eat, eat_any, month_day_date, number,
    skip_spaces, weekday_date,
};

/// The kanji before `曜` that names `weekday` (`金曜`).
pub(super) fn weekday_char(weekday: Weekday) -> char {
    match weekday {
        Weekday::Monday => '月',
        Weekday::Tuesday => '火',
        Weekday::Wednesday => '水',
        Weekday::Thursday => '木',
        Weekday::Friday => '金',
        Weekday::Saturday => '土',
        Weekday::Sunday => '日',
    }
}

/// `30分後`, `2時間後`, `1時間半後`, `二時間後に`, as the minutes from now.
pub(super) fn relative(text: &str, start: usize) -> Option<(usize, i64)> {
    let (after, whole) = number(text, start, true)?;
    let end = skip_spaces(text, after);
    let (end, minutes) = if let Some(after) = eat(text, end, "時間") {
        match eat(text, after, "半") {
            Some(after) => (after, i64::from(whole) * 60 + 30),
            None => (after, i64::from(whole) * 60),
        }
    } else {
        let after = eat(text, end, "分")?;
        (eat(text, after, "間").unwrap_or(after), i64::from(whole))
    };
    let end = eat(text, end, "後")?;
    Some((eat(text, end, "に").unwrap_or(end), minutes))
}

/// A date: `今日`, `明日`, `明後日`, `今夜`, `金曜`, `来週の金曜`, `11月20日`, `20日`.
pub(super) fn date(text: &str, start: usize, today: Date) -> Option<DateHit> {
    const DAYS: [(&str, i64, Option<Period>); 11] = [
        ("今日", 0, None),
        ("本日", 0, None),
        ("明日", 1, None),
        ("あした", 1, None),
        ("明後日", 2, None),
        ("あさって", 2, None),
        ("今夜", 0, Some(Period::Evening)),
        ("今晩", 0, Some(Period::Evening)),
        ("今朝", 0, Some(Period::Morning)),
        ("明晩", 1, Some(Period::Evening)),
        ("明朝", 1, Some(Period::Morning)),
    ];
    for (word, offset, period) in DAYS {
        if let Some(end) = eat(text, start, word) {
            let date = today.checked_add(offset.days()).ok()?;
            return Some(DateHit { end, date, period });
        }
    }
    let (end, date) = weekday_at(text, start, today)
        .or_else(|| month_day(text, start, today))
        .or_else(|| day_of_month(text, start, today))?;
    Some(DateHit {
        end,
        date,
        period: None,
    })
}

/// `金曜`, `金曜日`, `今週の金曜`, `来週金曜日`, `再来週の月曜`, `次の金曜`.
fn weekday_at(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    // `先週の金曜` is past.
    if ["先週", "先週の", "前週", "前週の"]
        .iter()
        .any(|word| text[..start].ends_with(word))
    {
        return None;
    }
    let prefixes: [(&str, Week); 4] = [
        ("再来週", Week::AfterNext),
        ("来週", Week::Next),
        ("今週", Week::Coming),
        ("次", Week::Coming),
    ];
    let (mut end, week) = prefixes
        .iter()
        .find_map(|(word, week)| Some((eat(text, start, word)?, *week)))
        .unwrap_or((start, Week::Coming));
    if end > start {
        end = skip_spaces(text, eat(text, end, "の").unwrap_or(end));
    }
    let c = text[end..].chars().next()?;
    let weekday = match c {
        '月' => Weekday::Monday,
        '火' => Weekday::Tuesday,
        '水' => Weekday::Wednesday,
        '木' => Weekday::Thursday,
        '金' => Weekday::Friday,
        '土' => Weekday::Saturday,
        '日' => Weekday::Sunday,
        _ => return None,
    };
    let end = eat(text, end + c.len_utf8(), "曜")?;
    let end = eat(text, end, "日").unwrap_or(end);
    Some((end, weekday_date(today, weekday, week)?))
}

/// `11月20日`, `2026年11月20日`.
fn month_day(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    let (mut end, first) = digits(text, start)?;
    let mut year = None;
    if let Some(after) = eat(text, end, "年") {
        year = Some(first);
        end = after;
    }
    let (after, month) = match year {
        Some(_) => digits(text, end)?,
        None => (end, first),
    };
    let end = eat(text, after, "月")?;
    let (after, day) = digits(text, end)?;
    let end = eat(text, after, "日")?;
    Some((end, month_day_date(today, year, month, day)?))
}

/// `20日`, but not a number of days (`3日後`, `3日间`, `1日中`, `2日目`, `1日1回`).
fn day_of_month(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    // The day of a month and day that is no date (`2月30日`).
    if text[..start].ends_with('月') {
        return None;
    }
    let (after, day) = digits(text, start)?;
    let end = eat(text, after, "日")?;
    let next = text[end..].chars().next();
    if next.is_some_and(|c| "後后前間间中目内以分".contains(c) || super::is_digit(c)) {
        return None;
    }
    Some((end, day_of_month_date(today, day)?))
}

/// `午前`, `午後`, `朝`, `夜`, ...
pub(super) fn period(text: &str, start: usize) -> Option<(usize, Period)> {
    const PERIODS: [(&str, Period); 9] = [
        ("深夜", Period::Night),
        ("未明", Period::Night),
        ("午前", Period::Am),
        ("朝", Period::Morning),
        ("昼", Period::Noon),
        ("午後", Period::Afternoon),
        ("夕方", Period::Evening),
        ("夜", Period::Evening),
        ("晩", Period::Evening),
    ];
    PERIODS
        .iter()
        .find_map(|(word, period)| Some((eat(text, start, word)?, *period)))
}

/// `9時`, `9時半`, `9時30分`, `正午`; kanji (`三時`) only when `numerals` allows them.
pub(super) fn clock(text: &str, start: usize, numerals: bool) -> Option<Clock> {
    if let Some(end) = eat(text, start, "正午") {
        return Some(Clock {
            end,
            hour: 12,
            minute: 0,
            fixed: true,
        });
    }
    let (after, hour) = number(text, start, numerals)?;
    let mut end = eat(text, skip_spaces(text, after), "時")?;
    // `2時間` is a length.
    if hour > 23 || eat_any(text, end, &["間", "间"]).is_some() {
        return None;
    }
    let mut minute = 0;
    if let Some(after) = eat(text, end, "半") {
        minute = 30;
        end = after;
    } else if let Some((after, value)) = digits(text, end)
        && value <= 59
        && let Some(after) = eat(text, after, "分")
    {
        minute = value;
        end = after;
    }
    Some(Clock {
        end,
        hour: hour as i8,
        minute: minute as i8,
        fixed: false,
    })
}
