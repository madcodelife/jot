//! Simple repeating to-dos: a rule written after the to-do's reminder time, `🔁 every month` (Obsidian Tasks'
//! wording, in English whatever the language, so the files stay portable). Only five rules: `every day`, `every
//! weekday` (Monday to Friday), `every week` (the weekday of its `⏰`), `every month` (the day of the month of its
//! `⏰`, a day the month lacks being its last) and `every year`. Nothing else ("every 2 weeks", "every Monday and
//! Thursday") is a rule: it stays in the to-do's text.
//!
//! Checking off a repeating to-do that has a time puts an open copy of it right above it, due at its next time:
//! the rule applied to its time until that is after now, so a long-overdue daily to-do does not leave a backlog.

use std::fmt;

use jiff::ToSpan as _;
use jiff::civil::{DateTime, Time, Weekday};

/// The marker before a rule.
pub(crate) const MARKER: &str = "🔁";

/// How often a to-do comes back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Repeat {
    /// `every day`.
    Day,
    /// `every weekday`: Monday to Friday.
    Weekday,
    /// `every week`: the weekday of its time.
    Week,
    /// `every month`: the day of the month of its time.
    Month,
    /// `every year`.
    Year,
}

impl Repeat {
    /// Every rule.
    pub const ALL: [Repeat; 5] = [
        Repeat::Day,
        Repeat::Weekday,
        Repeat::Week,
        Repeat::Month,
        Repeat::Year,
    ];

    /// The word after `every`: `day`, `weekday`, `week`, `month`, `year` (also what jot-mcp's `repeat` takes).
    pub fn name(self) -> &'static str {
        match self {
            Repeat::Day => "day",
            Repeat::Weekday => "weekday",
            Repeat::Week => "week",
            Repeat::Month => "month",
            Repeat::Year => "year",
        }
    }

    /// The rule a [`name`](Repeat::name) names, in any case.
    pub fn from_name(name: &str) -> Option<Repeat> {
        let name = name.trim();
        Repeat::ALL
            .into_iter()
            .find(|repeat| repeat.name().eq_ignore_ascii_case(name))
    }

    /// The rule written at the start of `text` (`every month`, any case), and how long it is there. The words
    /// must end there; [`crate::todo`] checks that nothing but a space follows.
    pub(crate) fn read(text: &str) -> Option<(Repeat, usize)> {
        let every = "every ";
        if !text.get(..every.len())?.eq_ignore_ascii_case(every) {
            return None;
        }
        let rest = &text[every.len()..];
        let length = rest
            .find(|c: char| !c.is_ascii_alphabetic())
            .unwrap_or(rest.len());
        let repeat = Repeat::from_name(&rest[..length])?;
        Some((repeat, every.len() + length))
    }

    /// The time `n` steps after `at` (`n` ≥ 1): a month or a year counted from `at` itself, so a 31st that came
    /// out as a shorter month's last day is the 31st again where a month has one. A weekday is counted one by one
    /// ([`Repeat::next`] skips ahead first).
    fn step(self, at: DateTime, n: i64) -> Option<DateTime> {
        match self {
            Repeat::Day => at.checked_add(n.days()).ok(),
            Repeat::Week => at.checked_add((7 * n).days()).ok(),
            Repeat::Month => at.checked_add(n.months()).ok(),
            Repeat::Year => at.checked_add(n.years()).ok(),
            Repeat::Weekday => {
                let mut next = at;
                for _ in 0..n {
                    next = next.checked_add(1.day()).ok()?;
                    while is_weekend(next.weekday()) {
                        next = next.checked_add(1.day()).ok()?;
                    }
                }
                Some(next)
            }
        }
    }

    /// The next time of a to-do due at `due`, checked off at `now`: the rule applied to `due` (at least once) until
    /// it is after `now`. A month's 31st is the last day of a shorter month (31 January, 28 February); a year's
    /// 29 February is 28 February in other years. `None` past the calendar's end.
    pub fn next(self, due: DateTime, now: DateTime) -> Option<DateTime> {
        // Skip ahead to about `now` rather than step through a long overdue stretch.
        let behind = i64::from(
            due.date()
                .until(now.date())
                .map_or(0, |span| span.get_days()),
        )
        .max(0);
        let (base, mut n) = match self {
            Repeat::Day => (due, (behind - 1).max(1)),
            Repeat::Week => (due, (behind / 7).max(1)),
            Repeat::Month => {
                let months = (i64::from(now.year()) - i64::from(due.year())) * 12
                    + i64::from(now.month())
                    - i64::from(due.month());
                (due, (months - 1).max(1))
            }
            Repeat::Year => (
                due,
                (i64::from(now.year()) - i64::from(due.year()) - 1).max(1),
            ),
            Repeat::Weekday if behind > 7 => {
                // A week before `now`, at the same time of day: the steps from there are the same weekdays.
                let base = now
                    .date()
                    .checked_sub(7.days())
                    .ok()?
                    .to_datetime(due.time());
                (base, 1)
            }
            Repeat::Weekday => (due, 1),
        };
        loop {
            let at = self.step(base, n)?;
            if at > now {
                return Some(at);
            }
            n += 1;
        }
    }

    /// `at`, or for `every weekday` the first weekday from it (a Saturday's or Sunday's time on Monday).
    pub fn align(self, at: DateTime) -> DateTime {
        if self != Repeat::Weekday || !is_weekend(at.weekday()) {
            return at;
        }
        self.step(at, 1).unwrap_or(at)
    }

    /// The first time of a rule given without a time (`每天`, `every month`): today at `time` (the time a date alone
    /// means), or the next by the rule once that is past; for `every weekday`, a weekday.
    pub fn first(self, now: DateTime, time: Time) -> DateTime {
        let today = now.date().to_datetime(time);
        let at = if today < now {
            self.next(today, now).unwrap_or(today)
        } else {
            today
        };
        self.align(at)
    }
}

