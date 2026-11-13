//! Jot's MCP server: lets Claude search, read and add to the user's notes folder.
//!
//! The tools never delete or overwrite: Claude can create a note (marked `source: claude`) or append to one,
//! so what the user wrote stays as it is.

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use jot_store::{NoteMeta, Source, Store, StoreError};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::Deserialize;

/// How many notes `search_notes` and `recent_notes` return when the call does not say.
const DEFAULT_LIMIT: usize = 10;
/// The most notes one call returns.
const MAX_LIMIT: usize = 50;

const INSTRUCTIONS: &str = "\
Jot is the user's personal notebook: a folder of Markdown notes they also read and edit themselves in the Jot \
app. Treat it as memory you share with the user. Search it when they ask whether they noted something or refer to \
something they wrote down; add to it when they ask you to note, save or remember something in Jot.

Write what the user asked for, briefly and in their words: a command, a decision, a link, a few lines of \
summary. Never dump a conversation or long transcripts into a note. Do not store passwords, keys, tokens or other \
sensitive personal information unless the user explicitly asks you to.

You cannot delete or overwrite notes. Before creating a note, search for one on the same subject and append to it \
instead of making a near-duplicate.";

/// The MCP server over one notes folder.
#[derive(Debug, Clone)]
pub struct JotServer {
    store: Store,
    tool_router: ToolRouter<Self>,
}

/// `search_notes`' arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchParams {
    /// Words to look for, case-insensitive. A note matches when every word is in its title or body.
    pub query: String,
    /// The most notes to return (default 10, at most 50).
    #[serde(default)]
    pub limit: Option<u32>,
}

/// `read_note`'s arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadParams {
    /// The note's title, as search_notes or recent_notes returned it (case-insensitive).
    pub title: String,
}

/// `recent_notes`' arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct RecentParams {
    /// The most notes to return (default 10, at most 50).
    #[serde(default)]
    pub limit: Option<u32>,
}

/// `create_note`'s arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateParams {
    /// A short title the user would search for, such as "Deploy command". It becomes the file name: `/`, `\`
    /// and `:` turn into `-`.
    pub title: String,
    /// The note's text, in Markdown.
    pub body: String,
}

/// `append_note`'s arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct AppendParams {
    /// The existing note's title (case-insensitive).
    pub title: String,
    /// The text to add at the end, in Markdown. It goes after a blank line.
    pub text: String,
}

#[tool_router]
impl JotServer {
    /// A server over `store`.
    pub fn new(store: Store) -> Self {
        Self {
            store,
            tool_router: Self::tool_router(),
        }
    }

