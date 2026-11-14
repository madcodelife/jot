//! Platforms without a native implementation yet: no permission is
//! needed, and double taps and holds are not heard.

use crate::summon::SummonKey;

/// No permission to grant here.
pub(crate) fn is_trusted() -> bool {
    true
}

/// Nothing to ask for here.
pub(crate) fn request_trust() {}

/// Not heard here yet: `on_tap` is dropped.
pub(crate) fn watch_double_tap(_key: SummonKey, _on_tap: Box<dyn Fn() + Send>) {}

/// Not heard here yet: the listeners are dropped.
pub(crate) fn watch_double_tap_hold(
    _key: SummonKey,
    _on_start: Box<dyn Fn() + Send>,
    _on_end: Box<dyn Fn(bool) + Send>,
) {
}
