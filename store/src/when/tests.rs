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

/// Checks each `(text, phrase, time, label)` case, read at `now` with the label in `lang`.
fn check(now: DateTime, lang: Lang, cases: &[(&str, &str, DateTime, &str)]) {
    let options = Options {
        lang,
        ..Options::default()
    };
    for &(text, phrase, expected, label) in cases {
        let found =
            parse_with(text, now, &options).unwrap_or_else(|| panic!("no phrase in {text:?}"));
        assert_eq!(&text[found.range.clone()], phrase, "{text:?}");
        assert_eq!(found.at, expected, "{text:?}");
        assert_eq!(found.label, label, "{text:?}");
    }
}

fn no_phrase_in(texts: &[&str]) {
    for text in texts {
        assert_eq!(parse(text, now()), None, "{text:?}");
    }
}

#[test]
fn english() {
    let t = |h, min| at(2026, 11, 13, h, min);
    let cases: &[(&str, &str, DateTime, &str)] = &[
        // Days.
        ("today", "today", t(9, 0), "Today 9:00 AM"),
        (
            "Tomorrow",
            "Tomorrow",
            at(2026, 11, 14, 9, 0),
            "Tomorrow 9:00 AM",
        ),
        ("tmrw", "tmrw", at(2026, 11, 14, 9, 0), "Tomorrow 9:00 AM"),
        (
            "the day after tomorrow",
            "the day after tomorrow",
            at(2026, 11, 15, 9, 0),
            "Sun 9:00 AM",
        ),
        (
            "day after tomorrow 3pm",
            "day after tomorrow 3pm",
            at(2026, 11, 15, 15, 0),
            "Sun 3:00 PM",
        ),
        (
            "tomorrow 9am",
            "tomorrow 9am",
            at(2026, 11, 14, 9, 0),
            "Tomorrow 9:00 AM",
        ),
        (
            "tomorrow at 9",
            "tomorrow at 9",
            at(2026, 11, 14, 9, 0),
            "Tomorrow 9:00 AM",
        ),
        (
            "tomorrow at 9:30",
            "tomorrow at 9:30",
            at(2026, 11, 14, 9, 30),
            "Tomorrow 9:30 AM",
        ),
        (
            "TOMORROW AT 4 PM",
            "TOMORROW AT 4 PM",
            at(2026, 11, 14, 16, 0),
            "Tomorrow 4:00 PM",
        ),
        (
            "tomorrow afternoon",
            "tomorrow afternoon",
            at(2026, 11, 14, 15, 0),
            "Tomorrow 3:00 PM",
        ),
        (
            "tomorrow afternoon at 3",
            "tomorrow afternoon at 3",
            at(2026, 11, 14, 15, 0),
            "Tomorrow 3:00 PM",
        ),
        (
            "tomorrow night",
            "tomorrow night",
            at(2026, 11, 14, 20, 0),
            "Tomorrow 8:00 PM",
        ),
        (
            "tomorrow noon",
            "tomorrow noon",
            at(2026, 11, 14, 12, 0),
            "Tomorrow 12:00 PM",
        ),
        ("tonight", "tonight", t(20, 0), "Today 8:00 PM"),
        ("tonight at 9", "tonight at 9", t(21, 0), "Today 9:00 PM"),
        (
            "this afternoon",
            "this afternoon",
            t(15, 0),
            "Today 3:00 PM",
        ),
        // Weekdays (now is a Friday).
        ("fri", "fri", t(9, 0), "Today 9:00 AM"),
        ("friday", "friday", t(9, 0), "Today 9:00 AM"),
        ("Sat", "Sat", at(2026, 11, 14, 9, 0), "Tomorrow 9:00 AM"),
        (
            "on sat",
            "on sat",
            at(2026, 11, 14, 9, 0),
            "Tomorrow 9:00 AM",
        ),
        (
            "this sunday",
            "this sunday",
            at(2026, 11, 15, 9, 0),
            "Sun 9:00 AM",
        ),
        ("mon", "mon", at(2026, 11, 16, 9, 0), "Mon 9:00 AM"),
        (
            "Monday 10am",
            "Monday 10am",
            at(2026, 11, 16, 10, 0),
            "Mon 10:00 AM",
        ),
        ("thurs", "thurs", at(2026, 11, 19, 9, 0), "Thu 9:00 AM"),
        (
            "next mon",
            "next mon",
            at(2026, 11, 16, 9, 0),
            "Mon 9:00 AM",
        ),
        // "next friday" on a Friday is a week away.
        (
            "next friday",
            "next friday",
            at(2026, 11, 20, 9, 0),
            "Nov 20 9:00 AM",
        ),
        (
            "next Friday at 2:30pm",
            "next Friday at 2:30pm",
            at(2026, 11, 20, 14, 30),
            "Nov 20 2:30 PM",
        ),
        // Month and day.
        ("nov 20", "nov 20", at(2026, 11, 20, 9, 0), "Nov 20 9:00 AM"),
        (
            "Nov. 20th",
            "Nov. 20th",
            at(2026, 11, 20, 9, 0),
            "Nov 20 9:00 AM",
        ),
        (
            "November 20, 2027",
            "November 20, 2027",
            at(2027, 11, 20, 9, 0),
            "Nov 20 9:00 AM",
        ),
        ("20 nov", "20 nov", at(2026, 11, 20, 9, 0), "Nov 20 9:00 AM"),
        (
            "20th of November 5pm",
            "20th of November 5pm",
            at(2026, 11, 20, 17, 0),
            "Nov 20 5:00 PM",
        ),
        ("nov 12", "nov 12", at(2027, 11, 12, 9, 0), "Nov 12 9:00 AM"),
        ("11/20", "11/20", at(2026, 11, 20, 9, 0), "Nov 20 9:00 AM"),
        (
            "1/3 8:00",
            "1/3 8:00",
            at(2027, 1, 3, 8, 0),
            "Jan 3 8:00 AM",
        ),
        (
            "12/31/2026",
            "12/31/2026",
            at(2026, 12, 31, 9, 0),
            "Dec 31 9:00 AM",
        ),
        ("feb 29", "feb 29", at(2028, 2, 29, 9, 0), "Feb 29 9:00 AM"),
        // Times alone: today, or tomorrow once past.
        ("9am", "9am", at(2026, 11, 14, 9, 0), "Tomorrow 9:00 AM"),
        ("3pm", "3pm", t(15, 0), "Today 3:00 PM"),
        ("3:30 p.m.", "3:30 p.m.", t(15, 30), "Today 3:30 PM"),
        ("15:00", "15:00", t(15, 0), "Today 3:00 PM"),
        ("12am", "12am", at(2026, 11, 14, 0, 0), "Tomorrow 12:00 AM"),
        ("12pm", "12pm", t(12, 0), "Today 12:00 PM"),
        (
            "12:30am",
            "12:30am",
            at(2026, 11, 14, 0, 30),
            "Tomorrow 12:30 AM",
        ),
        ("noon", "noon", t(12, 0), "Today 12:00 PM"),
        (
            "midnight",
            "midnight",
            at(2026, 11, 14, 0, 0),
            "Tomorrow 12:00 AM",
        ),
        ("11 o'clock", "11 o'clock", t(11, 0), "Today 11:00 AM"),
        ("at 3pm", "at 3pm", t(15, 0), "Today 3:00 PM"),
        // A time, then a date.
        (
            "3pm tomorrow",
            "3pm tomorrow",
            at(2026, 11, 14, 15, 0),
            "Tomorrow 3:00 PM",
        ),
        ("9am on friday", "9am on friday", t(9, 0), "Today 9:00 AM"),
        (
            "10:30 next monday",
            "10:30 next monday",
            at(2026, 11, 16, 10, 30),
            "Mon 10:30 AM",
        ),
        // From now.
        ("in 30 min", "in 30 min", t(11, 0), "Today 11:00 AM"),
        ("in 30 minutes", "in 30 minutes", t(11, 0), "Today 11:00 AM"),
        ("in 30min", "in 30min", t(11, 0), "Today 11:00 AM"),
        (
            "in half an hour",
            "in half an hour",
            t(11, 0),
            "Today 11:00 AM",
        ),
        ("in an hour", "in an hour", t(11, 30), "Today 11:30 AM"),
        ("in 2 hours", "in 2 hours", t(12, 30), "Today 12:30 PM"),
        ("in 2h", "in 2h", t(12, 30), "Today 12:30 PM"),
        (
            "in an hour and a half",
            "in an hour and a half",
            t(12, 0),
            "Today 12:00 PM",
        ),
        (
            "in 20 hours",
            "in 20 hours",
            at(2026, 11, 14, 6, 30),
            "Tomorrow 6:30 AM",
        ),
        // In a sentence.
        (
            "Pay rent tomorrow 9am",
            "tomorrow 9am",
            at(2026, 11, 14, 9, 0),
            "Tomorrow 9:00 AM",
        ),
        ("call mom at 8pm", "at 8pm", t(20, 0), "Today 8:00 PM"),
        (
            "submit the report next friday please",
            "next friday",
            at(2026, 11, 20, 9, 0),
            "Nov 20 9:00 AM",
        ),
        (
            "dentist on Monday at 4",
            "on Monday at 4",
            at(2026, 11, 16, 16, 0),
            "Mon 4:00 PM",
        ),
        // Mixed with Chinese.
        (
            "交房租 tomorrow 9am",
            "tomorrow 9am",
            at(2026, 11, 14, 9, 0),
            "Tomorrow 9:00 AM",
        ),
        (
            "明天 3pm",
            "明天 3pm",
            at(2026, 11, 14, 15, 0),
            "Tomorrow 3:00 PM",
        ),
        (
            "tomorrow 下午3点",
            "tomorrow 下午3点",
            at(2026, 11, 14, 15, 0),
            "Tomorrow 3:00 PM",
        ),
    ];
    check(now(), Lang::En, cases);
    no_phrase_in(&[
        "money",
        "lemon tart",
        "I sat down",
        "the sun is up",
        "they wed in may",
        "may",
        "someday",
        "last friday's notes",
        "good morning",
        "in the morning",
        "meet at 5",
        "1/2/3",
        "13/20",
        "nov 31",
        "in 0 min",
        "13pm",
        "0am",
        "a 9 amp fuse",
        "within 30 min",
    ]);
}

