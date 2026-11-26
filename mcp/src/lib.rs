//! Jot's MCP server: lets an AI app (Claude, Claude Code, Cursor, Codex, …) search, read and add to the user's notes
//! folder, and keep their to-dos.
//!
//! The app can create a note (marked with its name from the MCP `initialize` handshake, `source: cursor`:
//! `jot_store::Source::from_client`), append to one, add a to-do, check one off or move its reminder time. Two tools
//! take something away, and only while the user allows it in Jot's settings (`jot_store::AiSettings`, read on every
//! call): `trash_note` moves a note to the system trash, `replace_note` rewrites a whole note after putting its
//! previous version in the trash; nothing is ever deleted for good. A note the user locked in Jot is read-only to
//! every tool, and none unlocks one.

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jiff::civil::{Date, DateTime};
use jot_store::{AiSettings, DEFAULT_TODO_NOTE, NoteMeta, Source, Store, StoreError, Todo, when};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::service::RequestContext;
use rmcp::{RoleServer, ServerHandler, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::Deserialize;

/// How many notes `search_notes` and `recent_notes` return when the call does not say.
const DEFAULT_LIMIT: usize = 10;
/// The most notes one call returns.
const MAX_LIMIT: usize = 50;
/// How long a tool waits for a note the system is downloading (iCloud Drive moved it off the Mac), and how often
/// it looks.
const DOWNLOAD_WAIT: Duration = Duration::from_secs(20);
const DOWNLOAD_POLL: Duration = Duration::from_millis(250);

const INSTRUCTIONS: &str = "\
Jot is the user's personal notebook: a folder of Markdown notes they also read and edit themselves in the Jot \
app. Treat it as memory you share with the user. Search it when they ask whether they noted something or refer to \
something they wrote down, and before you guess at or ask for a fact about their own things that neither the \
conversation nor the files at hand give you: which of their machines they mean and how to reach it, an account, a \
setting, a decision they made earlier. Search for one or two distinctive words, such as a host or project name; if \
nothing turns up, go on as you would have, and if something does, say it came from their notes. Add to it when \
they ask you to note, save or remember something in Jot.

Write what the user asked for, briefly and in their words: a command, a decision, a link, a few lines of \
summary. Never dump a conversation or long transcripts into a note. Do not store passwords, keys, tokens or other \
sensitive personal information unless the user explicitly asks you to.

Before creating a note, search for one on the same subject and append to it instead of making a near-duplicate.

To-dos are Markdown task lines (`- [ ] …`) in any note, with an optional reminder time; the Jot app notifies the \
user when one comes due. Add one when the user asks to be reminded of something or to put something on their \
list, list them when the user asks what they have to do, check one off when the user says it is done, and move one's reminder time (or remove it) when the user asks to reschedule it.

Notes the user locked in Jot (marked \"locked\" in listings) can be read but not changed, moved to the Trash or \
rewritten; you cannot unlock them: the user unlocks a note in Jot.";

/// What the instructions say of `trash_note` and `replace_note`, by the setting as the server starts.
const ALLOWED: &str = "\
The user allows you to remove and rewrite notes: trash_note moves a note to the macOS Trash and replace_note \
rewrites a whole note, its previous version going to the Trash; the user can get either back from the Trash. Use \
them only when the user asks you to delete or rewrite a note, and prefer append_note for adding to one. When the \
user asks to remove many notes at once (\"delete all my notes\", \"全部清掉\", \"clear out the old ones\"), first list \
the notes you would move to the Trash and ask the user to confirm, and move only those they confirm.";
const NOT_ALLOWED: &str = "\
The user has not allowed you to remove or rewrite notes: trash_note and replace_note fail until they turn on \
\"Allow AI apps to move notes to the Trash and rewrite notes\" in Jot › Settings › AI Apps. Tell the user so when \
they ask you to delete or rewrite a note; do not work around it. If they turn it on, the same rules hold: use the \
tools only when asked, and before removing many notes at once list them and ask the user to confirm.";

/// The MCP server over one notes folder.
#[derive(Debug, Clone)]
pub struct JotServer {
    store: Store,
    /// The local wall-clock time; replaced in tests.
    now: fn() -> DateTime,
    /// How long a tool waits for a note being downloaded; shortened in tests.
    download_wait: Duration,
    /// Jot's settings for AI apps (`AiSettings`): read on every call that needs them, so a change in the app
    /// applies at once. `None`: no home folder, nothing allowed.
    settings: Option<PathBuf>,
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

/// `add_todo`'s arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct AddTodoParams {
    /// What to do, short and in the user's words, such as "交周报". Leave the time out of it when you pass `due`.
    pub text: String,
    /// When to remind the user, in their local time: ISO such as "2026-11-14T09:00" (a date alone means 09:00),
    /// or a phrase in Chinese, English or Japanese, such as "明天 9点", "下週五", "tomorrow 3pm", "next friday",
    /// "in 30 min", "明日の午後3時" or "30分後". Omit it for a to-do without a time.
    #[serde(default)]
    pub due: Option<String>,
    /// The note to add it to (case-insensitive); created if missing. Defaults to the note "待办".
    #[serde(default)]
    pub note: Option<String>,
}

/// Which open to-dos `list_todos` returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TodoRange {
    /// Due before now.
    Overdue,
    /// Due today, past or not.
    Today,
    /// Due after today.
    Upcoming,
    /// Every open to-do, with or without a time.
    All,
}

/// `list_todos`' arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListTodosParams {
    /// Which open to-dos: "overdue", "today", "upcoming" or "all". Omit it for today's and overdue ones.
    #[serde(default)]
    pub range: Option<TodoRange>,
}

