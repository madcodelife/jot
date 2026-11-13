//! `Summon`: a system-wide double tap of a modifier key, the gesture that
//! brings Jot up (two taps of ⌥).
//!
//! The platform reports every change of the modifier keys and every other
//! key or button press ([`platform`](crate::platform)); [`DoubleTap`] turns
//! them into double taps, on the platform's main thread. A tap is the key
//! pressed and released alone (no other modifier, key or button meanwhile);
//! two of them, the second pressed at most [`INTERVAL`] after the first was
//! released, are a double tap.

use nsh_core::prelude::*;

use crate::platform;
use crate::relay::relay;

/// The longest pause between a tap's release and the next tap's press, and
/// the longest a tap's key stays down, in seconds.
pub(crate) const INTERVAL: f64 = 0.35;

/// Brings the app up from anywhere: a double tap of a modifier key.
#[module]
pub struct Summon;

#[module]
impl Summon {
    /// Whether the app may watch keys system-wide: on macOS, whether it
    /// has the Accessibility permission (System Settings › Privacy &
    /// Security › Accessibility). True where no permission is needed.
    pub fn is_trusted() -> bool {
        platform::is_trusted()
    }

    /// Asks for that permission: on macOS the system's prompt the first
    /// time, the Accessibility pane of System Settings after that.
    pub fn request_trust(cx: &mut ModuleCx) {
        let _ = cx.run_on_main_thread(platform::request_trust);
    }

    /// Calls `listener` when `key` is tapped twice in a row, in any app.
    /// Replaces the listener of an earlier call. On macOS it needs the
    /// Accessibility permission (`isTrusted`) to hear taps while other apps
    /// are in front; without it only taps in Jot's own windows count.
    pub fn on_double_tap(key: SummonKey, listener: Callback<()>, cx: CallCx<'_>) {
        let taps = relay(cx, move |()| listener.post(()));
        // Event monitors are the main thread's; installing the new ones
        // removes the old, whose sender goes with them and ends the old
        // listener's task.
        cx.start(async move {
            let _ = run_on_main_thread(move || {
                platform::watch_double_tap(
                    key,
                    Box::new(move || {
                        let _ = taps.send(());
                    }),
                );
            })
            .await;
        });
    }
}

/// A modifier key whose double tap summons the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PropEnum)]
pub enum SummonKey {
    /// ⌥ Option (Alt elsewhere).
    #[prop(rename = "option")]
    Alt,
    /// ⌃ Control.
    Control,
}

/// The modifier keys down, as far as a double tap cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Modifiers {
    pub(crate) shift: bool,
    pub(crate) control: bool,
    pub(crate) alt: bool,
    pub(crate) command: bool,
}

impl Modifiers {
    fn none(self) -> bool {
        self == Modifiers::default()
    }

    /// Whether exactly `key` is down.
    fn only(self, key: SummonKey) -> bool {
        let alone = match key {
            SummonKey::Alt => Modifiers {
                alt: true,
                ..Default::default()
            },
            SummonKey::Control => Modifiers {
                control: true,
                ..Default::default()
            },
        };
        self == alone
    }
}

/// Recognizes double taps of one modifier from the keyboard's events.
/// Times are seconds on any monotonic clock (AppKit's event timestamps).
#[derive(Debug, Clone)]
pub(crate) struct DoubleTap {
    key: SummonKey,
    /// When the key went down alone, while nothing else happened since.
    pressed: Option<f64>,
    /// When the last tap was released, while it can start a double tap.
    tapped: Option<f64>,
    /// When the key went down for a tap that may finish a double tap.
    second: Option<f64>,
}

impl DoubleTap {
    pub(crate) fn new(key: SummonKey) -> Self {
        DoubleTap {
            key,
            pressed: None,
            tapped: None,
            second: None,
        }
    }