#[test]
fn traditional_chinese() {
    let t = |h, min| at(2026, 11, 13, h, min);
    let cases: &[(&str, &str, DateTime, &str)] = &[
        ("今天", "今天", t(9, 0), "今天 09:00"),
        ("明天 9點", "明天 9點", at(2026, 11, 14, 9, 0), "明天 09:00"),
        ("後天", "後天", at(2026, 11, 15, 9, 0), "後天 09:00"),
        ("週一", "週一", at(2026, 11, 16, 9, 0), "週一 09:00"),
        ("星期一", "星期一", at(2026, 11, 16, 9, 0), "週一 09:00"),
        ("禮拜三", "禮拜三", at(2026, 11, 18, 9, 0), "週三 09:00"),
        ("這週六", "這週六", at(2026, 11, 14, 9, 0), "明天 09:00"),
        ("週五", "週五", t(9, 0), "今天 09:00"),
        ("下週五", "下週五", at(2026, 11, 20, 9, 0), "11月20日 09:00"),
        (
            "下個週日下午2點",
            "下個週日下午2點",
            at(2026, 11, 22, 14, 0),
            "11月22日 14:00",
        ),
        (
            "11月20日",
            "11月20日",
            at(2026, 11, 20, 9, 0),
            "11月20日 09:00",
        ),
        ("20號", "20號", at(2026, 11, 20, 9, 0), "11月20日 09:00"),
        ("9點", "9點", at(2026, 11, 14, 9, 0), "明天 09:00"),
        ("9點半", "9點半", at(2026, 11, 14, 9, 30), "明天 09:30"),
        ("下午3點", "下午3點", t(15, 0), "今天 15:00"),
        ("晚上12點", "晚上12點", at(2026, 11, 14, 0, 0), "明天 00:00"),
        (
            "明天夜裡10點",
            "明天夜裡10點",
            at(2026, 11, 14, 22, 0),
            "明天 22:00",
        ),
        ("半小時後", "半小時後", t(11, 0), "今天 11:00"),
        ("2小時後", "2小時後", t(12, 30), "今天 12:30"),
        ("兩小時後", "兩小時後", t(12, 30), "今天 12:30"),
        ("一個半小時後", "一個半小時後", t(12, 0), "今天 12:00"),
        ("十分鐘之後", "十分鐘之後", t(10, 40), "今天 10:40"),
        (
            "繳房租 明天 9:00",
            "明天 9:00",
            at(2026, 11, 14, 9, 0),
            "明天 09:00",
        ),
    ];
    check(now(), Lang::ZhHant, cases);
    no_phrase_in(&[
        "上週五的會議紀錄",
        "兩週後再說",
        "坐3號線",
        "住在5號樓",
        "差一點忘了",
    ]);
}

