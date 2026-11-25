//! `AiAccess`: what the user allows AI apps beyond reading and adding, the
//! settings' "Allow AI apps to move notes to the Trash and rewrite notes".
//!
//! `jot-mcp` runs in each AI app's process, not Jot's, so the setting lives
//! in a file both read (`jot_store::AiSettings`,
//! `~/Library/Application Support/Jot/ai.json`), not in NSH's Storage:
//! `jot-mcp` reads it on every call that needs it, so a change applies at
//! once, without connecting the apps again.

use jot_store::AiSettings;
use nsh_core::element::io_code;
use nsh_core::prelude::*;

/// Jot's settings for AI apps.
#[module]
pub struct AiAccess;

#[module]
impl AiAccess {
    /// Whether AI apps may move notes to the Trash and rewrite notes: what
    /// the file says (off when there is none).
    pub fn allows_trash_and_rewrite() -> bool {
        AiSettings::default_path()
            .map(|path| AiSettings::read(&path).allow_trash_and_rewrite)
            .unwrap_or(false)
    }

    /// Writes the setting, with the language Jot shows in (`"zh-Hans"`,
    /// `"en"`, …: what a rewritten note's previous version is named in).
    /// Throws when the file cannot be written.
    pub fn set(allow_trash_and_rewrite: bool, language: String) -> Result<(), JsError> {
        let path = AiSettings::default_path()
            .ok_or_else(|| JsError::Error("no home folder for Jot's settings".into()))?;
        AiSettings::new(allow_trash_and_rewrite, Some(language))
            .write(&path)
            .map_err(|error| {
                let message = JsError::Error(format!(
                    "cannot save the AI apps' setting to {}: {error}",
                    path.display()
                ));
                match io_code(&error) {
                    Some(code) => message.with_code(code),
                    None => message,
                }
            })
    }
}
