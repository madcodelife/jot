//! `SoundEffects`: whether the system lets apps play user interface sound
//! effects. Jot's own sounds (a to-do ticked) stay silent when it does not.
//!
//! macOS keeps it as "Play user interface sound effects" (System Settings →
//! Sound): the global preference `com.apple.sound.uiaudio.enabled`, which is
//! absent until the user first turns it off. Reading it needs no permission.

use nsh_core::prelude::*;

use crate::platform;

/// The system's setting for interface sound effects.
#[module]
pub struct SoundEffects;

#[module]
impl SoundEffects {
    /// Whether the system lets apps play interface sound effects: on unless
    /// the user turned them off (on where the platform has no such setting).
    pub fn system_allows() -> bool {
        platform::ui_sounds_on()
    }
}