#[test]
fn japanese() {
    let t = |h, min| at(2026, 11, 13, h, min);
    let cases: &[(&str, &str, DateTime, &str)] = &[
        ("今日", "今日", t(9, 0), "今日 9:00"),
        ("明日", "明日", at(2026, 11, 14, 9, 0), "明日 9:00"),
        ("あした", "あした", at(2026, 11, 14, 9, 0), "明日 9:00"),
        ("明後日", "明後日", at(2026, 11, 15, 9, 0), "明後日 9:00"),
        ("今夜", "今夜", t(20, 0), "今日 20:00"),
        ("明朝", "明朝", at(2026, 11, 14, 9, 0), "明日 9:00"),
        ("金曜", "金曜", t(9, 0), "今日 9:00"),
        ("月曜", "月曜", at(2026, 11, 16, 9, 0), "月曜 9:00"),
        ("木曜日", "木曜日", at(2026, 11, 19, 9, 0), "木曜 9:00"),
        (
            "今週の土曜",
            "今週の土曜",
            at(2026, 11, 14, 9, 0),
            "明日 9:00",
        ),
        (
            "来週の金曜",
            "来週の金曜",
            at(2026, 11, 20, 9, 0),
            "11月20日 9:00",
        ),
        (
            "来週金曜日 15時",
            "来週金曜日 15時",
            at(2026, 11, 20, 15, 0),
            "11月20日 15:00",
        ),
        (
            "再来週の月曜",
            "再来週の月曜",
            at(2026, 11, 23, 9, 0),
            "11月23日 9:00",
        ),
        (
            "11月20日",
            "11月20日",
            at(2026, 11, 20, 9, 0),
            "11月20日 9:00",
        ),
        (
            "2027年1月5日",
            "2027年1月5日",
            at(2027, 1, 5, 9, 0),
            "1月5日 9:00",
        ),
        ("20日", "20日", at(2026, 11, 20, 9, 0), "11月20日 9:00"),
        ("5日", "5日", at(2026, 12, 5, 9, 0), "12月5日 9:00"),
        ("9時", "9時", at(2026, 11, 14, 9, 0), "明日 9:00"),
        ("9時半", "9時半", at(2026, 11, 14, 9, 30), "明日 9:30"),
        ("11時15分", "11時15分", t(11, 15), "今日 11:15"),
        ("午後3時", "午後3時", t(15, 0), "今日 15:00"),
        ("午後12時", "午後12時", t(12, 0), "今日 12:00"),
        ("午前12時", "午前12時", at(2026, 11, 14, 0, 0), "明日 0:00"),
        ("正午", "正午", t(12, 0), "今日 12:00"),
        ("夜9時", "夜9時", t(21, 0), "今日 21:00"),
        (
            "明日の午後3時",
            "明日の午後3時",
            at(2026, 11, 14, 15, 0),
            "明日 15:00",
        ),
        (
            "明日の午後",
            "明日の午後",
            at(2026, 11, 14, 15, 0),
            "明日 15:00",
        ),
        (
            "明日の三時",
            "明日の三時",
            at(2026, 11, 14, 15, 0),
            "明日 15:00",
        ),
        (
            "明日 15:00",
            "明日 15:00",
            at(2026, 11, 14, 15, 0),
            "明日 15:00",
        ),
        (
            "明日１５時",
            "明日１５時",
            at(2026, 11, 14, 15, 0),
            "明日 15:00",
        ),
        ("30分後", "30分後", t(11, 0), "今日 11:00"),
        ("３０分後", "３０分後", t(11, 0), "今日 11:00"),
        ("2時間後", "2時間後", t(12, 30), "今日 12:30"),
        ("1時間半後", "1時間半後", t(12, 0), "今日 12:00"),
        ("二時間後に", "二時間後に", t(12, 30), "今日 12:30"),
        (
            "明日の午後3時に会議",
            "明日の午後3時",
            at(2026, 11, 14, 15, 0),
            "明日 15:00",
        ),
        (
            "会議 来週の金曜 15時",
            "来週の金曜 15時",
            at(2026, 11, 20, 15, 0),
            "11月20日 15:00",
        ),
        (
            "家賃 tomorrow",
            "tomorrow",
            at(2026, 11, 14, 9, 0),
            "明日 9:00",
        ),
    ];
    check(now(), Lang::Ja, cases);
    no_phrase_in(&[
        "先週の金曜の会議",
        "2時間勉強する",
        "3日後",
        "3日間",
        "1日1回",
        "1日中",
        "日本",
        "2月30日",
    ]);
}