    #[tool(
        description = "Search the user's Jot notes by title and body. Every word of the query must match \
            (case-insensitive). Returns each note's title, when it was modified, who wrote it and a snippet \
            around the match; title matches come first, then the newest. Use this first when the user asks \
            whether they noted something (\"did I write down…\", \"what was the command I saved for…\"), then \
            read_note for the full text. Also use it before create_note, to find a note to append to instead.",
        annotations(title = "Search notes", read_only_hint = true, open_world_hint = false)
    )]
    async fn search_notes(&self, Parameters(params): Parameters<SearchParams>) -> CallToolResult {
        let query = params.query.trim();
        match self.store.search(query, limit(params.limit)) {
            Ok(hits) if hits.is_empty() => text(format!(
                "No notes match \"{query}\". Try fewer or other words, or recent_notes to browse."
            )),
            Ok(hits) => {
                let mut out = format!("{} matching \"{query}\":\n", count(hits.len()));
                for hit in &hits {
                    push_entry(&mut out, &hit.meta, &hit.snippet);
                }
                text(out)
            }
            Err(error) => failure(&error, query),
        }
    }

    #[tool(
        description = "Read the full text of one Jot note. Takes the note's title as search_notes or \
            recent_notes returned it (case-insensitive). Use it after a search when the user wants what a note \
            says.",
        annotations(title = "Read note", read_only_hint = true, open_world_hint = false)
    )]
    async fn read_note(&self, Parameters(params): Parameters<ReadParams>) -> CallToolResult {
        match self.store.read(&params.title) {
            Ok(Some(note)) => {
                let mut out = format!("# {}\n{}\n\n", note.meta.title, describe(&note.meta));
                out.push_str(&note.body);
                text(out)
            }
            Ok(None) => not_found(&params.title),
            Err(error) => failure(&error, &params.title),
        }
    }

    #[tool(
        description = "List the user's most recently modified Jot notes, newest first, with a short preview \
            of each. Use it when the user refers to something they noted recently without saying what, or \
            wants to see what is in Jot.",
        annotations(title = "Recent notes", read_only_hint = true, open_world_hint = false)
    )]
    async fn recent_notes(&self, Parameters(params): Parameters<RecentParams>) -> CallToolResult {
        match self.store.list() {
            Ok(notes) if notes.is_empty() => text("Jot has no notes yet.".to_owned()),
            Ok(mut notes) => {
                notes.truncate(limit(params.limit));
                let mut out = format!("{}, most recently modified first:\n", count(notes.len()));
                for meta in &notes {
                    push_entry(&mut out, meta, &meta.preview);
                }
                text(out)
            }
            Err(error) => failure(&error, ""),
        }
    }

    #[tool(
        description = "Create a new note in the user's Jot, marked as written by Claude. Use it when the user \
            asks to note, save, jot down or remember something in Jot (\"记一下\", \"记到 Jot\") and no note on that \
            subject exists yet. Keep it short and to the point; do not paste the conversation. Fails if a note \
            with this title exists: then use append_note.",
        annotations(
            title = "Create note",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn create_note(&self, Parameters(params): Parameters<CreateParams>) -> CallToolResult {
        match self
            .store
            .create(&params.title, &params.body, Source::Claude)
        {
            Ok(meta) => {
                let mut out = format!("Created the note \"{}\".", meta.title);
                if meta.title != params.title.trim() {
                    out.push_str(&format!(
                        " (The title \"{}\" was changed to fit a file name.)",
                        params.title.trim()
                    ));
                }
                text(out)
            }
            Err(StoreError::AlreadyExists) => error(format!(
                "A note titled \"{}\" already exists. Use append_note to add to it, or choose another title.",
                params.title.trim()
            )),
            Err(error) => failure(&error, &params.title),
        }
    }

    #[tool(
        description = "Add text to the end of an existing Jot note, after a blank line. What is there stays \
            unchanged. Use it when the user asks to add something to a note, or to note something on a subject \
            that already has a note. Fails if no note has this title: find it with search_notes first, or use \
            create_note for a new subject.",
        annotations(
            title = "Append to note",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn append_note(&self, Parameters(params): Parameters<AppendParams>) -> CallToolResult {
        if params.text.trim().is_empty() {
            return error("There is no text to append.".to_owned());
        }
        match self.store.append(&params.title, &params.text) {
            Ok(meta) => text(format!("Appended to the note \"{}\".", meta.title)),
            Err(StoreError::NotFound) => not_found(&params.title),
            Err(error) => failure(&error, &params.title),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for JotServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("jot", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }
}

/// The notes folder from the command line (`--dir <path>` or `--dir=<path>`), else `JOT_DIR`, else
/// `~/Documents/Jot`. A leading `~` is the home directory, since MCP clients start the server without a shell.
pub fn notes_dir(
    args: impl IntoIterator<Item = OsString>,
    env: Option<OsString>,
    home: Option<PathBuf>,
) -> Result<PathBuf, String> {
    let mut dir = None;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let Some(arg) = arg.to_str() else {
            return Err(format!("unexpected argument {arg:?}"));
        };
        if arg == "--dir" {
            dir = Some(args.next().ok_or("--dir needs a path")?);
        } else if let Some(value) = arg.strip_prefix("--dir=") {
            dir = Some(value.into());
        } else {
            return Err(format!("unexpected argument {arg:?}"));
        }
    }
    let dir = match dir.or(env.filter(|value| !value.is_empty())) {
        Some(dir) => PathBuf::from(dir),
        None => home
            .clone()
            .ok_or("no home directory: pass --dir")?
            .join("Documents")
            .join("Jot"),
    };
    expand_home(dir, home.as_ref())
}

fn expand_home(dir: PathBuf, home: Option<&PathBuf>) -> Result<PathBuf, String> {
    let Ok(rest) = dir.strip_prefix("~") else {
        return Ok(dir);
    };
    let home = home.ok_or("no home directory to expand ~ with")?;
    Ok(home.join(rest))
}

fn limit(requested: Option<u32>) -> usize {
    match requested {
        Some(0) | None => DEFAULT_LIMIT,
        Some(limit) => (limit as usize).min(MAX_LIMIT),
    }
}

fn count(notes: usize) -> String {
    if notes == 1 {
        "1 note".to_owned()
    } else {
        format!("{notes} notes")
    }
}

fn push_entry(out: &mut String, meta: &NoteMeta, excerpt: &str) {
    out.push_str(&format!("\n## {}\n{}\n", meta.title, describe(meta)));
    if !excerpt.is_empty() {
        out.push_str(excerpt);
        out.push('\n');
    }
}

fn describe(meta: &NoteMeta) -> String {
    let author = match meta.source {
        Source::User => "the user",
        Source::Claude => "Claude",
    };
    format!(
        "Modified {} · written by {author}",
        format_time(meta.modified)
    )
}

/// `YYYY-MM-DD HH:MM UTC`.
fn format_time(time: SystemTime) -> String {
    let seconds = match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs() as i64,
        Err(error) => -(error.duration().as_secs() as i64),
    };
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let second_of_day = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02} UTC",
        second_of_day / 3600,
        second_of_day % 3600 / 60
    )
}

