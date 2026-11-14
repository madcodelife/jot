//! English phrases, in any letter case: `today` / `tomorrow` / `the day after tomorrow`, `tonight`,
//! `this afternoon`, `fri` / `friday`, `next friday`, `nov 20` / `20 nov` / `11/20`, `9am` / `3:30 pm` / `noon`,
//! `in 30 min` / `in half an hour` / `in 2 hours`.
//!
//! Words count only whole (`mon` is not in `money`). `sat`, `sun` and `wed` are also everyday words, so as
//! weekdays they need a capital (`Sat`), or `on`, `this` or `next` before them; month names always need a day.
//! A bare hour counts only after a date and `at` (`tomorrow at 9`).

use jiff::ToSpan as _;
use jiff::civil::{Date, Weekday};

use super::{Clock, DateHit, Period, Week, digits, month_day_date, skip_spaces, weekday_date};

/// `Fri`.
pub(super) fn weekday_short(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Monday => "Mon",
        Weekday::Tuesday => "Tue",
        Weekday::Wednesday => "Wed",
        Weekday::Thursday => "Thu",
        Weekday::Friday => "Fri",
        Weekday::Saturday => "Sat",
        Weekday::Sunday => "Sun",
    }
}

/// `Nov`, for months 1 to 12.
pub(super) fn month_short(month: i8) -> &'static str {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    MONTHS[usize::try_from(month - 1).unwrap_or(0).min(11)]
}

/// The end of the whole word `word` (ASCII, any case) at `start`.
pub(super) fn word(text: &str, start: usize, word: &str) -> Option<usize> {
    if text[..start].ends_with(|c: char| c.is_ascii_alphanumeric()) {
        return None;
    }
    suffix(text, start, word)
}

/// The end of `word` (ASCII, any case) at `start` when no letter or digit follows it.
fn suffix(text: &str, start: usize, word: &str) -> Option<usize> {
    let end = start + word.len();
    let found = text.get(start..end)?;
    if !found.eq_ignore_ascii_case(word)
        || text[end..].starts_with(|c: char| c.is_ascii_alphanumeric())
    {
        return None;
    }
    Some(end)
}

/// The end of `words`, whole and apart by spaces, at `start`.
fn words(text: &str, start: usize, words: &[&str]) -> Option<usize> {
    let mut end = start;
    for (index, w) in words.iter().enumerate() {
        if index > 0 {
            let after = skip_spaces(text, end);
            if after == end {
                return None;
            }
            end = after;
        }
        end = word(text, end, w)?;
    }
    Some(end)
}

/// `in 30 min`, `in 2 hours`, `in 2h`, `in an hour`, `in half an hour`, `in an hour and a half`, as the minutes
/// from now.
pub(super) fn relative(text: &str, start: usize) -> Option<(usize, i64)> {
    let cursor = skip_spaces(text, word(text, start, "in")?);
    if let Some(end) = ["an", "a"]
        .iter()
        .find_map(|article| words(text, cursor, &["half", article, "hour"]))
    {
        return Some((end, 30));
    }
    let (end, count) = match ["an", "a"]
        .iter()
        .find_map(|article| word(text, cursor, article))
    {
        Some(after) => (skip_spaces(text, after), 1),
        None => {
            let (after, count) = digits(text, cursor)?;
            (skip_spaces(text, after), count)
        }
    };
    const HOURS: [&str; 5] = ["hours", "hour", "hrs", "hr", "h"];
    const MINUTES: [&str; 5] = ["minutes", "minute", "mins", "min", "m"];
    if let Some(end) = HOURS.iter().find_map(|unit| suffix(text, end, unit)) {
        let half = words(text, skip_spaces(text, end), &["and", "a", "half"]);
        return Some(match half {
            Some(end) => (end, i64::from(count) * 60 + 30),
            None => (end, i64::from(count) * 60),
        });
    }
    let end = MINUTES.iter().find_map(|unit| suffix(text, end, unit))?;
    Some((end, i64::from(count)))
}

/// A date, optionally after `on`: `today`, `tonight`, `fri`, `next friday`, `nov 20`, `20 nov`, `11/20`.
pub(super) fn date(text: &str, start: usize, today: Date) -> Option<DateHit> {
    let on = word(text, start, "on").map(|after| skip_spaces(text, after));
    let pos = on.unwrap_or(start);
    const DAYS: [(&[&str], i64, Option<Period>); 10] = [
        (&["the", "day", "after", "tomorrow"], 2, None),
        (&["day", "after", "tomorrow"], 2, None),
        (&["today"], 0, None),
        (&["tonight"], 0, Some(Period::Evening)),
        (&["tomorrow"], 1, None),
        (&["tmrw"], 1, None),
        (&["tmr"], 1, None),
        (&["this", "morning"], 0, Some(Period::Morning)),
        (&["this", "afternoon"], 0, Some(Period::Afternoon)),
        (&["this", "evening"], 0, Some(Period::Evening)),
    ];
    for (phrase, offset, period) in DAYS {
        if let Some(end) = words(text, pos, phrase) {
            let date = today.checked_add(offset.days()).ok()?;
            return Some(DateHit { end, date, period });
        }
    }
    let (end, date) = weekday_at(text, pos, today, on.is_some())
        .or_else(|| month_day(text, pos, today))
        .or_else(|| day_month(text, pos, today))
        .or_else(|| numeric(text, pos, today))?;
    Some(DateHit {
        end,
        date,
        period: None,
    })
}