#[test]
fn every_language_across_month_and_year_ends() {
    // Wednesday 2026-12-30 18:00.
    let now = date(2026, 12, 30).at(18, 0, 0, 0);
    check(
        now,
        Lang::En,
        &[
            (
                "tomorrow",
                "tomorrow",
                at(2026, 12, 31, 9, 0),
                "Tomorrow 9:00 AM",
            ),
            (
                "the day after tomorrow",
                "the day after tomorrow",
                at(2027, 1, 1, 9, 0),
                "Fri 9:00 AM",
            ),
            ("fri", "fri", at(2027, 1, 1, 9, 0), "Fri 9:00 AM"),
            ("next mon", "next mon", at(2027, 1, 4, 9, 0), "Mon 9:00 AM"),
            ("jan 3", "jan 3", at(2027, 1, 3, 9, 0), "Sun 9:00 AM"),
            ("12/1", "12/1", at(2027, 12, 1, 9, 0), "Dec 1 9:00 AM"),
            (
                "in 8 hours",
                "in 8 hours",
                at(2026, 12, 31, 2, 0),
                "Tomorrow 2:00 AM",
            ),
            ("5pm", "5pm", at(2026, 12, 31, 17, 0), "Tomorrow 5:00 PM"),
        ],
    );
    check(
        now,
        Lang::ZhHant,
        &[
            ("後天", "後天", at(2027, 1, 1, 9, 0), "後天 09:00"),
            ("下週一", "下週一", at(2027, 1, 4, 9, 0), "週一 09:00"),
            ("3號", "3號", at(2027, 1, 3, 9, 0), "週日 09:00"),
            ("8小時後", "8小時後", at(2026, 12, 31, 2, 0), "明天 02:00"),
        ],
    );
    check(
        now,
        Lang::Ja,
        &[
            ("明後日", "明後日", at(2027, 1, 1, 9, 0), "明後日 9:00"),
            (
                "来週の月曜",
                "来週の月曜",
                at(2027, 1, 4, 9, 0),
                "月曜 9:00",
            ),
            ("3日", "3日", at(2027, 1, 3, 9, 0), "日曜 9:00"),
            ("1月3日", "1月3日", at(2027, 1, 3, 9, 0), "日曜 9:00"),
            ("12月1日", "12月1日", at(2027, 12, 1, 9, 0), "12月1日 9:00"),
            ("8時間後", "8時間後", at(2026, 12, 31, 2, 0), "明日 2:00"),
        ],
    );
}

#[test]
fn default_time() {
    let options = Options {
        default_time: jiff::civil::time(8, 30, 0, 0),
        lang: Lang::ZhHans,
    };
    let cases: &[(&str, DateTime)] = &[
        // A date alone takes the default time.
        ("明天", at(2026, 11, 14, 8, 30)),
        ("下週五", at(2026, 11, 20, 8, 30)),
        ("20号", at(2026, 11, 20, 8, 30)),
        ("tomorrow", at(2026, 11, 14, 8, 30)),
        ("nov 20", at(2026, 11, 20, 8, 30)),
        ("明日", at(2026, 11, 14, 8, 30)),
        ("来週の金曜", at(2026, 11, 20, 8, 30)),
        // A part of the day or a time keeps its own.
        ("明天下午", at(2026, 11, 14, 15, 0)),
        ("tomorrow afternoon", at(2026, 11, 14, 15, 0)),
        ("明天 10点", at(2026, 11, 14, 10, 0)),
        ("明晚", at(2026, 11, 14, 20, 0)),
        ("半小时后", at(2026, 11, 13, 11, 0)),
    ];
    for &(text, expected) in cases {
        let found = parse_with(text, now(), &options).unwrap();
        assert_eq!(found.at, expected, "{text:?}");
    }
    // The old entry points keep 09:00.
    assert_eq!(parse("明天", now()).unwrap().at, at(2026, 11, 14, 9, 0));
    assert_eq!(
        normalize_line_with("- [ ] 交房租 tomorrow", now(), &options).as_deref(),
        Some("- [ ] 交房租 ⏰ 2026-11-14 08:30")
    );
    // The file's form has no language.
    let english = Options {
        lang: Lang::En,
        ..Options::default()
    };
    assert_eq!(
        normalize_line_with("- [ ] pay rent tomorrow 3pm", now(), &english).as_deref(),
        Some("- [ ] pay rent ⏰ 2026-11-14 15:00")
    );
    assert_eq!(
        normalize_line_with("- [ ] 家賃 明日の午後3時 払う", now(), &english).as_deref(),
        Some("- [ ] 家賃 払う ⏰ 2026-11-14 15:00")
    );
}

