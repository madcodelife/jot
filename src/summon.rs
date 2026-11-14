//! `Summon`: system-wide gestures of a modifier key: a double tap, which
//! brings Jot up (two taps of ⌥), and a double tap whose second press is
//! held, for as long as it is held (push to talk).
//!
//! The platform reports every change of the modifier keys and every other
//! key or button press ([`platform`](crate::platform)) to a [`Summoner`],
//! whose [`DoubleTap`]s turn them into gestures, on the platform's main
//! thread. A tap is the key pressed and released alone (no other modifier,
//! key or button meanwhile); two of them, the second pressed at most
//! [`INTERVAL`] after the first was released, are a double tap. When a hold
//! is watched on the key, a second press still down [`HOLD`] after it went
//! down starts a hold instead (the platform calls [`Summoner::tick`] then),
//! which ends when the key is released, or is cancelled by another key or
//! modifier pressed meanwhile.

use nsh_core::element::{Arg, JsIn, JsKind, JsValue, PropError, TsTypes};
use nsh_core::prelude::*;

use crate::platform;
use crate::relay::relay;

/// The longest pause between a tap's release and the next tap's press, and
/// the longest a tap's key stays down, in seconds.
pub(crate) const INTERVAL: f64 = 0.35;

/// How long the second press of a double tap stays down before it is a
/// hold, in seconds; released sooner, it is a double tap.
pub(crate) const HOLD: f64 = 0.25;

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
        // Event monitors are the main thread's; installing the new listener
        // drops the old, whose sender goes with it and ends the old
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

    /// Calls `handlers.start` when `key` is tapped, then pressed again and
    /// held (250 ms), in any app, and `handlers.end` when it is released
    /// (`cancelled: false`) or another key or modifier is pressed while it
    /// is held (`cancelled: true`); mouse buttons do not end it. A second
    /// press released sooner is a double tap (`onDoubleTap`), never both.
    /// Replaces the handlers of an earlier call; the permission as
    /// `onDoubleTap`'s.
    pub fn on_double_tap_hold(key: SummonKey, handlers: SummonHold, cx: CallCx<'_>) {
        let SummonHold { start, end } = handlers;
        let events = relay(cx, move |event: Option<bool>| match event {
            None => start.post(()),
            Some(cancelled) => end.post(SummonHoldEnd { cancelled }),
        });
        let ends = events.clone();
        cx.start(async move {
            let _ = run_on_main_thread(move || {
                platform::watch_double_tap_hold(
                    key,
                    Box::new(move || {
                        let _ = events.send(None);
                    }),
                    Box::new(move |cancelled| {
                        let _ = ends.send(Some(cancelled));
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

/// The functions `onDoubleTapHold` calls (TS: `{ start: () => void; end:
/// (event: SummonHoldEnd) => void }`).
#[derive(Debug, Clone)]
pub struct SummonHold {
    /// Called when the hold starts.
    pub start: Callback<()>,
    /// Called when it ends.
    pub end: Callback<SummonHoldEnd>,
}

impl Arg for SummonHold {
    fn ts_type(types: &mut TsTypes) -> String {
        let event = <SummonHoldEnd as JsValue>::ts_type(types);
        format!("{{ start: () => void; end: (event: {event}) => void }}")
    }

    fn from_js(value: JsIn<'_>) -> Result<Self, PropError> {
        if value.kind() != JsKind::Object {
            return Err(value.expected("an object { start, end }"));
        }
        let start = value.field("start")?;
        let start = Callback::from_js(start.get())
            .map_err(|error| PropError(format!("start: {}", error.0)))?;
        let end = value.field("end")?;
        let end =
            Callback::from_js(end.get()).map_err(|error| PropError(format!("end: {}", error.0)))?;
        Ok(SummonHold { start, end })
    }
}

/// How a hold ended.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SummonHoldEnd {
    /// Whether another key or modifier was pressed while the key was held
    /// (a shortcut, not the gesture): what the hold started should be
    /// dropped rather than used.
    pub cancelled: bool,
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

/// What a [`DoubleTap`] recognized.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Gesture {
    /// Two taps.
    DoubleTap,
    /// The second press stayed down [`HOLD`].
    HoldStart,
    /// The held key was released, or (`cancelled`) another key or
    /// modifier was pressed.
    HoldEnd { cancelled: bool },
}

/// Recognizes double taps of one modifier, and holds of their second press
/// when `hold` is set, from the keyboard's events. Times are seconds on any
/// monotonic clock (AppKit's event timestamps).
#[derive(Debug, Clone)]
pub(crate) struct DoubleTap {
    key: SummonKey,
    /// Whether a held second press is a hold (else it is nothing).
    hold: bool,
    /// When the key went down alone, while nothing else happened since.
    pressed: Option<f64>,
    /// When the last tap was released, while it can start a double tap.
    tapped: Option<f64>,
    /// When the key went down for a tap that may finish a double tap.
    second: Option<f64>,
    /// Whether a hold started and has not ended.
    holding: bool,
}

impl DoubleTap {
    pub(crate) fn new(key: SummonKey) -> Self {
        DoubleTap {
            key,
            hold: false,
            pressed: None,
            tapped: None,
            second: None,
            holding: false,
        }
    }

    /// Whether a held second press is a hold; forgets what is under way.
    pub(crate) fn set_hold(&mut self, hold: bool) {
        self.hold = hold;
        self.reset();
    }

    /// The time of the second press that becomes a hold if it is still
    /// down [`HOLD`] later (when [`tick`](Self::tick) is called with it).
    pub(crate) fn armed(&self) -> Option<f64> {
        if !self.hold || self.holding {
            return None;
        }
        self.second.filter(|_| self.pressed == self.second)
    }

    /// [`HOLD`] passed since the press at `press`: the hold starts if that
    /// press is still down and nothing else happened since.
    pub(crate) fn tick(&mut self, press: f64) -> Option<Gesture> {
        if self.armed() != Some(press) {
            return None;
        }
        self.holding = true;
        Some(Gesture::HoldStart)
    }

    /// The modifier keys changed to `down` at `time`.
    pub(crate) fn modifiers(&mut self, down: Modifiers, time: f64) -> Option<Gesture> {
        if self.holding {
            if down.only(self.key) {
                return None;
            }
            // Released, or another modifier joined (a shortcut).
            let cancelled = !down.none();
            self.reset();
            return Some(Gesture::HoldEnd { cancelled });
        }
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
            return None;
        }
        if down.none() {
            let pressed = self.pressed.take()?;
            // A second press held past `HOLD` is a hold, even one whose
            // `tick` came late: never a double tap too.
            let limit = if self.hold && self.second.is_some() {
                HOLD
            } else {
                INTERVAL
            };
            if time - pressed > limit {
                // Held: not a tap.
                self.reset();
                return None;
            }
            if self.second.take().is_some() {
                self.tapped = None;
                return Some(Gesture::DoubleTap);
            }
            self.tapped = Some(time);
            return None;
        }
        // Another modifier joined: a shortcut, not a tap.
        self.reset();
        None
    }

    /// Another key was pressed: no tap, and the end of a hold (cancelled).
    pub(crate) fn key_down(&mut self) -> Option<Gesture> {
        let holding = self.holding;
        self.reset();
        holding.then_some(Gesture::HoldEnd { cancelled: true })
    }

    /// A mouse button was pressed: no tap; a hold goes on.
    pub(crate) fn button_down(&mut self) {
        if !self.holding {
            self.reset();
        }
    }

    fn reset(&mut self) {
        self.pressed = None;
        self.tapped = None;
        self.second = None;
        self.holding = false;
    }
}

/// A listener of double taps.
type TapListener = Box<dyn Fn()>;

/// The listeners of holds: their start, and their end (cancelled or not).
type HoldListeners = (Box<dyn Fn()>, Box<dyn Fn(bool)>);

/// The gestures the app listens to, recognized from the keyboard's events
/// and delivered to their listeners: the platform's main thread keeps one.
pub(crate) struct Summoner {
    /// One recognizer per key, so a double tap and a hold may watch
    /// different keys.
    recognizers: [DoubleTap; 2],
    tap: Option<(SummonKey, TapListener)>,
    hold: Option<(SummonKey, HoldListeners)>,
}

impl Summoner {
    pub(crate) fn new() -> Self {
        Summoner {
            recognizers: [
                DoubleTap::new(SummonKey::Alt),
                DoubleTap::new(SummonKey::Control),
            ],
            tap: None,
            hold: None,
        }
    }

    /// Calls `on_tap` on double taps of `key`, instead of the earlier
    /// listener.
    pub(crate) fn set_tap(&mut self, key: SummonKey, on_tap: TapListener) {
        self.tap = Some((key, on_tap));
    }

    /// Calls `on_start` and `on_end` on holds of `key`, instead of the
    /// earlier listeners (whose hold under way, if any, is forgotten).
    pub(crate) fn set_hold(
        &mut self,
        key: SummonKey,
        on_start: Box<dyn Fn()>,
        on_end: Box<dyn Fn(bool)>,
    ) {
        for recognizer in &mut self.recognizers {
            recognizer.set_hold(recognizer.key == key);
        }
        self.hold = Some((key, (on_start, on_end)));
    }

    /// The modifier keys changed to `down` at `time`. Returns the time of a
    /// second press that just went down and may become a hold: call
    /// [`tick`](Self::tick) with it [`HOLD`] later.
    pub(crate) fn modifiers(&mut self, down: Modifiers, time: f64) -> Option<f64> {
        let mut armed = None;
        for index in 0..self.recognizers.len() {
            let recognizer = &mut self.recognizers[index];
            let before = recognizer.armed();
            let gesture = recognizer.modifiers(down, time);
            let after = recognizer.armed();
            if after.is_some() && after != before {
                armed = after;
            }
            self.deliver(index, gesture);
        }
        armed
    }

    /// [`HOLD`] passed since the press at `press` that
    /// [`modifiers`](Self::modifiers) returned.
    pub(crate) fn tick(&mut self, press: f64) {
        for index in 0..self.recognizers.len() {
            let gesture = self.recognizers[index].tick(press);
            self.deliver(index, gesture);
        }
    }

    /// Another key was pressed.
    pub(crate) fn key_down(&mut self) {
        for index in 0..self.recognizers.len() {
            let gesture = self.recognizers[index].key_down();
            self.deliver(index, gesture);
        }
    }

    /// A mouse button was pressed.
    pub(crate) fn button_down(&mut self) {
        for recognizer in &mut self.recognizers {
            recognizer.button_down();
        }
    }

    fn deliver(&self, index: usize, gesture: Option<Gesture>) {
        let Some(gesture) = gesture else {
            return;
        };
        let key = self.recognizers[index].key;
        match gesture {
            Gesture::DoubleTap => {
                if let Some((tap_key, on_tap)) = &self.tap
                    && *tap_key == key
                {
                    on_tap();
                }
            }
            Gesture::HoldStart | Gesture::HoldEnd { .. } => {
                if let Some((hold_key, (on_start, on_end))) = &self.hold
                    && *hold_key == key
                {
                    match gesture {
                        Gesture::HoldEnd { cancelled } => on_end(cancelled),
                        _ => on_start(),
                    }
                }
            }
        }
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
        times
            .iter()
            .map(|&(m, t)| tap.modifiers(m, t) == Some(Gesture::DoubleTap))
            .collect()
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
        tap.key_down();
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

    /// A recognizer of ⌥ that watches holds.
    fn holds() -> DoubleTap {
        let mut tap = DoubleTap::new(SummonKey::Alt);
        tap.set_hold(true);
        tap
    }

    const END: Option<Gesture> = Some(Gesture::HoldEnd { cancelled: false });
    const CANCEL: Option<Gesture> = Some(Gesture::HoldEnd { cancelled: true });

    #[test]
    fn a_quick_second_tap_is_a_double_tap_not_a_hold() {
        let mut tap = holds();
        assert_eq!(tap.modifiers(ALT, 0.0), None);
        assert_eq!(tap.modifiers(NONE, 0.08), None);
        assert_eq!(tap.modifiers(ALT, 0.3), None);
        assert_eq!(tap.armed(), Some(0.3));
        assert_eq!(tap.modifiers(NONE, 0.4), Some(Gesture::DoubleTap));
        // The timer set at the second press comes after it was released.
        assert_eq!(tap.tick(0.3), None);
    }

    #[test]
    fn a_held_second_press_is_a_hold() {
        let mut tap = holds();
        tap.modifiers(ALT, 0.0);
        tap.modifiers(NONE, 0.08);
        tap.modifiers(ALT, 0.3);
        // Only the timer of this press starts it.
        assert_eq!(tap.tick(0.0), None);
        assert_eq!(tap.tick(0.3), Some(Gesture::HoldStart));
        assert_eq!(tap.tick(0.3), None);
        assert_eq!(tap.armed(), None);
        // Still down: nothing; released: the end, and no double tap.
        assert_eq!(tap.modifiers(ALT, 1.0), None);
        assert_eq!(tap.modifiers(NONE, 3.0), END);
        // It starts over.
        assert_eq!(tap.modifiers(ALT, 3.1), None);
        assert_eq!(tap.armed(), None);
        assert_eq!(tap.modifiers(NONE, 3.15), None);
    }

    #[test]
    fn a_held_second_press_whose_timer_is_late_is_neither() {
        let mut tap = holds();
        tap.modifiers(ALT, 0.0);
        tap.modifiers(NONE, 0.08);
        tap.modifiers(ALT, 0.3);
        assert_eq!(tap.modifiers(NONE, 0.6), None);
        assert_eq!(tap.tick(0.3), None);
    }

    #[test]
    fn another_key_or_modifier_cancels_a_hold() {
        let mut tap = holds();
        tap.modifiers(ALT, 0.0);
        tap.modifiers(NONE, 0.08);
        tap.modifiers(ALT, 0.3);
        assert_eq!(tap.tick(0.3), Some(Gesture::HoldStart));
        // A mouse button does not.
        tap.button_down();
        assert_eq!(tap.key_down(), CANCEL);
        // Its release ends nothing more.
        assert_eq!(tap.modifiers(NONE, 1.0), None);

        let mut tap = holds();
        tap.modifiers(ALT, 0.0);
        tap.modifiers(NONE, 0.08);
        tap.modifiers(ALT, 0.3);
        tap.tick(0.3);
        let both = Modifiers { shift: true, ..ALT };
        assert_eq!(tap.modifiers(both, 0.9), CANCEL);
        assert_eq!(tap.modifiers(ALT, 1.0), None);
        assert_eq!(tap.modifiers(NONE, 1.1), None);

        // A key typed before the timer: no hold.
        let mut tap = holds();
        tap.modifiers(ALT, 0.0);
        tap.modifiers(NONE, 0.08);
        tap.modifiers(ALT, 0.3);
        assert_eq!(tap.key_down(), None);
        assert_eq!(tap.tick(0.3), None);
    }

    #[test]
    fn a_held_first_press_or_a_late_second_one_is_no_hold() {
        // The first press held: not a tap, so the next press is a first one.
        let mut tap = holds();
        tap.modifiers(ALT, 0.0);
        tap.modifiers(NONE, 1.0);
        tap.modifiers(ALT, 1.1);
        assert_eq!(tap.armed(), None);
        assert_eq!(tap.tick(1.1), None);
        // The second press too late after the first tap.
        let mut tap = holds();
        tap.modifiers(ALT, 0.0);
        tap.modifiers(NONE, 0.08);
        tap.modifiers(ALT, 0.6);
        assert_eq!(tap.armed(), None);
        assert_eq!(tap.tick(0.6), None);
        // Holds of a recognizer that does not watch them.
        let mut tap = DoubleTap::new(SummonKey::Alt);
        tap.modifiers(ALT, 0.0);
        tap.modifiers(NONE, 0.08);
        tap.modifiers(ALT, 0.3);
        assert_eq!(tap.armed(), None);
        assert_eq!(tap.tick(0.3), None);
        // Without holds, a second press up to `INTERVAL` long is a tap.
        assert_eq!(tap.modifiers(NONE, 0.6), Some(Gesture::DoubleTap));
    }

    #[test]
    fn the_summoner_delivers_to_the_listeners_of_each_key() {
        use std::cell::RefCell;
        use std::rc::Rc;

        let log = Rc::new(RefCell::new(Vec::<String>::new()));
        let mut summoner = Summoner::new();
        let tap_log = log.clone();
        summoner.set_tap(
            SummonKey::Alt,
            Box::new(move || tap_log.borrow_mut().push("tap".into())),
        );
        let (start_log, end_log) = (log.clone(), log.clone());
        summoner.set_hold(
            SummonKey::Alt,
            Box::new(move || start_log.borrow_mut().push("start".into())),
            Box::new(move |cancelled| end_log.borrow_mut().push(format!("end {cancelled}"))),
        );
        let control = Modifiers {
            control: true,
            ..NONE
        };

        // ⌥⌥: a double tap.
        assert_eq!(summoner.modifiers(ALT, 0.0), None);
        assert_eq!(summoner.modifiers(NONE, 0.05), None);
        assert_eq!(summoner.modifiers(ALT, 0.2), Some(0.2));
        assert_eq!(summoner.modifiers(NONE, 0.3), None);
        summoner.tick(0.2);
        // ⌥⌥ held: a hold.
        summoner.modifiers(ALT, 1.0);
        summoner.modifiers(NONE, 1.05);
        assert_eq!(summoner.modifiers(ALT, 1.2), Some(1.2));
        summoner.tick(1.2);
        summoner.modifiers(NONE, 2.0);
        // ⌃⌃ held: nobody listens.
        summoner.modifiers(control, 3.0);
        summoner.modifiers(NONE, 3.05);
        assert_eq!(summoner.modifiers(control, 3.2), None);
        summoner.modifiers(NONE, 3.3);
        assert_eq!(*log.borrow(), ["tap", "start", "end false"]);

        // The hold moves to ⌃; ⌥'s double taps stay, and its held second
        // press is a long tap again (nothing).
        let (start_log, end_log) = (log.clone(), log.clone());
        summoner.set_hold(
            SummonKey::Control,
            Box::new(move || start_log.borrow_mut().push("start ⌃".into())),
            Box::new(move |cancelled| end_log.borrow_mut().push(format!("end ⌃ {cancelled}"))),
        );
        log.borrow_mut().clear();
        summoner.modifiers(control, 4.0);
        summoner.modifiers(NONE, 4.05);
        assert_eq!(summoner.modifiers(control, 4.2), Some(4.2));
        summoner.tick(4.2);
        summoner.key_down();
        summoner.modifiers(NONE, 5.0);
        summoner.modifiers(ALT, 6.0);
        summoner.modifiers(NONE, 6.05);
        assert_eq!(summoner.modifiers(ALT, 6.2), None);
        summoner.modifiers(NONE, 6.3);
        assert_eq!(*log.borrow(), ["start ⌃", "end ⌃ true", "tap"]);
    }
}