/// `fri`, `friday`, `this friday`, `next friday`; not `last friday`.
fn weekday_at(text: &str, start: usize, today: Date, after_on: bool) -> Option<(usize, Date)> {
    let before = text[..start].trim_end();
    if before.len() >= 4
        && before.is_char_boundary(before.len() - 4)
        && before[before.len() - 4..].eq_ignore_ascii_case("last")
        && word(before, before.len() - 4, "last").is_some()
    {
        return None;
    }
    let (pos, week) = if let Some(after) = word(text, start, "next") {
        (skip_spaces(text, after), Week::Next)
    } else if let Some(after) = ["this", "coming"].iter().find_map(|w| word(text, start, w)) {
        (skip_spaces(text, after), Week::Coming)
    } else {
        (start, Week::Coming)
    };
    let prefixed = after_on || pos > start;
    const NAMES: [(&str, Weekday); 17] = [
        ("monday", Weekday::Monday),
        ("tuesday", Weekday::Tuesday),
        ("wednesday", Weekday::Wednesday),
        ("thursday", Weekday::Thursday),
        ("friday", Weekday::Friday),
        ("saturday", Weekday::Saturday),
        ("sunday", Weekday::Sunday),
        ("mon", Weekday::Monday),
        ("tues", Weekday::Tuesday),
        ("tue", Weekday::Tuesday),
        ("wed", Weekday::Wednesday),
        ("thurs", Weekday::Thursday),
        ("thur", Weekday::Thursday),
        ("thu", Weekday::Thursday),
        ("fri", Weekday::Friday),
        ("sat", Weekday::Saturday),
        ("sun", Weekday::Sunday),
    ];
    let (end, weekday) = NAMES.iter().find_map(|(name, weekday)| {
        let end = word(text, pos, name)?;
        let everyday = matches!(*name, "sat" | "sun" | "wed");
        if everyday && !prefixed && !text[pos..].starts_with(|c: char| c.is_ascii_uppercase()) {
            return None;
        }
        Some((end, *weekday))
    })?;
    Some((end, weekday_date(today, weekday, week)?))
}

/// A month's name or its short form (`nov`, `nov.`, `november`), as its end and number.
fn month_name(text: &str, start: usize) -> Option<(usize, u32)> {
    const NAMES: [(&str, u32); 24] = [
        ("january", 1),
        ("february", 2),
        ("march", 3),
        ("april", 4),
        ("may", 5),
        ("june", 6),
        ("july", 7),
        ("august", 8),
        ("september", 9),
        ("october", 10),
        ("november", 11),
        ("december", 12),
        ("jan", 1),
        ("feb", 2),
        ("mar", 3),
        ("apr", 4),
        ("jun", 6),
        ("jul", 7),
        ("aug", 8),
        ("sept", 9),
        ("sep", 9),
        ("oct", 10),
        ("nov", 11),
        ("dec", 12),
    ];
    NAMES.iter().find_map(|(name, month)| {
        let end = word(text, start, name)?;
        let end = if text[end..].starts_with('.') && name.len() <= 4 {
            end + 1
        } else {
            end
        };
        Some((end, *month))
    })
}

/// A day of the month in digits, optionally ordinal (`20`, `20th`, `1st`).
fn day_number(text: &str, start: usize) -> Option<(usize, u32)> {
    let (after, day) = digits(text, start)?;
    if after - start > 2 {
        return None;
    }
    let end = ["st", "nd", "rd", "th"]
        .iter()
        .find_map(|ordinal| suffix(text, after, ordinal))
        .unwrap_or(after);
    if text[end..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == ':' || c == '/') {
        return None;
    }
    Some((end, day))
}

/// A year after a date: `, 2027` or ` 2027`.
fn year(text: &str, start: usize) -> Option<(usize, u32)> {
    let cursor = skip_spaces(
        text,
        text[start..]
            .starts_with(',')
            .then_some(start + 1)
            .unwrap_or(start),
    );
    if cursor == start {
        return None;
    }
    let (end, year) = digits(text, cursor)?;
    if end - cursor != 4 || text[end..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == ':')
    {
        return None;
    }
    Some((end, year))
}

/// `nov 20`, `November 20th`, `nov 20, 2027`.
fn month_day(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    let (after, month) = month_name(text, start)?;
    let (end, day) = day_number(text, skip_spaces(text, after))?;
    let (end, year) = year(text, end).map_or((end, None), |(end, year)| (end, Some(year)));
    Some((end, month_day_date(today, year, month, day)?))
}