#[test]
fn labels() {
    let now = now();
    // (time, zh-Hans, zh-Hant, en, ja)
    let cases: &[(DateTime, &str, &str, &str, &str)] = &[
        (
            at(2026, 11, 13, 0, 5),
            "今天 00:05",
            "今天 00:05",
            "Today 12:05 AM",
            "今日 0:05",
        ),
        (
            at(2026, 11, 13, 12, 0),
            "今天 12:00",
            "今天 12:00",
            "Today 12:00 PM",
            "今日 12:00",
        ),
        (
            at(2026, 11, 13, 23, 59),
            "今天 23:59",
            "今天 23:59",
            "Today 11:59 PM",
            "今日 23:59",
        ),
        (
            at(2026, 11, 14, 9, 0),
            "明天 09:00",
            "明天 09:00",
            "Tomorrow 9:00 AM",
            "明日 9:00",
        ),
        (
            at(2026, 11, 15, 9, 0),
            "后天 09:00",
            "後天 09:00",
            "Sun 9:00 AM",
            "明後日 9:00",
        ),
        (
            at(2026, 11, 16, 15, 0),
            "周一 15:00",
            "週一 15:00",
            "Mon 3:00 PM",
            "月曜 15:00",
        ),
        (
            at(2026, 11, 19, 15, 0),
            "周四 15:00",
            "週四 15:00",
            "Thu 3:00 PM",
            "木曜 15:00",
        ),
        (
            at(2026, 11, 20, 15, 0),
            "11月20日 15:00",
            "11月20日 15:00",
            "Nov 20 3:00 PM",
            "11月20日 15:00",
        ),
        (
            at(2027, 1, 3, 9, 0),
            "1月3日 09:00",
            "1月3日 09:00",
            "Jan 3 9:00 AM",
            "1月3日 9:00",
        ),
        // A past day is a date.
        (
            at(2026, 11, 12, 9, 0),
            "11月12日 09:00",
            "11月12日 09:00",
            "Nov 12 9:00 AM",
            "11月12日 9:00",
        ),
    ];
    for &(time, hans, hant, en, ja) in cases {
        assert_eq!(label(time, now, Lang::ZhHans), hans);
        assert_eq!(label(time, now, Lang::ZhHant), hant);
        assert_eq!(label(time, now, Lang::En), en);
        assert_eq!(label(time, now, Lang::Ja), ja);
    }
}

#[test]
fn languages_of_locales() {
    for (locale, lang) in [
        ("zh", Lang::ZhHans),
        ("zh-CN", Lang::ZhHans),
        ("zh-Hans-CN", Lang::ZhHans),
        ("zh-Hant", Lang::ZhHant),
        ("zh-TW", Lang::ZhHant),
        ("zh_HK", Lang::ZhHant),
        ("zh-Hant-TW", Lang::ZhHant),
        ("en", Lang::En),
        ("en-US", Lang::En),
        ("ja", Lang::Ja),
        ("ja-JP", Lang::Ja),
        ("fr-FR", Lang::En),
        ("", Lang::En),
    ] {
        assert_eq!(Lang::from_locale(locale), lang, "{locale:?}");
    }
}