    /// The modifier keys changed to `down` at `time`; true when that
    /// completes a double tap.
    pub(crate) fn modifiers(&mut self, down: Modifiers, time: f64) -> bool {
        if down.only(self.key) {
            if self.pressed.is_none() {
                self.pressed = Some(time);
                // The press of a second tap: soon enough after the first?
                self.second = self
                    .tapped
                    .filter(|released| time - released <= INTERVAL)
                    .map(|_| time);
                if self.second.is_none() {
                    self.tapped = None;
                }
            }
            return false;
        }
        if down.none() {
            let Some(pressed) = self.pressed.take() else {
                return false;
            };
            if time - pressed > INTERVAL {
                // Held: not a tap.
                self.reset();
                return false;
            }
            if self.second.take().is_some() {
                self.tapped = None;
                return true;
            }
            self.tapped = Some(time);
            return false;
        }
        // Another modifier joined: a shortcut, not a tap.
        self.reset();
        false
    }

    /// Another key or a mouse button was pressed.
    pub(crate) fn other_input(&mut self) {
        self.reset();
    }

    fn reset(&mut self) {
        self.pressed = None;
        self.tapped = None;
        self.second = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALT: Modifiers = Modifiers {
        shift: false,
        control: false,
        alt: true,
        command: false,
    };
    const NONE: Modifiers = Modifiers {
        shift: false,
        control: false,
        alt: false,
        command: false,
    };

    fn taps(tap: &mut DoubleTap, times: &[(Modifiers, f64)]) -> Vec<bool> {
        times.iter().map(|&(m, t)| tap.modifiers(m, t)).collect()
    }

    #[test]
    fn two_quick_taps_are_a_double_tap() {
        let mut tap = DoubleTap::new(SummonKey::Alt);
        let fired = taps(
            &mut tap,
            &[(ALT, 0.0), (NONE, 0.08), (ALT, 0.3), (NONE, 0.38)],
        );
        assert_eq!(fired, [false, false, false, true]);
        // A third tap starts over.
        assert_eq!(taps(&mut tap, &[(ALT, 0.5), (NONE, 0.55)]), [false, false]);
    }

    #[test]
    fn a_slow_second_tap_starts_over() {
        let mut tap = DoubleTap::new(SummonKey::Alt);
        let fired = taps(
            &mut tap,
            &[
                (ALT, 0.0),
                (NONE, 0.08),
                (ALT, 0.6),
                (NONE, 0.65),
                (ALT, 0.8),
                (NONE, 0.85),
            ],
        );
        assert_eq!(fired, [false, false, false, false, false, true]);
    }

    #[test]
    fn held_keys_shortcuts_and_other_keys_are_not_taps() {
        let mut tap = DoubleTap::new(SummonKey::Alt);
        // Held too long.
        assert_eq!(
            taps(
                &mut tap,
                &[(ALT, 0.0), (NONE, 1.0), (ALT, 1.1), (NONE, 1.15)]
            ),
            [false; 4]
        );
        // ⌥⇧ in between.
        let mut tap = DoubleTap::new(SummonKey::Alt);
        let both = Modifiers { shift: true, ..ALT };
        assert_eq!(
            taps(
                &mut tap,
                &[
                    (ALT, 0.0),
                    (both, 0.05),
                    (ALT, 0.1),
                    (NONE, 0.15),
                    (ALT, 0.3),
                    (NONE, 0.35)
                ]
            ),
            [false, false, false, false, false, true]
        );
        // A key typed between the taps (⌥E, or plain typing).
        let mut tap = DoubleTap::new(SummonKey::Alt);
        assert_eq!(taps(&mut tap, &[(ALT, 0.0), (NONE, 0.05)]), [false, false]);
        tap.other_input();
        assert_eq!(taps(&mut tap, &[(ALT, 0.2), (NONE, 0.25)]), [false, false]);
        // Control taps do not count for ⌥.
        let control = Modifiers {
            control: true,
            ..NONE
        };
        let mut tap = DoubleTap::new(SummonKey::Alt);
        assert_eq!(
            taps(
                &mut tap,
                &[(control, 0.0), (NONE, 0.05), (control, 0.2), (NONE, 0.25)]
            ),
            [false; 4]
        );
    }
}
