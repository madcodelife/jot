//! `Folder`: the notes folder as the settings window shows it: the system's
//! dialog to choose another, and the folder shown in the file manager.
//!
//! Both are NSH's file services for an app's own Rust ([`pick_paths`],
//! [`reveal_path`]: AppKit's `NSOpenPanel` and `NSWorkspace`, the shell's
//! and GTK's dialogs elsewhere), which no module of NSH's runtime gives to
//! TS.

use nsh_core::file_dialog::OpenDialog;
use nsh_core::prelude::*;

use crate::notes::expand_home;

/// The notes folder's dialogs.
#[module]
pub struct Folder;

#[module]
impl Folder {
    /// Asks for a folder with the system's dialog, opened in `start` (a
    /// leading `~/` is the home folder), its confirming button labelled
    /// `button`. Resolves with the folder's absolute path, or `null` when
    /// the user cancels; rejects when the dialog cannot show.
    pub async fn choose(start: String, button: String) -> Result<Option<String>, String> {
        let dialog = OpenDialog::folders()
            .directory(expand_home(&start))
            .button_label(button);
        let picked = pick_paths(dialog).await?;
        Ok(picked
            .and_then(|paths| paths.into_iter().next())
            .map(|path| path.to_string_lossy().into_owned()))
    }

    /// Shows `path` (a leading `~/` is the home folder) selected in the
    /// file manager (Finder). Rejects when it does not exist.
    pub async fn reveal(path: String) -> Result<(), String> {
        reveal_path(expand_home(&path)).await
    }

    /// `path` as people read it: the home folder as `~`
    /// (`/Users/me/Documents/Jot` is `~/Documents/Jot`).
    pub fn shown(path: String) -> String {
        let expanded = expand_home(&path);
        let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) else {
            return expanded.to_string_lossy().into_owned();
        };
        match expanded.strip_prefix(&home) {
            Ok(rest) if rest.as_os_str().is_empty() => "~".to_owned(),
            Ok(rest) => format!("~/{}", rest.to_string_lossy()),
            Err(_) => expanded.to_string_lossy().into_owned(),
        }
    }
}