/// `complete_todo`'s arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CompleteTodoParams {
    /// The note the to-do is in, as list_todos showed it (case-insensitive).
    pub note: String,
    /// The to-do's text as list_todos showed it; a unique part of it is enough.
    pub text: String,
}

/// `reschedule_todo`'s arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct RescheduleTodoParams {
    /// The note the to-do is in, as list_todos showed it (case-insensitive).
    pub note: String,
    /// The to-do's text as list_todos showed it; a unique part of it is enough.
    pub text: String,
    /// The new reminder time, in the user's local time: ISO such as "2026-11-20T09:00" (a date alone means
    /// 09:00), or a phrase in Chinese, English or Japanese, such as "周五", "明天下午3点", "next monday 9am" or
    /// "来週の金曜". `null` removes the reminder.
    // Required, though it may be null: a call that leaves it out by mistake must not remove the reminder.
    #[serde(deserialize_with = "Option::deserialize")]
    #[schemars(required)]
    pub due: Option<String>,
}

/// `trash_note`'s arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct TrashParams {
    /// The note's title, as search_notes or recent_notes returned it (case-insensitive).
    pub title: String,
}

/// `replace_note`'s arguments.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReplaceParams {
    /// The existing note's title, as search_notes or recent_notes returned it (case-insensitive).
    pub title: String,
    /// The note's whole new text, in Markdown. It replaces the body; the note's frontmatter stays as it is, so do
    /// not start it with a `---` frontmatter block.
    pub body: String,
}

/// What `find_open_todo` found for a note and a text.
enum Found {
    /// The one open to-do that matches.
    Open(Todo),
    /// No open to-do matches; this checked one reads exactly so.
    Done(Todo),
}

#[tool_router]
impl JotServer {
    /// A server over `store`, on the system's local time.
    pub fn new(store: Store) -> Self {
        Self {
            store,
            now: local_now,
            download_wait: DOWNLOAD_WAIT,
            settings: AiSettings::default_path(),
            tool_router: Self::tool_router(),
        }
    }

    /// The same server reading Jot's settings for AI apps from `path` instead of the user's (for tests).
    pub fn with_settings_file(mut self, path: impl Into<PathBuf>) -> Self {
        self.settings = Some(path.into());
        self
    }

    /// The same server reading the local time from `now` instead of the system clock (for tests).
    pub fn with_clock(mut self, now: fn() -> DateTime) -> Self {
        self.now = now;
        self
    }

    /// The same server waiting at most `wait` for a note being downloaded (for tests).
    pub fn with_download_wait(mut self, wait: Duration) -> Self {
        self.download_wait = wait;
        self
    }