#[test]
fn spoken_numerals() {
    // Speech-to-text writes numbers as Chinese numerals and kanji; a time of day in them counts on its own.
    let t = |h, min| at(2026, 11, 13, h, min);
    check(
        now(),
        Lang::ZhHans,
        &[
            ("九点", "九点", at(2026, 11, 14, 9, 0), "明天 09:00"),
            ("三点半", "三点半", t(15, 30), "今天 15:30"),
            ("十一点四十五", "十一点四十五", t(11, 45), "今天 11:45"),
            (
                "十一点四十五分开会",
                "十一点四十五分",
                t(11, 45),
                "今天 11:45",
            ),
            ("十二点零五", "十二点零五", t(12, 5), "今天 12:05"),
            ("十一点一刻", "十一点一刻", t(11, 15), "今天 11:15"),
            ("十点三刻", "十点三刻", t(10, 45), "今天 10:45"),
            ("两点", "两点", t(14, 0), "今天 14:00"),
            ("十一点钟", "十一点钟", t(11, 0), "今天 11:00"),
            ("一点半", "一点半", t(13, 30), "今天 13:30"),
            ("三点开会", "三点", t(15, 0), "今天 15:00"),
            (
                "十一月二十号",
                "十一月二十号",
                at(2026, 11, 20, 9, 0),
                "11月20日 09:00",
            ),
            (
                "十一月二十日下午两点",
                "十一月二十日下午两点",
                at(2026, 11, 20, 14, 0),
                "11月20日 14:00",
            ),
            ("二十号", "二十号", at(2026, 11, 20, 9, 0), "11月20日 09:00"),
            (
                "下周五下午三点",
                "下周五下午三点",
                at(2026, 11, 20, 15, 0),
                "11月20日 15:00",
            ),
            ("明早八点", "明早八点", at(2026, 11, 14, 8, 0), "明天 08:00"),
            ("今晚十点", "今晚十点", t(22, 0), "今天 22:00"),
            ("半个小时后", "半个小时后", t(11, 0), "今天 11:00"),
            ("一个半小时后", "一个半小时后", t(12, 0), "今天 12:00"),
            ("两个小时后", "两个小时后", t(12, 30), "今天 12:30"),
            ("十分钟后", "十分钟后", t(10, 40), "今天 10:40"),
        ],
    );
    check(
        now(),
        Lang::Ja,
        &[
            ("九時", "九時", at(2026, 11, 14, 9, 0), "明日 9:00"),
            ("三時半", "三時半", t(15, 30), "今日 15:30"),
            ("十一時十五分", "十一時十五分", t(11, 15), "今日 11:15"),
            (
                "十一月二十日",
                "十一月二十日",
                at(2026, 11, 20, 9, 0),
                "11月20日 9:00",
            ),
        ],
    );
    no_phrase_in(&[
        "一点",
        "有一点",
        "提三点意见",
        "说两点建议",
        "第三点",
        "三点水",
        "一时",
        "一時停止",
        "一時的に",
        "二十号线",
        "三月份",
    ]);
}

#[test]
fn hours_without_a_part_of_the_day() {
    // 1 to 6 o'clock is the afternoon's, as calendar apps read it; 7 to 12, 0 and 13 to 23 as written; then the
    // next one from now (10:30), whatever the language.
    let t = |h, min| at(2026, 11, 13, h, min);
    let tomorrow = |h, min| at(2026, 11, 14, h, min);
    check(
        now(),
        Lang::ZhHans,
        &[
            ("三点开会", "三点", t(15, 0), "今天 15:00"),
            ("3点", "3点", t(15, 0), "今天 15:00"),
            ("1点", "1点", t(13, 0), "今天 13:00"),
            ("6点半", "6点半", t(18, 30), "今天 18:30"),
            ("3:30", "3:30", t(15, 30), "今天 15:30"),
            ("7点", "7点", tomorrow(7, 0), "明天 07:00"),
            ("9点", "9点", tomorrow(9, 0), "明天 09:00"),
            ("12点", "12点", t(12, 0), "今天 12:00"),
            ("0点", "0点", tomorrow(0, 0), "明天 00:00"),
            ("零点", "零点", tomorrow(0, 0), "明天 00:00"),
            ("15点", "15点", t(15, 0), "今天 15:00"),
            // A leading zero is a 24-hour clock's.
            ("03:00", "03:00", tomorrow(3, 0), "明天 03:00"),
            // With a date too.
            ("明天三点", "明天三点", tomorrow(15, 0), "明天 15:00"),
            (
                "周一 4点",
                "周一 4点",
                at(2026, 11, 16, 16, 0),
                "周一 16:00",
            ),
            // A part of the day decides.
            ("凌晨3点", "凌晨3点", tomorrow(3, 0), "明天 03:00"),
            ("早上6点", "早上6点", tomorrow(6, 0), "明天 06:00"),
            ("晚上7点", "晚上7点", t(19, 0), "今天 19:00"),
        ],
    );
    check(
        now(),
        Lang::Ja,
        &[
            ("三時", "三時", t(15, 0), "今日 15:00"),
            ("午前3時", "午前3時", tomorrow(3, 0), "明日 3:00"),
            ("8時", "8時", tomorrow(8, 0), "明日 8:00"),
        ],
    );
    check(
        now(),
        Lang::En,
        &[
            (
                "tomorrow at 4",
                "tomorrow at 4",
                tomorrow(16, 0),
                "Tomorrow 4:00 PM",
            ),
            (
                "tomorrow at 8",
                "tomorrow at 8",
                tomorrow(8, 0),
                "Tomorrow 8:00 AM",
            ),
            ("4am", "4am", tomorrow(4, 0), "Tomorrow 4:00 AM"),
        ],
    );
    // Past this afternoon's: tomorrow's afternoon.
    let evening = date(2026, 11, 13).at(19, 0, 0, 0);
    let found = parse("三点", evening).unwrap();
    assert_eq!(found.at, tomorrow(15, 0));
}

