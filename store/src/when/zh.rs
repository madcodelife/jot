//! Chinese phrases, read on text whose traditional characters are folded to simplified ones ([`fold`]):
//! `明天 9点`, `下午3点`, `周五` / `週五`, `下周五`, `11月20日`, `20号` / `20號`, `半小时后` / `半小時後`.
//!
//! Hours written as Chinese numerals (`三点`) count only after a date or a part of the day, since `一点` alone
//! usually means "a little".

use jiff::ToSpan as _;
use jiff::civil::{Date, Weekday};

use super::{
    Clock, DateHit, Period, Week, day_of_month_date, digits, eat, eat_any, month_day_date, number,
    skip_spaces, weekday_date,
};

/// `text` with the traditional characters of Chinese time phrases folded to their simplified forms. Each pair
/// is three bytes in UTF-8, so byte offsets stay the same.
pub(super) fn fold(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '後' => '后',
            '週' => '周',
            '禮' => '礼',
            '號' => '号',
            '點' => '点',
            '時' => '时',
            '鐘' => '钟',
            '頭' => '头',
            '個' => '个',
            '兩' => '两',
            '這' => '这',
            '線' => '线',
            '樓' => '楼',
            '門' => '门',
            '車' => '车',
            '機' => '机',
            '館' => '馆',
            '廳' => '厅',
            '臺' => '台',
            '牀' => '床',
            '裡' => '里',
            _ => c,
        })
        .collect()
}

/// The character after `周` that names `weekday` (`周五`).
pub(super) fn weekday_char(weekday: Weekday) -> char {
    match weekday {
        Weekday::Monday => '一',
        Weekday::Tuesday => '二',
        Weekday::Wednesday => '三',
        Weekday::Thursday => '四',
        Weekday::Friday => '五',
        Weekday::Saturday => '六',
        Weekday::Sunday => '日',
    }
}

/// `半小时后`, `2小时后`, `一个半小时后`, `10分钟后`, as the minutes from now.
pub(super) fn relative(text: &str, start: usize) -> Option<(usize, i64)> {
    let (mut end, whole) = number(text, start, true).unwrap_or((start, 0));
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
    let minutes = if let Some(after) = eat_any(text, end, &["小时", "钟头"]) {
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
    let end = eat_any(text, end, &["之后", "以后", "后"])?;
    Some((end, minutes))
}

/// A date: `今天`, `明晚`, `周五`, `下周五`, `11月20日`, `20号`.
pub(super) fn date(text: &str, start: usize, today: Date) -> Option<DateHit> {
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

/// `周五`, `本周五`, `下周五`, `星期五`, `下个礼拜五`, ...
fn weekday_at(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    // `上周五` is past, `一周一次` and `两周` are lengths: none of them is a date.
    if text[..start].ends_with([
        '上', '一', '二', '两', '三', '四', '五', '六', '七', '八', '九', '十', '个',
    ]) {
        return None;
    }
    let (end, week) = match eat_any(text, start, &["下个", "下"]) {
        Some(after) => (after, Week::Next),
        None => (
            eat_any(text, start, &["本", "这个", "这"]).unwrap_or(start),
            Week::Coming,
        ),
    };
    let end = eat_any(text, end, &["星期", "礼拜", "周"])?;
    let c = text[end..].chars().next()?;
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
    Some((end + c.len_utf8(), weekday_date(today, weekday, week)?))
}

/// `11月20日`, `11月20号`, `2026年11月20日`.
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
    let end = eat_any(text, after, &["日", "号"])?;
    Some((end, month_day_date(today, year, month, day)?))
}

/// What a number followed by `号` usually counts rather than a day of the month (`3号线`, `5号楼`).
const NOT_A_DAY: [char; 16] = [
    '线', '楼', '房', '门', '位', '口', '车', '机', '店', '馆', '院', '厅', '窗', '台', '桌', '床',
];

/// `20号`.
fn day_of_month(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    // The day of a month and day that is no date (`2月30日`).
    if text[..start].ends_with('月') {
        return None;
    }
    let (after, day) = digits(text, start)?;
    let end = eat(text, after, "号")?;
    if text[end..].starts_with(NOT_A_DAY) {
        return None;
    }
    Some((end, day_of_month_date(today, day)?))
}

/// `早上`, `下午`, `晚上`, ...
pub(super) fn period(text: &str, start: usize) -> Option<(usize, Period)> {
    const PERIODS: [(&str, Period); 10] = [
        ("凌晨", Period::Night),
        ("早上", Period::Morning),
        ("早晨", Period::Morning),
        ("上午", Period::Morning),
        ("中午", Period::Noon),
        ("下午", Period::Afternoon),
        ("傍晚", Period::Evening),
        ("晚上", Period::Evening),
        ("夜里", Period::Evening),
        ("今晚", Period::Evening),
    ];
    PERIODS
        .iter()
        .find_map(|(word, period)| Some((eat(text, start, word)?, *period)))
}

/// `9点`, `9 点`, `9点30`, `9点30分`, `9点半`; Chinese numerals (`三点`) only when `numerals` allows them.
pub(super) fn clock(text: &str, start: usize, numerals: bool) -> Option<Clock> {
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
        minute = value;
        end = eat(text, after, "分").unwrap_or(after);
    }
    Some(Clock {
        end,
        hour: hour as i8,
        minute: minute as i8,
        fixed: false,
    })
}
