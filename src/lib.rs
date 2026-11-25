//! The app's Rust code: what `App.tsx` imports from `jot/native`. Their
//! TypeScript declarations are generated from these types into
//! `.nsh/types/jot/native.d.ts`.
//!
//! - [`Notes`]: the notes folder (`jot_store::Store`) as a class, with its
//!   to-dos and a listener for changes made outside the app.
//! - [`When`]: the time phrases of a to-do line.
//! - [`Reminders`]: fires at the to-dos' due times while the app runs.
//! - [`Summon`]: a system-wide double tap of a modifier key.
//! - [`Folder`]: the system's folder dialog, and a folder shown in Finder.
//! - [`InputSource`]: the language of the keyboard input source, which
//!   dictation listens for.
//! - [`Connections`]: the AI apps Jot's MCP server is registered with
//!   (`connect`: one table of apps, their configuration files edited in
//!   place).
//! - [`AiAccess`]: whether AI apps may move notes to the Trash and rewrite
//!   them, in a file `jot-mcp` reads too.
//!
//! Platform code lives in `platform/<os>.rs` behind one interface, so
//! `App.tsx` never checks the platform for these.

mod ai_access;
mod connect;
mod connections;
mod folder;
mod input_source;
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

pub use ai_access::AiAccess;
pub use connections::{AiClient, Connections, GenericSetup, ManualReason};
pub use folder::{FailedNote, Folder, ICloudDrive, MovedNotes, RenamedNote};
pub use input_source::InputSource;
pub use notes::{
    Conflict, ConflictChoice, Note, NoteMeta, Notes, ResolvedConflict, SearchHit, Todo, TrashedNote,
};
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
        .module::<Summon>()
        .module::<Folder>()
        .module::<InputSource>()
        .module::<Connections>()
        .module::<AiAccess>();
}