/// The proleptic Gregorian date of a day counted from 1970-01-01 (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn text(text: String) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(text)])
}

fn error(message: String) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(message)])
}

fn not_found(title: &str) -> CallToolResult {
    error(format!(
        "No note is titled \"{}\". Use search_notes to find the right title, or create_note for a new note.",
        title.trim()
    ))
}

fn failure(failure: &StoreError, title: &str) -> CallToolResult {
    match failure {
        StoreError::InvalidTitle => error(format!(
            "\"{}\" cannot be a note title: it must not be empty, must not start with \".\" and must fit in a \
             file name.",
            title.trim()
        )),
        StoreError::NotFound => not_found(title),
        StoreError::AlreadyExists => error(format!(
            "A note titled \"{}\" already exists.",
            title.trim()
        )),
        StoreError::Io(io) => error(format!(
            "Jot could not read or write its notes folder: {io}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(args: &[&str], env: Option<&str>) -> Result<PathBuf, String> {
        notes_dir(
            args.iter().map(OsString::from),
            env.map(OsString::from),
            Some(PathBuf::from("/home/me")),
        )
    }

    #[test]
    fn notes_dir_sources() {
        assert_eq!(
            dir(&[], None).unwrap(),
            PathBuf::from("/home/me/Documents/Jot")
        );
        assert_eq!(
            dir(&[], Some("")).unwrap(),
            PathBuf::from("/home/me/Documents/Jot")
        );
        assert_eq!(dir(&[], Some("/env")).unwrap(), PathBuf::from("/env"));
        assert_eq!(
            dir(&["--dir", "/arg"], Some("/env")).unwrap(),
            PathBuf::from("/arg")
        );
        assert_eq!(dir(&["--dir=/arg"], None).unwrap(), PathBuf::from("/arg"));
        assert_eq!(
            dir(&["--dir", "~/Notes"], None).unwrap(),
            PathBuf::from("/home/me/Notes")
        );
        assert_eq!(dir(&[], Some("~")).unwrap(), PathBuf::from("/home/me"));
        assert!(dir(&["--dir"], None).is_err());
        assert!(dir(&["--verbose"], None).is_err());
        assert!(notes_dir(Vec::<OsString>::new(), None, None).is_err());
    }

    #[test]
    fn limits() {
        assert_eq!(limit(None), DEFAULT_LIMIT);
        assert_eq!(limit(Some(0)), DEFAULT_LIMIT);
        assert_eq!(limit(Some(3)), 3);
        assert_eq!(limit(Some(1000)), MAX_LIMIT);
    }

    #[test]
    fn times() {
        assert_eq!(format_time(UNIX_EPOCH), "1970-01-01 00:00 UTC");
        let time = UNIX_EPOCH + std::time::Duration::from_secs(1_794_574_800);
        assert_eq!(format_time(time), "2026-11-13 13:00 UTC");
        let leap = UNIX_EPOCH + std::time::Duration::from_secs(951_782_400);
        assert_eq!(format_time(leap), "2000-02-29 00:00 UTC");
    }
}
