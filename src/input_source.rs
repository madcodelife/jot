//! `InputSource`: the keyboard input source the user types with now, whose
//! language is the one they most likely speak (a Chinese input method while
//! the system is in English): dictation listens for it.
//!
//! The platform reads it ([`platform`](crate::platform)) on the main thread:
//! macOS's Text Input Sources belong to the main thread in an AppKit app, so
//! a call is one hop there and back, and JS gets a promise.

use nsh_core::prelude::*;

use crate::platform;

/// The keyboard input source selected now.
#[module]
pub struct InputSource;

#[module]
impl InputSource {
    /// The language of the keyboard input source selected now, as a BCP 47
    /// tag (`"zh-Hans"` for Pinyin, `"ja"` for Kana, `"en"` for ABC): the
    /// first the source names. `null` where the platform does not say, or
    /// for a source without a language.
    pub async fn language() -> Option<String> {
        run_on_main_thread(platform::input_language)
            .await
            .ok()
            .flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Whatever the machine's input source is, the answer is nothing or a
    /// language tag: letters first, then subtags of letters and digits.
    #[test]
    fn the_language_is_none_or_a_tag() {
        let Some(tag) = platform::input_language() else {
            return;
        };
        let mut parts = tag.split('-');
        let first = parts.next().unwrap_or_default();
        assert!(
            (2..=3).contains(&first.len()) && first.chars().all(|c| c.is_ascii_alphabetic()),
            "{tag:?}"
        );
        for part in parts {
            assert!(
                (1..=8).contains(&part.len()) && part.chars().all(|c| c.is_ascii_alphanumeric()),
                "{tag:?}"
            );
        }
    }
}