    #[tool(
        description = "Search the user's Jot notes by title and body. Every word of the query must match \
            (case-insensitive). Returns each note's title, when it was modified, who wrote it and a snippet \
            around the match; title matches come first, then the newest. Use this first when the user asks \
            whether they noted something (\"did I write down…\", \"what was the command I saved for…\"), or \
            before you guess at or ask for a fact about their own things that the conversation doesn't give (which \
            machine, its address or login, an account), searching for one or two distinctive words; then read_note \
            for the full text. Also use it before create_note, to find a note to append to instead.",
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
        match self.read_downloaded(&params.title).await {
            Ok(Some(note)) => {
                let mut out = format!("# {}\n{}\n", note.meta.title, describe(&note.meta));
                if let Ok(conflicts) = self.store.conflicts(&note.meta.title)
                    && !conflicts.is_empty()
                {
                    out.push_str(&format!(
                        "iCloud Drive kept {} of this note from another device, edited at the same time; \
                         the user can choose which to keep in the Jot app. This is the version on this Mac.\n",
                        if conflicts.len() == 1 { "another version".to_owned() } else { format!("{} other versions", conflicts.len()) }
                    ));
                }
                out.push('\n');
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
        description = "Create a new note in the user's Jot, marked as written by your app. Use it when the user \
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
    async fn create_note(
        &self,
        Parameters(params): Parameters<CreateParams>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        match self
            .store
            .create(&params.title, &params.body, client_source(&context))
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
        match self
            .downloaded(|| self.store.append(&params.title, &params.text))
            .await
        {
            Ok(meta) => text(format!("Appended to the note \"{}\".", meta.title)),
            Err(StoreError::NotFound) => not_found(&params.title),
            Err(error) => failure(&error, &params.title),
        }
    }

    #[tool(
        description = "Add a to-do to the user's Jot, optionally with a reminder time; the Jot app notifies the \
            user when it comes due. Use it when the user asks to be reminded of something (\"提醒我周五交周报\", \
            \"remind me to call mom at 8\") or to put something on their to-do list. Pass the task as `text` and \
            the time as `due` (ISO local time such as 2026-11-14T09:00, or a phrase in Chinese, English or Japanese \
            such as 明天 9点 / 下週五 / tomorrow 3pm / in 30 min / 明日の午後3時). The to-do goes \
            to the note \"待办\" unless the user names another note. Confirm the resolved time back to the user.",
        annotations(
            title = "Add to-do",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn add_todo(
        &self,
        Parameters(params): Parameters<AddTodoParams>,
        context: RequestContext<RoleServer>,
    ) -> CallToolResult {
        let now = (self.now)();
        let mut task = params.text.trim().to_owned();
        let due = match params
            .due
            .as_deref()
            .map(str::trim)
            .filter(|due| !due.is_empty())
        {
            Some(due) => match parse_due(due, now) {
                Some(at) => Some(at),
                None => {
                    return error(format!(
                        "Jot cannot read the time \"{due}\". Pass ISO local time such as \
                         \"{}\", or a phrase such as \"明天 9点\", \"tomorrow 3pm\" or \"30分後\".",
                        format_iso(now)
                    ));
                }
            },
            // The time may be in the text ("交房租 明天 9:00"): keep it as a reminder, not as words.
            None => when::parse(&task, now).map(|found| {
                task = without(&task, found.range);
                found.at
            }),
        };
        if task.is_empty() {
            return error("The to-do has no text: say what is to be done.".to_owned());
        }
        let note = params
            .note
            .as_deref()
            .map(str::trim)
            .filter(|note| !note.is_empty());
        let source = client_source(&context);
        match self
            .downloaded(|| self.store.add_todo(note, &task, due, source.clone()))
            .await
        {
            Ok(todo) => {
                let mut out = format!(
                    "Added the to-do \"{}\" to the note \"{}\"",
                    todo.text, todo.note
                );
                match todo.due {
                    Some(at) => {
                        out.push_str(&format!(", due {}.", format_due(at)));
                        if at < now {
                            out.push_str(" That time has already passed.");
                        }
                    }
                    None => out.push_str(" with no time."),
                }
                text(out)
            }
            Err(error) => failure(&error, note.unwrap_or(DEFAULT_TODO_NOTE)),
        }
    }

    #[tool(
        description = "List the user's open (unchecked) to-dos from every Jot note, with their due times and the \
            note each is in. Use it when the user asks what they have to do (\"我今天有什么要做的\", \"what's on my \
            list\", \"anything overdue?\"). `range`: \"overdue\" (due before now), \"today\" (due today), \
            \"upcoming\" (due after today) or \"all\" (every open to-do, also those without a time); by default \
            today's and overdue ones. The reply starts with the user's current local time.",
        annotations(title = "List to-dos", read_only_hint = true, open_world_hint = false)
    )]
    async fn list_todos(&self, Parameters(params): Parameters<ListTodosParams>) -> CallToolResult {
        let now = (self.now)();
        let todos = match self.store.todos() {
            Ok(todos) => todos,
            Err(error) => return failure(&error, ""),
        };
        let open: Vec<Todo> = todos.into_iter().filter(|todo| !todo.done).collect();
        let today = now.date();
        let wanted = |todo: &Todo| match (params.range, todo.due) {
            (Some(TodoRange::All), _) => true,
            (_, None) => false,
            (Some(TodoRange::Overdue), Some(due)) => due < now,
            (Some(TodoRange::Today), Some(due)) => due.date() == today,
            (Some(TodoRange::Upcoming), Some(due)) => due.date() > today,
            (None, Some(due)) => due < now || due.date() == today,
        };
        let (shown, rest): (Vec<&Todo>, Vec<&Todo>) = open.iter().partition(|todo| wanted(todo));
        let mut out = format!("Now: {}.\n", format_due(now));
        if shown.is_empty() {
            out.push_str(match params.range {
                None => "Nothing is overdue or due today.",
                Some(TodoRange::Overdue) => "Nothing is overdue.",
                Some(TodoRange::Today) => "Nothing is due today.",
                Some(TodoRange::Upcoming) => "Nothing is due after today.",
                Some(TodoRange::All) => "There are no open to-dos.",
            });
        } else {
            out.push_str(&format!("{}:\n", count_todos(shown.len())));
            let group = |todo: &Todo| match todo.due {
                Some(due) if due < now => 0,
                Some(due) if due.date() == today => 1,
                Some(_) => 2,
                None => 3,
            };
            for (index, heading) in ["Overdue", "Today", "Upcoming", "No time"]
                .into_iter()
                .enumerate()
            {
                let members: Vec<&&Todo> =
                    shown.iter().filter(|todo| group(todo) == index).collect();
                if members.is_empty() {
                    continue;
                }
                out.push_str(&format!("\n## {heading}\n"));
                for todo in members {
                    push_todo(&mut out, todo);
                }
            }
        }
        if !rest.is_empty() && params.range != Some(TodoRange::All) {
            let more = rest.len();
            let noun = if more == 1 { "to-do" } else { "to-dos" };
            out.push_str(&format!(
                "\n\n{more} more open {noun}; range \"all\" lists every one."
            ));
        }
        text(out)
    }

    #[tool(
        description = "Check off one of the user's Jot to-dos: only its box changes (it becomes `- [x]` with \
            today's date); nothing is deleted. Use it when the user says a to-do is done (\"交房租做完了\", \
            \"I sent the report\"). Takes the note and the to-do's text as list_todos showed them; a unique part \
            of the text is enough. Fails, listing the candidates, when no open to-do or several match: then ask \
            the user which one.",
        annotations(
            title = "Complete to-do",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn complete_todo(
        &self,
        Parameters(params): Parameters<CompleteTodoParams>,
    ) -> CallToolResult {
        let todo = match self
            .find_open_todo(&params.note, &params.text, "check off")
            .await
        {
            Ok(Found::Open(todo)) => todo,
            Ok(Found::Done(done)) => {
                return text(format!(
                    "\"{}\" in the note \"{}\" is already checked off{}.",
                    done.text,
                    done.note,
                    done.done_on
                        .map(|day| format!(" ({})", format_day(day)))
                        .unwrap_or_default()
                ));
            }
            Err(result) => return result,
        };
        let today = (self.now)().date();
        match self
            .downloaded(|| {
                self.store
                    .set_todo_done(&todo.note, todo.line, &todo.text, true, today)
            })
            .await
        {
            Ok(_) => text(format!(
                "Checked off \"{}\" in the note \"{}\".",
                todo.text, todo.note
            )),
            Err(StoreError::Changed) => error(format!(
                "The note \"{}\" changed while Jot was checking off the to-do. Call complete_todo again.",
                todo.note
            )),
            Err(error) => failure(&error, &todo.note),
        }
    }

    #[tool(
        description = "Move the reminder time of one of the user's open Jot to-dos, or remove it: only the \
            to-do's `⏰` time changes; its text stays. Use it when the user asks to reschedule a to-do \
            (\"把交房租改到周五\", \"push the dentist to next monday 9am\", \"不用提醒我交周报了\"). Takes the \
            note and the to-do's text as list_todos showed them (a unique part of the text is enough) and `due`: \
            ISO local time such as 2026-11-20T09:00, or a phrase in Chinese, English or Japanese \
            such as 周五 / 明天下午3点 / next monday 9am / 来週の金曜; `null` removes the reminder. Fails, \
            listing the candidates, when no open to-do or several match: then ask the user which one. Confirm \
            the resolved time back to the user.",
        annotations(
            title = "Reschedule to-do",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn reschedule_todo(
        &self,
        Parameters(params): Parameters<RescheduleTodoParams>,
    ) -> CallToolResult {
        let now = (self.now)();
        let due = match params.due.as_deref().map(str::trim) {
            None => None,
            Some("") => {
                return error(
                    "`due` is empty: pass the new time, or null to remove the reminder.".to_owned(),
                );
            }
            Some(due) => match parse_due(due, now) {
                Some(at) => Some(at),
                None => {
                    return error(format!(
                        "Jot cannot read the time \"{due}\". Pass ISO local time such as \
                         \"{}\", or a phrase such as \"周五 9点\", \"next monday 9am\" or \"来週の金曜\"; \
                         null removes the reminder.",
                        format_iso(now)
                    ));
                }
            },
        };
        let todo = match self
            .find_open_todo(&params.note, &params.text, "reschedule")
            .await
        {
            Ok(Found::Open(todo)) => todo,
            Ok(Found::Done(done)) => {
                return error(format!(
                    "\"{}\" in the note \"{}\" is already checked off: it has nothing to remind of.",
                    done.text, done.note
                ));
            }
            Err(result) => return result,
        };
        if todo.due == due {
            return text(match due {
                Some(at) => format!(
                    "\"{}\" in the note \"{}\" is already due {}.",
                    todo.text,
                    todo.note,
                    format_due(at)
                ),
                None => format!(
                    "\"{}\" in the note \"{}\" has no reminder.",
                    todo.text, todo.note
                ),
            });
        }
        match self
            .downloaded(|| {
                self.store
                    .set_todo_due(&todo.note, todo.line, &todo.text, due)
            })
            .await
        {
            Ok(_) => {
                let was = todo
                    .due
                    .map(|at| format!(" (it was due {})", format_due(at)))
                    .unwrap_or_default();
                let mut out = match due {
                    Some(at) => format!(
                        "\"{}\" in the note \"{}\" is now due {}{was}.",
                        todo.text,
                        todo.note,
                        format_due(at)
                    ),
                    None => format!(
                        "Removed the reminder of \"{}\" in the note \"{}\"{was}.",
                        todo.text, todo.note
                    ),
                };
                if due.is_some_and(|at| at < now) {
                    out.push_str(" That time has already passed.");
                }
                text(out)
            }
            Err(StoreError::Changed) => error(format!(
                "The note \"{}\" changed while Jot was rescheduling the to-do. Call reschedule_todo again.",
                todo.note
            )),
            Err(error) => failure(&error, &todo.note),
        }
    }

    #[tool(
        description = "Move one of the user's Jot notes to the macOS Trash. It is not deleted for good: the user \
            can get it back from the Trash. Use it only when the user asks to delete or \
            remove that note. When they ask to remove many notes at once, first list the notes you would move and \
            ask the user to confirm. Takes the title as search_notes or recent_notes returned it. Works only while \
            the user allows it in Jot › Settings › AI Apps, and never on a note the user locked in Jot.",
        annotations(
            title = "Move note to Trash",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn trash_note(&self, Parameters(params): Parameters<TrashParams>) -> CallToolResult {
        if !self.ai_settings().allow_trash_and_rewrite {
            return not_allowed("move notes to the Trash");
        }
        match self.downloaded(|| self.store.trash(&params.title)).await {
            Ok(trashed) => text(format!(
                "Moved the note \"{}\" to the Trash. The user can put it back from the Trash.",
                trashed.title
            )),
            Err(error) => failure(&error, &params.title),
        }
    }

    #[tool(
        description = "Rewrite the whole text of one of the user's existing Jot notes: `body` replaces what the \
            note says. Its previous version goes to the macOS Trash first, named \"<title> (before rewrite · \
            <date> <time>)\" (in the language Jot shows), where the user can get it back. The note's frontmatter \
            (who wrote it, …) stays as it is; `body` must not start with a `---` frontmatter block. Use it only \
            when the user asks you to rewrite, reorganize or clean up a note as a whole; to add to a note use \
            append_note, to change a to-do use complete_todo or reschedule_todo. Read the note first. Works only \
            while the user allows it in Jot › Settings › AI Apps, and never on a note the user locked in Jot.",
        annotations(
            title = "Rewrite note",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn replace_note(&self, Parameters(params): Parameters<ReplaceParams>) -> CallToolResult {
        let settings = self.ai_settings();
        if !settings.allow_trash_and_rewrite {
            return not_allowed("rewrite notes");
        }
        if params.body.trim().is_empty() {
            return error(
                "The new text is empty. To remove a note, use trash_note; to rewrite it, pass its whole new \
                 text."
                    .to_owned(),
            );
        }
        if starts_with_frontmatter(&params.body) {
            return error(
                "`body` starts with a `---` frontmatter block. Jot keeps the note's frontmatter as it is: pass \
                 only the text after it (start the body with something other than a `---` block)."
                    .to_owned(),
            );
        }
        let lang = when::Lang::from_locale(settings.language.as_deref().unwrap_or("en"));
        let at = (self.now)();
        match self
            .downloaded(|| {
                self.store.replace(&params.title, &params.body, |title| {
                    previous_title(title, lang, at)
                })
            })
            .await
        {
            Ok(replaced) => match replaced.previous {
                Some(previous) => text(format!(
                    "Rewrote the note \"{}\". Its previous version is in the Trash as \"{}.md\"; the user can \
                     put it back from there.",
                    replaced.note.title, previous.title
                )),
                None => text(format!(
                    "The note \"{}\" already reads exactly so; nothing changed.",
                    replaced.note.title
                )),
            },
            Err(error) => failure(&error, &params.title),
        }
    }
}

impl JotServer {
    /// Jot's settings for AI apps as the file says now.
    fn ai_settings(&self) -> AiSettings {
        self.settings
            .as_deref()
            .map(AiSettings::read)
            .unwrap_or_default()
    }

    /// Runs `op` again while the note it needs is being downloaded (`NotDownloaded`), for `download_wait` at most.
    async fn downloaded<T>(
        &self,
        mut op: impl FnMut() -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let deadline = Instant::now() + self.download_wait;
        loop {
            match op() {
                Err(StoreError::NotDownloaded) if Instant::now() < deadline => {
                    tokio::time::sleep(DOWNLOAD_POLL).await;
                }
                result => return result,
            }
        }
    }

    /// The note titled `title`, waiting for it while it is being downloaded; `NotDownloaded` when it is still not
    /// here.
    async fn read_downloaded(&self, title: &str) -> Result<Option<jot_store::Note>, StoreError> {
        self.downloaded(|| match self.store.read(title) {
            Ok(Some(note)) if note.meta.downloading => Err(StoreError::NotDownloaded),
            result => result,
        })
        .await
    }

    /// The open to-do of `note` that `wanted` names: the one whose text it is, else the one whose text holds it
    /// (case-insensitive). When none is open, a checked one that reads exactly so; else the error to return,
    /// listing the candidates (`verb` says what the caller does, for the message).
    // The error is the tool's reply, handed back as is on a rare path: boxing it buys nothing.
    #[allow(clippy::result_large_err)]
    async fn find_open_todo(
        &self,
        note: &str,
        wanted: &str,
        verb: &str,
    ) -> Result<Found, CallToolResult> {
        let wanted = wanted.trim();
        if wanted.is_empty() {
            return Err(error(
                "Say which to-do: pass its text as list_todos showed it.".to_owned(),
            ));
        }
        // Its to-dos are read from its text: the note has to be here.
        let meta = match self.read_downloaded(note).await {
            Ok(Some(found)) => found.meta,
            Ok(None) => {
                return Err(error(format!(
                    "No note is titled \"{}\". Use list_todos to see which note each to-do is in.",
                    note.trim()
                )));
            }
            Err(error) => return Err(failure(&error, note)),
        };
        let todos: Vec<Todo> = match self.store.todos() {
            Ok(todos) => todos
                .into_iter()
                .filter(|todo| todo.note == meta.title)
                .collect(),
            Err(error) => return Err(failure(&error, note)),
        };
        let open: Vec<&Todo> = todos.iter().filter(|todo| !todo.done).collect();
        let exact: Vec<&Todo> = open
            .iter()
            .copied()
            .filter(|todo| todo.text == wanted)
            .collect();
        let candidates = if exact.is_empty() {
            let lowered = wanted.to_lowercase();
            open.iter()
                .copied()
                .filter(|todo| todo.text.to_lowercase().contains(&lowered))
                .collect()
        } else {
            exact
        };
        match candidates.as_slice() {
            [todo] => Ok(Found::Open((*todo).clone())),
            [] => {
                if let Some(done) = todos.iter().find(|todo| todo.done && todo.text == wanted) {
                    return Ok(Found::Done(done.clone()));
                }
                let mut out = format!(
                    "No open to-do in the note \"{}\" matches \"{wanted}\".",
                    meta.title
                );
                if open.is_empty() {
                    out.push_str(" It has no open to-dos.");
                } else {
                    out.push_str(" Its open to-dos:\n");
                    for todo in &open {
                        push_todo(&mut out, todo);
                    }
                }
                Err(error(out))
            }
            several => {
                let mut out = format!(
                    "{} in the note \"{}\" match \"{wanted}\"; pass the full text of the one to {verb}, or ask \
                     the user which one:\n",
                    count_todos(several.len()),
                    meta.title
                );
                for todo in several {
                    push_todo(&mut out, todo);
                }
                if several.iter().all(|todo| todo.text == several[0].text) {
                    out.push_str(&format!(
                        "They read the same: the user can {verb} the right one in the Jot app."
                    ));
                }
                Err(error(out))
            }
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for JotServer {
    fn get_info(&self) -> ServerConfig {
        // The tools stay listed whatever the setting (a client may not follow a changing list); the instructions
        // say how it stands as the app connects, and each call checks it again.
        let removing = if self.ai_settings().allow_trash_and_rewrite {
            ALLOWED
        } else {
            NOT_ALLOWED
        };
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("jot", env!("CARGO_PKG_VERSION")))
            .with_instructions(format!("{INSTRUCTIONS}\n\n{removing}"))
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

/// Who is writing: the app on the other end, by the name it gave in `initialize` (`clientInfo.name`).
fn client_source(context: &RequestContext<RoleServer>) -> Source {
    let name = context
        .peer
        .peer_info()
        .map(|info| info.client_info.name.clone());
    Source::from_client(name.as_deref().unwrap_or(""))
}

fn describe(meta: &NoteMeta) -> String {
    if meta.downloading {
        // Who wrote it is in its text, which is not here yet.
        return format!(
            "Modified {} · not downloaded to this Mac yet (iCloud Drive is downloading it; only its title was \
             searched)",
            format_time(meta.modified)
        );
    }
    let author = meta.source.label().unwrap_or_else(|| "the user".to_owned());
    let locked = if meta.locked {
        " · locked in Jot (read-only)"
    } else {
        ""
    };
    format!(
        "Modified {} · written by {author}{locked}",
        format_time(meta.modified)
    )
}

/// The name a note's previous version takes in the trash: `Plan (before rewrite · 2026-11-25 14.30)` in the language
/// Jot shows (no colon, which Finder shows as a slash), the title shortened when the name would be too long for a
/// file.
fn previous_title(title: &str, lang: when::Lang, at: DateTime) -> String {
    let time = at.strftime("%Y-%m-%d %H.%M");
    let suffix = match lang {
        when::Lang::ZhHans => format!("（改写前 · {time}）"),
        when::Lang::ZhHant => format!("（改寫前 · {time}）"),
        when::Lang::Ja => format!("（書き換え前 · {time}）"),
        _ => format!(" (before rewrite · {time})"),
    };
    // 255 bytes for the name, `.md` included.
    let room = 255 - ".md".len() - suffix.len();
    let mut kept = title;
    while kept.len() > room {
        let mut cut = kept.len() - 1;
        while !kept.is_char_boundary(cut) {
            cut -= 1;
        }
        kept = &kept[..cut];
    }
    format!("{}{suffix}", kept.trim_end())
}

/// Whether `body` starts with a frontmatter block (`---` lines) that would become the note's frontmatter.
fn starts_with_frontmatter(body: &str) -> bool {
    let mut lines = body.split_inclusive('\n');
    let Some(first) = lines.next() else {
        return false;
    };
    first.trim_end_matches(['\n', '\r']) == "---"
        && first.ends_with('\n')
        && lines.any(|line| line.trim_end_matches(['\n', '\r']) == "---")
}

/// The setting is off: what to tell the app.
fn not_allowed(doing: &str) -> CallToolResult {
    error(format!(
        "Jot's settings do not allow AI apps to {doing}; nothing was changed. The user can allow it in Jot › \
         Settings › AI Apps (\"Allow AI apps to move notes to the Trash and rewrite notes\"). Tell the user; do \
         not try another way."
    ))
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

/// The system's local wall-clock time.
fn local_now() -> DateTime {
    jiff::ZonedDateTime::now().datetime()
}

/// A tool's `due`: ISO local time (`2026-11-14T09:00`, `2026-11-14 09:00`), an instant with an offset (shown
/// in local time), a date alone (09:00), or a phrase `when::parse` reads.
fn parse_due(due: &str, now: DateTime) -> Option<DateTime> {
    // A date alone would parse as a midnight `DateTime`.
    if !due.contains(['T', 't', ' ', ':'])
        && let Ok(day) = due.parse::<Date>()
    {
        return Some(day.at(9, 0, 0, 0));
    }
    if let Ok(instant) = due.parse::<jiff::Timestamp>() {
        return Some(
            instant
                .to_zoned_datetime(jiff::tz::TimeZone::system())
                .datetime(),
        );
    }
    if let Ok(at) = due.parse::<DateTime>() {
        return Some(at);
    }
    when::parse(due, now).map(|found| found.at)
}

/// `text` without the bytes in `range`, the words on either side kept apart by one space when the phrase had
/// spaces next to it.
fn without(text: &str, range: std::ops::Range<usize>) -> String {
    let before = &text[..range.start];
    let after = &text[range.end..];
    let (trimmed_before, trimmed_after) = (before.trim_end(), after.trim_start());
    let mut out = trimmed_before.to_owned();
    if !trimmed_before.is_empty()
        && !trimmed_after.is_empty()
        && (trimmed_before.len() < before.len() || trimmed_after.len() < after.len())
    {
        out.push(' ');
    }
    out.push_str(trimmed_after);
    out.trim().to_owned()
}

/// `Sat 2026-11-14 09:00`: the weekday helps the model say "Saturday".
fn format_due(at: DateTime) -> String {
    at.strftime("%a %Y-%m-%d %H:%M").to_string()
}

fn format_day(day: Date) -> String {
    day.strftime("%a %Y-%m-%d").to_string()
}

fn format_iso(at: DateTime) -> String {
    at.strftime("%Y-%m-%dT%H:%M").to_string()
}

fn count_todos(todos: usize) -> String {
    if todos == 1 {
        "1 to-do".to_owned()
    } else {
        format!("{todos} to-dos")
    }
}

fn push_todo(out: &mut String, todo: &Todo) {
    out.push_str(&format!("- {}", todo.text));
    if let Some(due) = todo.due {
        out.push_str(&format!(" · due {}", format_due(due)));
    }
    out.push_str(&format!(" · note \"{}\"\n", todo.note));
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
        StoreError::Changed => error(format!(
            "The note \"{}\" changed while Jot was updating it. Try again.",
            title.trim()
        )),
        StoreError::NotDownloaded => error(format!(
            "The note \"{}\" is in iCloud Drive and not downloaded to this Mac yet; it is downloading now. Try \
             again in a moment.",
            title.trim()
        )),
        StoreError::Locked => error(format!(
            "The note \"{}\" is locked in Jot, so it cannot be changed, moved to the Trash or rewritten; nothing \
             was changed. To change it, the user unlocks it in Jot first (no tool can unlock it).",
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
    fn due_times() {
        let now = jiff::civil::date(2026, 11, 13).at(10, 30, 0, 0);
        let at = |d: i8, h: i8, m: i8| jiff::civil::date(2026, 11, d).at(h, m, 0, 0);
        for (due, expected) in [
            ("2026-11-14T09:00", Some(at(14, 9, 0))),
            ("2026-11-14T09:00:00", Some(at(14, 9, 0))),
            ("2026-11-14 18:30", Some(at(14, 18, 30))),
            ("2026-11-14", Some(at(14, 9, 0))),
            ("明天 9点", Some(at(14, 9, 0))),
            ("半小时后", Some(at(13, 11, 0))),
            ("someday", None),
            ("2026-13-01", None),
        ] {
            assert_eq!(parse_due(due, now), expected, "{due:?}");
        }
        // An instant with an offset is shown in local time: whatever the zone, it parses.
        assert!(parse_due("2026-11-14T01:00:00Z", now).is_some());
    }

    #[test]
    fn phrases_leave_the_text() {
        assert_eq!(without("交房租 明天 9:00", 10..21), "交房租");
        assert_eq!(without("明天交房租", 0..6), "交房租");
        assert_eq!(without("交 明天 房租", 4..10), "交 房租");
    }

    #[test]
    fn previous_versions_are_named_in_the_language_shown() {
        let at = jiff::civil::date(2026, 11, 25).at(14, 30, 0, 0);
        assert_eq!(
            previous_title("Plan", when::Lang::En, at),
            "Plan (before rewrite · 2026-11-25 14.30)"
        );
        assert_eq!(
            previous_title("计划", when::Lang::ZhHans, at),
            "计划（改写前 · 2026-11-25 14.30）"
        );
        assert_eq!(
            previous_title("計劃", when::Lang::ZhHant, at),
            "計劃（改寫前 · 2026-11-25 14.30）"
        );
        assert_eq!(
            previous_title("計画", when::Lang::Ja, at),
            "計画（書き換え前 · 2026-11-25 14.30）"
        );
        // A long title is shortened (at a character) so the name fits a file name.
        let long = "长".repeat(100);
        let name = previous_title(&long, when::Lang::ZhHans, at);
        assert!(name.len() + 3 <= 255, "{}", name.len());
        assert!(name.ends_with("（改写前 · 2026-11-25 14.30）"));
        assert!(!name.contains(':'));
    }

    #[test]
    fn frontmatter_in_a_body() {
        assert!(starts_with_frontmatter("---\nlocked: false\n---\ntext"));
        assert!(starts_with_frontmatter("---\r\nsource: x\r\n---\r\n"));
        assert!(!starts_with_frontmatter("text\n---\nmore\n---\n"));
        assert!(!starts_with_frontmatter(
            "---\nA rule, then text with no closing line"
        ));
        assert!(!starts_with_frontmatter("---"));
        assert!(!starts_with_frontmatter(""));
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
