//! What the user allowed AI apps in Jot's settings, shared by the app (which writes it) and `jot-mcp` (which reads
//! it on every call that needs it, so a change applies at once, with no reconnecting): a small JSON file outside the
//! notes folder, `~/Library/Application Support/Jot/ai.json` on macOS.
//!
//! ```json
//! { "allowTrashAndRewrite": true, "language": "zh-Hans" }
//! ```

use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};

/// The settings `jot-mcp` follows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct AiSettings {
    /// AI apps may move notes to the trash (`trash_note`) and rewrite whole notes (`replace_note`). Off unless the
    /// user turned it on.
    pub allow_trash_and_rewrite: bool,
    /// The language Jot shows in (`zh-Hans`, `zh-Hant`, `en`, `ja`). `jot-mcp` reads nothing from it now: it named a
    /// rewritten note's previous version in the trash, which the note's version history keeps instead. `None`: English.
    pub language: Option<String>,
}

impl AiSettings {
    /// Settings with these values.
    pub fn new(allow_trash_and_rewrite: bool, language: Option<String>) -> AiSettings {
        AiSettings {
            allow_trash_and_rewrite,
            language,
        }
    }

    /// The file under the home folder `home`.
    pub fn path(home: &Path) -> PathBuf {
        if cfg!(target_os = "macos") {
            home.join("Library/Application Support/Jot/ai.json")
        } else {
            home.join(".config/jot/ai.json")
        }
    }

    /// The file under the user's home folder, if there is one.
    pub fn default_path() -> Option<PathBuf> {
        std::env::home_dir().map(|home| AiSettings::path(&home))
    }

    /// The settings in the file at `path`; the defaults (nothing allowed) when it is missing or unreadable.
    pub fn read(path: &Path) -> AiSettings {
        let Ok(text) = fs::read_to_string(path) else {
            return AiSettings::default();
        };
        let Ok(serde_json::Value::Object(map)) = serde_json::from_str(&text) else {
            return AiSettings::default();
        };
        AiSettings {
            allow_trash_and_rewrite: map
                .get("allowTrashAndRewrite")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            language: map
                .get("language")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
        }
    }

    /// Writes the settings to `path` (its folder created as needed) through a temporary file renamed over it.
    pub fn write(&self, path: &Path) -> io::Result<()> {
        let dir = path
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no folder"))?;
        fs::create_dir_all(dir)?;
        let mut map = serde_json::Map::new();
        map.insert(
            "allowTrashAndRewrite".into(),
            self.allow_trash_and_rewrite.into(),
        );
        if let Some(language) = &self.language {
            map.insert("language".into(), language.clone().into());
        }
        let text = serde_json::to_string_pretty(&serde_json::Value::Object(map))? + "\n";
        let mut file = tempfile::Builder::new()
            .prefix(".ai-")
            .suffix(".tmp")
            .tempfile_in(dir)?;
        file.write_all(text.as_bytes())?;
        file.as_file().sync_all()?;
        file.persist(path).map_err(|error| error.error)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_broken_is_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Jot/ai.json");
        assert_eq!(AiSettings::read(&path), AiSettings::default());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        for broken in ["", "{", "[]", "{\"allowTrashAndRewrite\": \"yes\"}"] {
            fs::write(&path, broken).unwrap();
            assert!(
                !AiSettings::read(&path).allow_trash_and_rewrite,
                "{broken:?}"
            );
        }
    }

    #[test]
    fn written_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Jot/ai.json");
        let on = AiSettings::new(true, Some("zh-Hans".into()));
        on.write(&path).unwrap();
        assert_eq!(AiSettings::read(&path), on);
        let off = AiSettings::new(false, None);
        off.write(&path).unwrap();
        assert_eq!(AiSettings::read(&path), off);
        // Nothing else is left in the folder.
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn under_the_home_folder() {
        let path = AiSettings::path(Path::new("/Users/me"));
        assert!(path.starts_with("/Users/me"));
        assert!(path.ends_with("ai.json"));
    }
}
