//! Chinese phrases, read on text whose traditional characters are folded to simplified ones ([`fold`]):
//! `明天 9点`, `下午3点`, `周五` / `週五`, `下周五`, `11月20日`, `20号` / `20號`, `半小时后` / `半小時後`.
//!
//! Speech-to-text writes numbers as Chinese numerals (`九点`, `十一点四十五`, `十一月二十号`). Such an hour on its
//! own (no date or part of the day before it) counts unless it reads as something else: `一点` without minutes
//! ("a little"), `第三点` (an ordinal), or `三点意见` (`点` counting points).

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
        // `半个小时后`.
        end = if had_number {
            after
        } else {
            eat(text, after, "个").unwrap_or(after)
        };
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

/// `11月20日`, `11月20号`, `2026年11月20日`, `十一月二十号`.
fn month_day(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    let (mut end, first) = number(text, start, true)?;
    let mut year = None;
    if let Some(after) = eat(text, end, "年") {
        // A year is in digits (`二零二六年` is not read).
        digits(text, start)?;
        year = Some(first);
        end = after;
    }
    let (after, month) = match year {
        Some(_) => number(text, end, true)?,
        None => (end, first),
    };
    let end = eat(text, after, "月")?;
    let (after, day) = number(text, end, true)?;
    let end = eat_any(text, after, &["日", "号"])?;
    Some((end, month_day_date(today, year, month, day)?))
}

/// What a number followed by `号` usually counts rather than a day of the month (`3号线`, `5号楼`).
const NOT_A_DAY: [char; 16] = [
    '线', '楼', '房', '门', '位', '口', '车', '机', '店', '馆', '院', '厅', '窗', '台', '桌', '床',
];

/// `20号`, `二十号`.
fn day_of_month(text: &str, start: usize, today: Date) -> Option<(usize, Date)> {
    // The day of a month and day that is no date (`2月30日`), or an ordinal (`第二十号`).
    if text[..start].ends_with(['月', '第']) {
        return None;
    }
    let (after, day) = number(text, start, true)?;
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

/// What `点` counts after a number when it is no time of day: `三点意见`, `两点建议`, `三点水` (a radical).
const POINTS: [&str; 20] = [
    "意见", "建议", "要求", "内容", "注意", "想法", "原因", "理由", "问题", "原则", "说明", "结论",
    "看法", "共识", "体会", "好处", "不足", "区别", "补充", "水",
];

/// `9点`, `9 点`, `9点30`, `9点30分`, `9点半`, `9点钟`, `三点一刻`, `十一点四十五`, `十二点零五`. With `dated`
/// (after a date or a part of the day) any hour in Chinese numerals counts; on its own one counts unless it reads
/// as something else (`一点` without minutes, `第三点`, `三点意见`).
pub(super) fn clock(text: &str, start: usize, dated: bool) -> Option<Clock> {
    let (after, hour) = number(text, start, true)?;
    let spoken = digits(text, start).is_none();
    let mut end = eat(text, skip_spaces(text, after), "点")?;
    if hour > 23 || (spoken && text[..start].ends_with('第')) {
        return None;
    }
    let mut minute = None;
    if let Some(after) = eat(text, end, "半") {
        minute = Some(30);
        end = after;
    } else if let Some(after) = eat(text, end, "一刻") {
        minute = Some(15);
        end = after;
    } else if let Some(after) = eat(text, end, "三刻") {
        minute = Some(45);
        end = after;
    } else if let Some((after, value)) = digits(text, end)
        && value <= 59
    {
        minute = Some(value);
        end = eat(text, after, "分").unwrap_or(after);
    } else if let Some((after, value)) = spoken_minute(text, end) {
        minute = Some(value);
        end = after;
    } else if let Some(after) = eat_any(text, end, &["钟", "整"]) {
        // `三点钟` is a time even for 一.
        minute = Some(0);
        end = after;
    }
    if spoken && !dated && minute.is_none() && (hour == 1 || eat_any(text, end, &POINTS).is_some())
    {
        return None;
    }
    Some(Clock {
        end,
        hour: hour as i8,
        minute: minute.unwrap_or(0) as i8,
        fixed: false,
    })
}

/// Minutes in Chinese numerals after `点`: `四十五`, `四十五分`, `零五`, `五分` (a single numeral needs its `分`:
/// `三点五` reads as 3.5 as often as 3:05).
fn spoken_minute(text: &str, start: usize) -> Option<(usize, u32)> {
    let zero = eat(text, start, "零");
    let (after, value) = super::chinese_number(text, zero.unwrap_or(start))?;
    if value > 59 || (zero.is_some() && value > 9) {
        return None;
    }
    let tens = text[start..after].contains('十');
    match eat(text, after, "分") {
        Some(end) => Some((end, value)),
        None if tens || zero.is_some() => Some((after, value)),
        None => None,
    }
}