/// How the file writes it: `every month`.
impl fmt::Display for Repeat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "every {}", self.name())
    }
}

fn is_weekend(weekday: Weekday) -> bool {
    matches!(weekday, Weekday::Saturday | Weekday::Sunday)
}

#[cfg(test)]
mod tests {
    use jiff::civil::{date, time};

    use super::*;

    #[test]
    fn rules_are_read_and_written() {
        for repeat in Repeat::ALL {
            let written = repeat.to_string();
            assert_eq!(Repeat::read(&written), Some((repeat, written.len())));
            assert_eq!(Repeat::from_name(repeat.name()), Some(repeat));
        }
        assert_eq!(Repeat::read("Every Month"), Some((Repeat::Month, 11)));
        assert_eq!(Repeat::read("every weekday!"), Some((Repeat::Weekday, 13)));
        assert_eq!(Repeat::from_name(" WEEK "), Some(Repeat::Week));
        for text in [
            "every",
            "every ",
            "every 2 weeks",
            "every monday",
            "everyday",
            "every fortnight",
            "each day",
        ] {
            assert_eq!(Repeat::read(text), None, "{text:?}");
        }
        assert_eq!(Repeat::from_name("daily"), None);
    }

    #[test]
    fn next_times() {
        let at = |y, m, d, h| date(y, m, d).at(h, 0, 0, 0);
        // Friday 2026-11-13, 10:00.
        let now = at(2026, 11, 13, 10);
        // (rule, due, next)
        let cases = [
            // Due later: one step from it.
            (Repeat::Day, at(2026, 11, 13, 18), at(2026, 11, 14, 18)),
            (Repeat::Week, at(2026, 11, 13, 18), at(2026, 11, 20, 18)),
            (Repeat::Month, at(2026, 11, 13, 18), at(2026, 12, 13, 18)),
            (Repeat::Year, at(2026, 11, 13, 18), at(2027, 11, 13, 18)),
            // Friday to Monday.
            (Repeat::Weekday, at(2026, 11, 13, 18), at(2026, 11, 16, 18)),
            (Repeat::Weekday, at(2026, 11, 11, 18), at(2026, 11, 13, 18)),
            // Due earlier today: the next one after now.
            (Repeat::Day, at(2026, 11, 13, 9), at(2026, 11, 14, 9)),
            // Long overdue: no backlog, the first one after now.
            (Repeat::Day, at(2026, 1, 1, 9), at(2026, 11, 14, 9)),
            (Repeat::Day, at(2026, 1, 1, 11), at(2026, 11, 13, 11)),
            (Repeat::Week, at(2026, 10, 2, 9), at(2026, 11, 20, 9)),
            (Repeat::Week, at(2026, 10, 2, 11), at(2026, 11, 13, 11)),
            (Repeat::Weekday, at(2026, 1, 1, 9), at(2026, 11, 16, 9)),
            (Repeat::Weekday, at(2026, 1, 1, 11), at(2026, 11, 13, 11)),
            (Repeat::Month, at(2025, 3, 13, 9), at(2026, 12, 13, 9)),
            (Repeat::Month, at(2025, 3, 13, 11), at(2026, 11, 13, 11)),
            (Repeat::Year, at(2020, 11, 13, 9), at(2027, 11, 13, 9)),
            (Repeat::Year, at(2020, 11, 13, 11), at(2026, 11, 13, 11)),
            // A month's 31st: the last day of a shorter month, and the 31st again where there is one.
            (Repeat::Month, at(2026, 1, 31, 9), at(2026, 11, 30, 9)),
            (Repeat::Month, at(2026, 10, 31, 9), at(2026, 11, 30, 9)),
            (Repeat::Month, at(2025, 12, 31, 9), at(2026, 11, 30, 9)),
            // 29 February: 28 February in a year without one.
            (Repeat::Year, at(2024, 2, 29, 9), at(2027, 2, 28, 9)),
        ];
        for (repeat, due, next) in cases {
            assert_eq!(repeat.next(due, now), Some(next), "{repeat} from {due}");
        }
        let jan = at(2027, 1, 31, 9);
        let before = at(2027, 1, 1, 9);
        assert_eq!(Repeat::Month.next(jan, before), Some(at(2027, 2, 28, 9)));
        assert_eq!(
            Repeat::Month.next(at(2027, 2, 28, 9), before),
            Some(at(2027, 3, 28, 9))
        );
        // Past the calendar's end.
        assert_eq!(Repeat::Year.next(at(9999, 6, 1, 9), now), None);
    }

    #[test]
    fn first_times() {
        let nine = time(9, 0, 0, 0);
        // Friday 2026-11-13.
        let early = date(2026, 11, 13).at(8, 0, 0, 0);
        let late = date(2026, 11, 13).at(10, 0, 0, 0);
        let at = |d, h| date(2026, 11, d).at(h, 0, 0, 0);
        assert_eq!(Repeat::Day.first(early, nine), at(13, 9));
        assert_eq!(Repeat::Day.first(late, nine), at(14, 9));
        assert_eq!(Repeat::Week.first(late, nine), at(20, 9));
        assert_eq!(Repeat::Month.first(early, nine), at(13, 9));
        assert_eq!(Repeat::Weekday.first(early, nine), at(13, 9));
        assert_eq!(Repeat::Weekday.first(late, nine), at(16, 9));
        // On a Saturday: Monday.
        assert_eq!(Repeat::Weekday.first(at(14, 8), nine), at(16, 9));
        assert_eq!(Repeat::Weekday.align(at(15, 9)), at(16, 9));
        assert_eq!(Repeat::Week.align(at(15, 9)), at(15, 9));
    }
}
