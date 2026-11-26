//! Platforms without a native implementation yet: no permission is
//! needed, double taps and holds are not heard, the input source's
//! language is unknown, there is no iCloud Drive, and nothing turns
//! interface sounds off.

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

/// Not known here: dictation falls back to the user's languages.
pub(crate) fn input_language() -> Option<String> {
    None
}

/// No iCloud Drive here.
pub(crate) fn icloud_drive() -> crate::folder::Drive {
    crate::folder::Drive {
        root: None,
        on: false,
    }
}

/// No trash folder to open here (the freedesktop.org trash and the Recycle Bin are not opened yet).
pub(crate) fn trash_folder() -> Option<std::path::PathBuf> {
    None
}

/// No system setting for interface sounds here: Jot's own setting decides.
pub(crate) fn ui_sounds_on() -> bool {
    true
}
