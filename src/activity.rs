//! `ActivityLog`: what AI apps wrote through `jot-mcp`, which records each
//! write in a log beside `ai.json` (`jot_store::Activity`,
//! `~/Library/Application Support/Jot/activity.jsonl`). `Notes.watchActivity`
//! reads the lines added to it while the app runs, for the island.
//!
//! The notes folder is the only other thing the two share, and a note
//! appearing there says nothing of who wrote it on which Mac: only the log
//! says what an AI app did here.

use std::path::{Path, PathBuf};

use jot_store::{Action, Activity};
use nsh_core::prelude::*;

/// The AI apps' activity log.
#[module]
pub struct ActivityLog;

#[module]
impl ActivityLog {
    /// The log's file; `null` without a home folder.
    pub fn path() -> Option<String> {
        Activity::default_path().map(|path| path.to_string_lossy().into_owned())
    }

    /// Adds `activity` to the log at `path`, as `jot-mcp` does (one line,
    /// rotated past its size). Throws when it cannot be written.
    pub fn append(path: String, activity: AgentActivity) -> Result<(), JsError> {
        let at = activity.at.parse().map_err(|_| {
            JsError::Type(format!(
                "at must be \"YYYY-MM-DDTHH:mm:ss\", got {:?}",
                activity.at
            ))
        })?;
        let record = Activity::new(
            at,
            &activity.dir,
            activity.agent,
            activity.action.into(),
            activity.title,
        )
        .with_in_trash(activity.in_trash.map(PathBuf::from));
        let record = match activity.previous {
            Some(previous) => record.with_previous(previous),
            None => record,
        };
        record
            .append(Path::new(&path))
            .map_err(|error| JsError::Error(format!("cannot write to {path}: {error}")))
    }
}

/// A write of an AI app, as the log has it.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct AgentActivity {
    /// When, in local time: `"2026-11-26T14:30:05"`.
    pub at: String,
    /// The notes folder it wrote to.
    pub dir: String,
    /// The app's name to show: `"Claude Code"`, `"Cursor"`.
    pub agent: String,
    /// What it did.
    pub action: AgentAction,
    /// The note's title.
    pub title: String,
    /// `replace`: the name the note's previous version took in the trash.
    pub previous: Option<String>,
    /// `trash`, `replace`: where the note (or its previous version) is in
    /// the trash, when the system said.
    pub in_trash: Option<String>,
}

/// What an AI app did to a note.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PropEnum)]
pub enum AgentAction {
    /// Made a new note (`create_note`, or `add_todo` into a note it made).
    Create,
    /// Added text at a note's end.
    Append,
    /// Changed one passage of a note's text.
    Edit,
    /// Added a to-do to a note that was there.
    Todo,
    /// Checked a to-do off.
    Complete,
    /// Moved a to-do's reminder time, or removed it.
    Reschedule,
    /// Rewrote a whole note, its previous version going to the trash.
    Replace,
    /// Moved a note to the trash.
    Trash,
}

impl From<Action> for AgentAction {
    fn from(action: Action) -> Self {
        match action {
            Action::Create => AgentAction::Create,
            Action::Append => AgentAction::Append,
            Action::Edit => AgentAction::Edit,
            Action::Todo => AgentAction::Todo,
            Action::Complete => AgentAction::Complete,
            Action::Reschedule => AgentAction::Reschedule,
            Action::Replace => AgentAction::Replace,
            Action::Trash => AgentAction::Trash,
        }
    }
}

impl From<AgentAction> for Action {
    fn from(action: AgentAction) -> Self {
        match action {
            AgentAction::Create => Action::Create,
            AgentAction::Append => Action::Append,
            AgentAction::Edit => Action::Edit,
            AgentAction::Todo => Action::Todo,
            AgentAction::Complete => Action::Complete,
            AgentAction::Reschedule => Action::Reschedule,
            AgentAction::Replace => Action::Replace,
            AgentAction::Trash => Action::Trash,
        }
    }
}

impl From<Activity> for AgentActivity {
    fn from(activity: Activity) -> Self {
        AgentActivity {
            at: activity.at.strftime("%Y-%m-%dT%H:%M:%S").to_string(),
            dir: activity.dir.to_string_lossy().into_owned(),
            agent: activity.agent,
            action: activity.action.into(),
            title: activity.title,
            previous: activity.previous,
            in_trash: activity
                .in_trash
                .map(|path| path.to_string_lossy().into_owned()),
        }
    }
}

/// A folder as the log names it: absolute, links resolved (`/tmp` is
/// `/private/tmp` on macOS); as it is when it cannot be resolved.
pub(crate) fn resolved(dir: &Path) -> PathBuf {
    std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_owned())
}

/// Whether the log's `dir` is the notes folder `folder` (resolved): the
/// same path once resolved, or, on a file system that ignores case (the
/// Mac's default), the same but for case.
pub(crate) fn same_folder(dir: &Path, folder: &Path) -> bool {
    let dir = resolved(&crate::notes::expand_home(&dir.to_string_lossy()));
    if dir == folder {
        return true;
    }
    cfg!(target_os = "macos")
        && dir.to_string_lossy().to_lowercase() == folder.to_string_lossy().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_written_to_is_found_through_links_and_case() {
        let dir = tempfile::tempdir().unwrap();
        let notes = dir.path().join("Notes");
        std::fs::create_dir(&notes).unwrap();
        let folder = resolved(&notes);
        assert!(same_folder(&notes, &folder));
        assert!(same_folder(&folder, &folder));
        #[cfg(unix)]
        {
            let link = dir.path().join("Link");
            std::os::unix::fs::symlink(&notes, &link).unwrap();
            assert!(same_folder(&link, &folder));
        }
        if cfg!(target_os = "macos") {
            assert!(same_folder(&dir.path().join("NOTES"), &folder));
        }
        assert!(!same_folder(&dir.path().join("Other"), &folder));
    }
}