/// `20 nov`, `20th of November`, `20 nov 2027`.
fn day_month(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    let (after, day) = day_number(text, start)?;
    let cursor = skip_spaces(text, after);
    if cursor == after {
        return None;
    }
    let cursor = word(text, cursor, "of").map_or(cursor, |of| skip_spaces(text, of));
    let (end, month) = month_name(text, cursor)?;
    let (end, year) = year(text, end).map_or((end, None), |(end, year)| (end, Some(year)));
    Some((end, month_day_date(today, year, month, day)?))
}

/// `11/20`, `11/20/2027`, `11/20/27`: month first.
fn numeric(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    if text[..start].ends_with('/') {
        return None;
    }
    let (after, month) = digits(text, start)?;
    let slash = after
        .checked_add(1)
        .filter(|_| text[after..].starts_with('/'))?;
    let (mut end, day) = digits(text, slash)?;
    if after - start > 2 || end - slash > 2 || !(1..=12).contains(&month) {
        return None;
    }
    let mut year = None;
    if text[end..].starts_with('/')
        && let Some((after, value)) = digits(text, end + 1)
        && matches!(after - end - 1, 2 | 4)
    {
        year = Some(if value < 100 { 2000 + value } else { value });
        end = after;
    }
    if text[end..].starts_with(|c: char| c == '/' || c.is_ascii_alphanumeric()) {
        return None;
    }
    Some((end, month_day_date(today, year, month, day)?))
}

/// `morning`, `afternoon`, `evening`, `night`: after a date (`tomorrow afternoon`).
pub(super) fn period(text: &str, start: usize) -> Option<(usize, Period)> {
    const PERIODS: [(&str, Period); 4] = [
        ("morning", Period::Morning),
        ("afternoon", Period::Afternoon),
        ("evening", Period::Evening),
        ("night", Period::Evening),
    ];
    PERIODS
        .iter()
        .find_map(|(name, period)| Some((word(text, start, name)?, *period)))
}

/// `9am`, `9 am`, `9:30pm`, `9:30 p.m.`, `12am`, `9 o'clock`, `noon`, `midnight`, and, when `bare` allows,
/// an hour alone (`at 9`).
pub(super) fn clock(text: &str, start: usize, bare: bool) -> Option<Clock> {
    let fixed = |end, hour| Clock {
        end,
        hour,
        minute: 0,
        fixed: true,
    };
    if let Some(end) = ["noon", "midday"].iter().find_map(|w| word(text, start, w)) {
        return Some(fixed(end, 12));
    }
    if let Some(end) = word(text, start, "midnight") {
        return Some(fixed(end, 24));
    }
    let (after, hour) = digits(text, start)?;
    if after - start > 2 {
        return None;
    }
    let mut end = after;
    let mut minute = None;
    if let Some(rest) = text[after..].strip_prefix(':')
        && rest.len() >= 2
        && rest.as_bytes()[..2].iter().all(u8::is_ascii_digit)
        && !rest[2..].starts_with(|c: char| c.is_ascii_digit())
    {
        minute = Some(rest[..2].parse::<u32>().ok()?);
        end = after + 3;
    }
    let cursor = skip_spaces(text, end);
    let meridiem = [("a.m.", false), ("p.m.", true), ("am", false), ("pm", true)]
        .iter()
        .find_map(|(word, pm)| {
            let found = text.get(cursor..cursor + word.len())?;
            let end = cursor + word.len();
            (found.eq_ignore_ascii_case(word)
                && !text[end..].starts_with(|c: char| c.is_ascii_alphanumeric()))
            .then_some((end, *pm))
        });
    let minute = minute.unwrap_or(0);
    if minute > 59 {
        return None;
    }
    if let Some((end, pm)) = meridiem {
        if !(1..=12).contains(&hour) {
            return None;
        }
        let hour = hour % 12 + if pm { 12 } else { 0 };
        return Some(Clock {
            end,
            hour: hour as i8,
            minute: minute as i8,
            fixed: true,
        });
    }
    if end > after || hour > 23 {
        // `9:30` alone is every language's (`super::colon_clock`).
        return None;
    }
    if let Some(end) = ["o'clock", "o’clock"].iter().find_map(|w| {
        let found = text.get(cursor..cursor + w.len())?;
        found.eq_ignore_ascii_case(w).then_some(cursor + w.len())
    }) {
        return Some(Clock {
            end,
            hour: hour as i8,
            minute: 0,
            fixed: false,
        });
    }
    if bare && !text[end..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == ':' || c == '/')
    {
        return Some(Clock {
            end,
            hour: hour as i8,
            minute: 0,
            fixed: false,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{suffix, word};

    #[test]
    fn whole_words() {
        assert_eq!(word("on Mon", 3, "mon"), Some(6));
        assert_eq!(word("money", 0, "mon"), None);
        assert_eq!(word("lemon", 2, "mon"), None);
        assert_eq!(suffix("9am", 1, "am"), Some(3));
        assert_eq!(suffix("9amp", 1, "am"), None);
    }
}
