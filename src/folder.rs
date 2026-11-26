//! `Folder`: the notes folder as the settings window shows it: the system's
//! dialog to choose another, and the folder shown in the file manager.
//!
//! Both are NSH's file services for an app's own Rust ([`pick_paths`],
//! [`reveal_path`]: AppKit's `NSOpenPanel` and `NSWorkspace`, the shell's
//! and GTK's dialogs elsewhere), which no module of NSH's runtime gives to
//! TS.
//!
//! It also knows where iCloud Drive keeps Jot's folder, and moves the notes
//! there (`jot_store::Store::move_into`, off the engine thread).

use std::path::PathBuf;

use jot_store::Store;
use nsh_core::file_dialog::OpenDialog;
use nsh_core::prelude::*;

use crate::notes::{expand_home, store_error};
use crate::platform;

/// Jot's folder in iCloud Drive, under its root.
const ICLOUD_FOLDER: &str = "Jot";

/// iCloud Drive as the platform sees it.
pub(crate) struct Drive {
    /// Its root folder (`~/Library/Mobile Documents/com~apple~CloudDocs`); `None` without iCloud Drive.
    pub root: Option<PathBuf>,
    /// Signed in, iCloud Drive on.
    pub on: bool,
}

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

    /// Jot's folder in iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/Jot`), and whether
    /// iCloud Drive is on here (signed in to iCloud, iCloud Drive turned on). `path` is null where there is no
    /// iCloud Drive (not macOS).
    pub fn icloud() -> ICloudDrive {
        let drive = platform::icloud_drive();
        ICloudDrive {
            path: drive
                .root
                .map(|root| root.join(ICLOUD_FOLDER).to_string_lossy().into_owned()),
            available: drive.on,
        }
    }

    /// Moves every note of the folder `from` into the folder `to` (both: a leading `~/` is the home folder;
    /// `to` is created), never over a note there: the very same note stays in `from` (`same`), a different one
    /// with its title moves in as `Title 2` (`renamed`). Other files stay in `from`. Rejects when either folder
    /// cannot be opened or read.
    pub async fn move_notes(from: String, to: String) -> Result<MovedNotes, JsError> {
        let (from, to) = (expand_home(&from), expand_home(&to));
        blocking(move || {
            let open = |dir: &PathBuf| {
                Store::open(dir).map_err(|e| {
                    store_error(e, format_args!("cannot open the folder {}", dir.display()))
                })
            };
            let (source, target) = (open(&from)?, open(&to)?);
            let moved = source
                .move_into(&target)
                .map_err(|e| store_error(e, "cannot move the notes"))?;
            Ok(MovedNotes {
                moved: moved.moved,
                renamed: moved
                    .renamed
                    .into_iter()
                    .map(|(from, to)| RenamedNote { from, to })
                    .collect(),
                same: moved.same,
                failed: moved
                    .failed
                    .into_iter()
                    .map(|(title, error)| FailedNote { title, error })
                    .collect(),
            })
        })
        .await
        .map_err(|error| JsError::Error(error.to_string()))?
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

/// iCloud Drive on this Mac.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ICloudDrive {
    /// Jot's folder in it, whether or not it is on; null without iCloud Drive (not macOS).
    pub path: Option<String>,
    /// Signed in to iCloud with iCloud Drive turned on.
    pub available: bool,
}

/// What `Folder.moveNotes` did.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct MovedNotes {
    /// The notes moved under their own titles.
    pub moved: Vec<String>,
    /// The notes moved under another title: the folder had a different note of theirs.
    pub renamed: Vec<RenamedNote>,
    /// The notes left where they were: the folder has the very same note.
    pub same: Vec<String>,
    /// The notes left where they were because they could not be moved.
    pub failed: Vec<FailedNote>,
}

/// A note moved in under another title.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct RenamedNote {
    /// Its title.
    pub from: String,
    /// Its title in the new folder (`Title 2`).
    pub to: String,
}

/// A note that could not be moved.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct FailedNote {
    /// Its title.
    pub title: String,
    /// Why.
    pub error: String,
}
