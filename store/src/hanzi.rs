//! A title's Chinese matched by its pinyin: a search term in Latin letters (`fuwuqi`, `fuwu`, `fwq`) finds
//! "服务器". Each Chinese character takes any non-empty start of one of its readings, so full syllables, initials
//! and mixes (`fuwq`) all match; every reading the `pinyin` crate lists for a character counts (多音字: 行 is
//! `xing` and `hang`). Other characters must be typed as they are. `ü` is typed `v` or `u`.

use pinyin::ToPinyinMulti;

/// A title as the pinyin matching reads it: lowercase characters, the Chinese ones with their readings.
pub(crate) struct Readings {
    units: Vec<Unit>,
}

enum Unit {
    /// A character with no reading: typed as it is (lowercase).
    Plain(char),
    /// A Chinese character's readings, without tones (`ü` kept), each once.
    Han(Vec<&'static str>),
}

impl Readings {
    /// The title's readings; `None` when it has no Chinese character (pinyin cannot match it).
    pub(crate) fn new(title: &str) -> Option<Readings> {
        let mut units = Vec::with_capacity(title.len());
        let mut han = false;
        for c in title.chars() {
            match c.to_pinyin_multi() {
                Some(multi) => {
                    han = true;
                    let mut readings: Vec<&'static str> = Vec::with_capacity(multi.count());
                    for reading in multi {
                        let plain = reading.plain();
                        if !readings.contains(&plain) {
                            readings.push(plain);
                        }
                    }
                    units.push(Unit::Han(readings));
                }
                None => units.extend(c.to_lowercase().map(Unit::Plain)),
            }
        }
        han.then_some(Readings { units })
    }

    /// Whether a lowercase term in ASCII letters is, somewhere in the title, the pinyin of a run of it that takes
    /// at least one Chinese character. Other terms (Chinese, accented, no letter) never match by pinyin.
    pub(crate) fn matches(&self, term: &str) -> bool {
        let term = term.as_bytes();
        if term.is_empty() || !term.is_ascii() || !term.iter().any(u8::is_ascii_alphabetic) {
            return false;
        }
        // `reached[p]`: some run ending before the current unit spells `term[..p]`; `han[p]`: one such run took a
        // Chinese character. A run may start at any unit, so `reached[0]` stays true.
        let mut reached = vec![false; term.len() + 1];
        let mut han = vec![false; term.len() + 1];
        let mut next = reached.clone();
        let mut next_han = han.clone();
        reached[0] = true;
        for unit in &self.units {
            next.fill(false);
            next_han.fill(false);
            next[0] = true;
            for at in 0..term.len() {
                if !reached[at] {
                    continue;
                }
                let rest = &term[at..];
                match unit {
                    Unit::Plain(c) => {
                        let mut buf = [0; 4];
                        let typed = c.encode_utf8(&mut buf).as_bytes();
                        if rest.starts_with(typed) {
                            let to = at + typed.len();
                            next[to] = true;
                            next_han[to] |= han[at];
                        }
                    }
                    Unit::Han(readings) => {
                        for reading in readings {
                            for taken in 1..=typed_prefix(reading, rest) {
                                next[at + taken] = true;
                                next_han[at + taken] = true;
                            }
                        }
                    }
                }
            }
            if next_han[term.len()] {
                return true;
            }
            std::mem::swap(&mut reached, &mut next);
            std::mem::swap(&mut han, &mut next_han);
        }
        false
    }
}

/// How many bytes at the start of `typed` spell the start of `reading` (`ü` typed `v` or `u`).
fn typed_prefix(reading: &str, typed: &[u8]) -> usize {
    let mut taken = 0;
    for c in reading.chars() {
        let Some(&byte) = typed.get(taken) else { break };
        let same = match c {
            'ü' => byte == b'v' || byte == b'u',
            _ => c.is_ascii() && byte == c as u8,
        };
        if !same {
            break;
        }
        taken += 1;
    }
    taken
}

#[cfg(test)]
mod tests {
    use super::Readings;

    fn matches(title: &str, term: &str) -> bool {
        Readings::new(title).is_some_and(|readings| readings.matches(term))
    }

    #[test]
    fn full_pinyin_initials_and_starts() {
        for term in [
            "fuwuqi", "fuwu", "fwq", "fw", "fuwq", "fwuqi", "wuqi", "q", "fuwuq",
        ] {
            assert!(matches("服务器", term), "{term}");
        }
        for term in ["fuwuqii", "fuqi", "fwx", "uwu", "服务"] {
            assert!(!matches("服务器", term), "{term}");
        }
    }

    #[test]
    fn mixed_titles_and_other_characters() {
        assert!(matches("Ubuntu 服务器", "fwq"));
        assert!(matches("U盘", "upan"));
        assert!(matches("Win10系统", "win10xt"));
        // Spelled without a Chinese character: that is a plain substring, not a pinyin match.
        assert!(!matches("Ubuntu 服务器", "ubuntu"));
        assert!(!matches("Ubuntu 服务器", "ubuntufwq"));
        assert!(Readings::new("Ubuntu server").is_none());
        // Digits alone are no pinyin.
        assert!(!matches("2026 年", "2026"));
    }

    #[test]
    fn heteronyms_and_u_umlaut() {
        assert!(matches("银行卡", "yinhangka"));
        assert!(matches("银行卡", "yhk"));
        assert!(matches("行程", "xingcheng"));
        assert!(matches("绿色", "lvse"));
        assert!(matches("绿色", "luse"));
        assert!(matches("女生", "nvsheng"));
    }

    #[test]
    fn uppercase_titles_compare_lowercase() {
        assert!(matches("API文档", "apiwd"));
        // A space in the title is a character to type, and a term has none.
        assert!(!matches("API 文档", "apiwd"));
        assert!(matches("API 文档", "wd"));
    }
}
