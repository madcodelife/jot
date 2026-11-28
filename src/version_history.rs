//! `VersionHistory`: where the notes' earlier versions are kept, outside
//! the notes folder, beside the AI apps' setting and their activity log
//! (`~/Library/Application Support/Jot/history` on macOS): the app gives it
//! to `Notes.keepHistory`, and `jot-mcp` keeps its versions there too.

use jot_store::Store;
use nsh_core::prelude::*;

/// The notes' version history.
#[module]
pub struct VersionHistory;

#[module]
impl VersionHistory {
    /// The history's folder; `null` without a home folder.
    pub fn path() -> Option<String> {
        Store::default_history_folder().map(|path| path.to_string_lossy().into_owned())
    }
}