#[test]
fn rules() {
    // Friday 2026-11-13 10:30: (text, phrase, time, rule, label)
    let cases: &[(&str, &str, DateTime, Repeat, &str)] = &[
        (
            "每天",
            "每天",
            at(2026, 11, 14, 9, 0),
            Repeat::Day,
            "明天 09:00 · 每天",
        ),
        (
            "每日",
            "每日",
            at(2026, 11, 14, 9, 0),
            Repeat::Day,
            "明天 09:00 · 每天",
        ),
        (
            "每天 9点",
            "每天 9点",
            at(2026, 11, 14, 9, 0),
            Repeat::Day,
            "明天 09:00 · 每天",
        ),
        (
            "每天晚上",
            "每天晚上",
            at(2026, 11, 13, 20, 0),
            Repeat::Day,
            "今天 20:00 · 每天",
        ),
        (
            "每天下午3点",
            "每天下午3点",
            at(2026, 11, 13, 15, 0),
            Repeat::Day,
            "今天 15:00 · 每天",
        ),
        (
            "9点 每天",
            "9点 每天",
            at(2026, 11, 14, 9, 0),
            Repeat::Day,
            "明天 09:00 · 每天",
        ),
        (
            "每个工作日",
            "每个工作日",
            at(2026, 11, 16, 9, 0),
            Repeat::Weekday,
            "周一 09:00 · 每个工作日",
        ),
        // Saturday 09:00 falls on Monday.
        (
            "工作日 9点",
            "工作日 9点",
            at(2026, 11, 16, 9, 0),
            Repeat::Weekday,
            "周一 09:00 · 每个工作日",
        ),
        (
            "每周",
            "每周",
            at(2026, 11, 20, 9, 0),
            Repeat::Week,
            "11月20日 09:00 · 每周",
        ),
        (
            "每周一",
            "每周一",
            at(2026, 11, 16, 9, 0),
            Repeat::Week,
            "周一 09:00 · 每周",
        ),
        (
            "每星期三",
            "每星期三",
            at(2026, 11, 18, 9, 0),
            Repeat::Week,
            "周三 09:00 · 每周",
        ),
        (
            "每週一",
            "每週一",
            at(2026, 11, 16, 9, 0),
            Repeat::Week,
            "周一 09:00 · 每周",
        ),
        (
            "每周五下午3点",
            "每周五下午3点",
            at(2026, 11, 13, 15, 0),
            Repeat::Week,
            "今天 15:00 · 每周",
        ),
        (
            "每周周一",
            "每周周一",
            at(2026, 11, 16, 9, 0),
            Repeat::Week,
            "周一 09:00 · 每周",
        ),
        (
            "每月",
            "每月",
            at(2026, 12, 13, 9, 0),
            Repeat::Month,
            "12月13日 09:00 · 每月",
        ),
        (
            "每月1号",
            "每月1号",
            at(2026, 12, 1, 9, 0),
            Repeat::Month,
            "12月1日 09:00 · 每月",
        ),
        (
            "每月15号 9:30",
            "每月15号 9:30",
            at(2026, 11, 15, 9, 30),
            Repeat::Month,
            "后天 09:30 · 每月",
        ),
        (
            "每年",
            "每年",
            at(2027, 11, 13, 9, 0),
            Repeat::Year,
            "11月13日 09:00 · 每年",
        ),
        (
            "每年3月5日",
            "每年3月5日",
            at(2027, 3, 5, 9, 0),
            Repeat::Year,
            "3月5日 09:00 · 每年",
        ),
        (
            "交房租 每月1号",
            "每月1号",
            at(2026, 12, 1, 9, 0),
            Repeat::Month,
            "12月1日 09:00 · 每月",
        ),
    ];
    for &(text, phrase, expected, repeat, label) in cases {
        let found = parse(text, now()).unwrap_or_else(|| panic!("no phrase in {text:?}"));
        assert_eq!(&text[found.range.clone()], phrase, "{text:?}");
        assert_eq!(
            (found.at, found.repeat),
            (expected, Some(repeat)),
            "{text:?}"
        );
        assert_eq!(found.label, label, "{text:?}");
    }
    // A time phrase alone has no rule.
    assert_eq!(parse("明天 9点", now()).unwrap().repeat, None);

    let english: &[(&str, &str, DateTime, Repeat, &str)] = &[
        (
            "every day",
            "every day",
            at(2026, 11, 14, 9, 0),
            Repeat::Day,
            "Tomorrow 9:00 AM · Daily",
        ),
        (
            "every day at 9am",
            "every day at 9am",
            at(2026, 11, 14, 9, 0),
            Repeat::Day,
            "Tomorrow 9:00 AM · Daily",
        ),
        (
            "9am every day",
            "9am every day",
            at(2026, 11, 14, 9, 0),
            Repeat::Day,
            "Tomorrow 9:00 AM · Daily",
        ),
        (
            "every weekday",
            "every weekday",
            at(2026, 11, 16, 9, 0),
            Repeat::Weekday,
            "Mon 9:00 AM · Weekdays",
        ),
        (
            "every week",
            "every week",
            at(2026, 11, 20, 9, 0),
            Repeat::Week,
            "Nov 20 9:00 AM · Weekly",
        ),
        (
            "Every Monday",
            "Every Monday",
            at(2026, 11, 16, 9, 0),
            Repeat::Week,
            "Mon 9:00 AM · Weekly",
        ),
        (
            "every monday 3pm",
            "every monday 3pm",
            at(2026, 11, 16, 15, 0),
            Repeat::Week,
            "Mon 3:00 PM · Weekly",
        ),
        (
            "every month",
            "every month",
            at(2026, 12, 13, 9, 0),
            Repeat::Month,
            "Dec 13 9:00 AM · Monthly",
        ),
        (
            "every year",
            "every year",
            at(2027, 11, 13, 9, 0),
            Repeat::Year,
            "Nov 13 9:00 AM · Yearly",
        ),
    ];
    let japanese: &[(&str, &str, DateTime, Repeat, &str)] = &[
        (
            "毎日",
            "毎日",
            at(2026, 11, 14, 9, 0),
            Repeat::Day,
            "明日 9:00 · 毎日",
        ),
        (
            "毎日9時",
            "毎日9時",
            at(2026, 11, 14, 9, 0),
            Repeat::Day,
            "明日 9:00 · 毎日",
        ),
        (
            "平日",
            "平日",
            at(2026, 11, 16, 9, 0),
            Repeat::Weekday,
            "月曜 9:00 · 平日",
        ),
        (
            "毎週",
            "毎週",
            at(2026, 11, 20, 9, 0),
            Repeat::Week,
            "11月20日 9:00 · 毎週",
        ),
        (
            "毎週月曜",
            "毎週月曜",
            at(2026, 11, 16, 9, 0),
            Repeat::Week,
            "月曜 9:00 · 毎週",
        ),
        (
            "毎月曜",
            "毎月曜",
            at(2026, 11, 16, 9, 0),
            Repeat::Week,
            "月曜 9:00 · 毎週",
        ),
        (
            "毎日曜日",
            "毎日曜日",
            at(2026, 11, 15, 9, 0),
            Repeat::Week,
            "明後日 9:00 · 毎週",
        ),
        (
            "毎月",
            "毎月",
            at(2026, 12, 13, 9, 0),
            Repeat::Month,
            "12月13日 9:00 · 毎月",
        ),
        (
            "毎月1日",
            "毎月1日",
            at(2026, 12, 1, 9, 0),
            Repeat::Month,
            "12月1日 9:00 · 毎月",
        ),
        (
            "毎年",
            "毎年",
            at(2027, 11, 13, 9, 0),
            Repeat::Year,
            "11月13日 9:00 · 毎年",
        ),
    ];
    for (lang, cases) in [(Lang::En, english), (Lang::Ja, japanese)] {
        let options = Options {
            lang,
            ..Options::default()
        };
        for &(text, phrase, expected, repeat, label) in cases {
            let found = parse_with(text, now(), &options)
                .unwrap_or_else(|| panic!("no phrase in {text:?}"));
            assert_eq!(&text[found.range.clone()], phrase, "{text:?}");
            assert_eq!(
                (found.at, found.repeat),
                (expected, Some(repeat)),
                "{text:?}"
            );
            assert_eq!(found.label, label, "{text:?}");
        }
    }
    let options = Options {
        lang: Lang::ZhHant,
        ..Options::default()
    };
    let found = parse_with("每個工作日", now(), &options).unwrap();
    assert_eq!(found.label, "週一 09:00 · 每個工作日");

    // No rule: only the simple ones are.
    no_phrase_in(&[
        "每两周",
        "每隔一天",
        "每3天",
        "每周末打扫",
        "每月底",
        "下个工作日",
        "every 2 weeks",
        "everyday",
        "every weekend",
        "every other day",
        "weekly report",
        "毎週末",
        "毎月末",
    ]);
}

