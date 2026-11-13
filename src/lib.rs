//! The app's Rust code: what `App.tsx` imports from `jot/native`. Their
//! TypeScript declarations are generated from these types into
//! `.nsh/types/jot/native.d.ts`.
//!
//! - [`Notes`]: the notes folder (`jot_store::Store`) as a class, with its
//!   to-dos and a listener for changes made outside the app.
//! - [`When`]: the time phrases of a to-do line.
//! - [`Reminders`]: fires at the to-dos' due times while the app runs.
//! - [`Summon`]: a system-wide double tap of a modifier key.
//!
//! Platform code lives in `platform/<os>.rs` behind one interface, so
//! `App.tsx` never checks the platform for these.

mod notes;
#[cfg(target_os = "macos")]
#[path = "platform/macos.rs"]
mod platform;
#[cfg(not(target_os = "macos"))]
#[path = "platform/other.rs"]
mod platform;
mod relay;
mod reminders;
mod summon;
mod when;

use nsh_core::prelude::*;

pub use notes::{Note, NoteMeta, NoteSource, Notes, SearchHit, Todo};
pub use reminders::{DueEvent, Reminders};
pub use summon::{Summon, SummonKey};
pub use when::{When, WhenMatch};

/// The crate's UI set (`nsh.json` `"rust"`).
#[native_module("jot/native")]
fn native(registry: &mut Registry) {
    registry
        .class::<Notes>()
        .class::<Reminders>()
        .module::<When>()
        .module::<Summon>();
}