#[test]
fn normalizes_rules() {
    let now = now();
    let cases: &[(&str, Option<&str>)] = &[
        (
            "- [ ] 交房租 每月1号",
            Some("- [ ] 交房租 ⏰ 2026-12-01 09:00 🔁 every month"),
        ),
        (
            "- [ ] 每天 9点 吃药",
            Some("- [ ] 吃药 ⏰ 2026-11-14 09:00 🔁 every day"),
        ),
        (
            "- [ ] standup every weekday 9:30",
            Some("- [ ] standup ⏰ 2026-11-16 09:30 🔁 every weekday"),
        ),
        (
            "- [ ] 週會 每週一 下午3點",
            Some("- [ ] 週會 ⏰ 2026-11-16 15:00 🔁 every week"),
        ),
        (
            "- [ ] 家賃 毎月1日",
            Some("- [ ] 家賃 ⏰ 2026-12-01 09:00 🔁 every month"),
        ),
        // A reminder already: the rule is added to it.
        (
            "- [ ] 交房租 ⏰ 2026-12-01 09:00 每月",
            Some("- [ ] 交房租 ⏰ 2026-12-01 09:00 🔁 every month"),
        ),
        (
            "- [ ] 交 ⏰ 2026-12-01 09:00 房租 每月",
            Some("- [ ] 交 房租 ⏰ 2026-12-01 09:00 🔁 every month"),
        ),
        // ... and a weekday with it is its new date.
        (
            "- [ ] 开会 ⏰ 2026-12-01 15:00 每周一",
            Some("- [ ] 开会 ⏰ 2026-11-16 09:00 🔁 every week"),
        ),
        // A rule already: a time is added before it.
        (
            "- [ ] 吃药 🔁 every day 明天 8点",
            Some("- [ ] 吃药 ⏰ 2026-11-14 08:00 🔁 every day"),
        ),
        // A reminder takes no time phrase without a rule; with both, the line takes none.
        ("- [ ] 跟进 9点的会 ⏰ 2026-12-01 15:00", None),
        ("- [ ] 交房租 ⏰ 2026-12-01 09:00 🔁 every month 明天", None),
        ("- [ ] 交房租 ⏰ 2026-12-01 09:00 🔁 every month 每年", None),
        ("- [ ] 每周末 打扫", None),
        ("- [x] 交房租 每月1号 ✅ 2026-11-13", None),
    ];
    for &(line, expected) in cases {
        assert_eq!(normalize_line(line, now).as_deref(), expected, "{line:?}");
    }
}
