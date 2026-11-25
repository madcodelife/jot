//! `Connections`: the settings' AI page. Which AI apps are installed, whether Jot is connected to each, and
//! connecting, disconnecting and following the notes folder ([`crate::connect`] does the work, off the engine
//! thread: it reads files and runs `claude`).

use nsh_core::prelude::*;

use crate::connect::{self, Env, Manual, Registered, Status};
use crate::notes::expand_home;

/// The AI apps Jot registers its MCP server with.
#[module]
pub struct Connections;

#[module]
impl Connections {
    /// `jot-mcp`'s absolute path: beside the app's executable in the packaged app, in this checkout's
    /// `target/{debug,release}` while developing. `null` when it is not found (`cargo build -p jot-mcp`).
    pub fn server() -> Option<String> {
        Env::system().server.map(|path| path.display().to_string())
    }

    /// Whether Jot runs from where macOS moved it to open it (App Translocation, for an app opened from
    /// Downloads): a temporary path no app may keep, so nothing is connected until Jot is in Applications.
    pub fn translocated() -> bool {
        Env::system().translocated()
    }

    /// Every app Jot knows, with its state for the notes folder `dir` (a leading `~/` is the home folder).
    pub async fn clients(dir: String) -> Result<Vec<AiClient>, String> {
        off_thread(move || {
            let env = Env::system();
            let dir = expand_home(&dir);
            Ok(connect::statuses(&env, &dir)
                .into_iter()
                .map(|s| AiClient::from((s, None)))
                .collect())
        })
        .await
    }

    /// Registers Jot for `dir` with the app `id` (replacing an older registration). Rejects with why when Jot
    /// cannot (`jot-mcp` not found, a file it will not rewrite, `claude` failing).
    pub async fn connect(id: String, dir: String) -> Result<AiClient, String> {
        off_thread(move || {
            let client = connect::client(&id).ok_or_else(|| format!("no app {id:?}"))?;
            connect::connect(&Env::system(), client, &expand_home(&dir))
                .map(|status| AiClient::from((status, None)))
                .map_err(|error| error.to_string())
        })
        .await
    }

    /// Takes Jot out of the app `id`'s configuration; the state returned is for `dir`.
    pub async fn disconnect(id: String, dir: String) -> Result<AiClient, String> {
        off_thread(move || {
            let client = connect::client(&id).ok_or_else(|| format!("no app {id:?}"))?;
            connect::disconnect(&Env::system(), client, &expand_home(&dir))
                .map(|status| AiClient::from((status, None)))
                .map_err(|error| error.to_string())
        })
        .await
    }

    /// The notes folder is now `dir`: registers it again with every app connected to another folder that Jot
    /// can write. Each app's state after, an `error` on those it could not update; one Jot cannot write comes
    /// back connected elsewhere (`current: false`), its `manual` saying why.
    pub async fn sync(dir: String) -> Result<Vec<AiClient>, String> {
        off_thread(move || {
            let env = Env::system();
            Ok(connect::sync(&env, &expand_home(&dir))
                .into_iter()
                .map(|(status, error)| AiClient::from((status, error.map(|e| e.to_string()))))
                .collect())
        })
        .await
    }

    /// The setup for any other MCP app, for `dir`: the command line that starts Jot's server, and the
    /// `mcpServers` JSON most apps take.
    pub fn generic(dir: String) -> GenericSetup {
        let (command, json) = connect::generic(&Env::system(), &expand_home(&dir));
        GenericSetup { command, json }
    }
}

/// `f` on a blocking thread of the runtime, its result awaited.
async fn off_thread<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    blocking(f).await.map_err(|error| error.to_string())?
}

/// An AI app and Jot's place in it.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct AiClient {
    /// What `connect` and `disconnect` take: `"claude-code"`, `"claude-desktop"`, `"cursor"`, `"vscode"`,
    /// `"windsurf"`, `"codex"`, `"gemini"`, `"zed"`.
    pub id: String,
    /// Its name: "Claude Code", "Claude", "Cursor", …
    pub name: String,
    /// Found on this Mac (its app or its settings folder).
    pub installed: bool,
    /// Its configuration has Jot.
    pub connected: bool,
    /// Connected to this folder with this `jot-mcp`; `false` when it points elsewhere (`sync` updates it).
    pub current: bool,
    /// Why Jot cannot connect or disconnect it itself; `null` when it can.
    pub manual: Option<ManualReason>,
    /// Its configuration file, shown (`~/.cursor/mcp.json`).
    pub config: String,
    /// What connects it by hand: the command to run (Claude Code), else what its file takes.
    pub snippet: String,
    /// What went wrong updating it (`sync`).
    pub error: Option<String>,
}

/// Why an app is set up by hand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PropEnum)]
pub enum ManualReason {
    /// Claude Code's `claude` was not found where its installers put it.
    #[prop(rename = "no-cli")]
    NoCli,
    /// Its configuration does not parse (comments, a mistake): Jot leaves it alone.
    Unreadable,
    /// Its settings are JSON with comments by design (Zed).
    Unsupported,
}

impl From<(Status, Option<String>)> for AiClient {
    fn from((status, error): (Status, Option<String>)) -> Self {
        AiClient {
            id: status.client.id.to_owned(),
            name: status.client.name.to_owned(),
            installed: status.installed,
            connected: matches!(status.registered, Registered::Yes(_)),
            current: status.current,
            manual: status.manual.map(|manual| match manual {
                Manual::NoCli => ManualReason::NoCli,
                Manual::Unreadable => ManualReason::Unreadable,
                Manual::Unsupported => ManualReason::Unsupported,
            }),
            config: status.config,
            snippet: status.snippet,
            error,
        }
    }
}

/// The setup for any MCP app.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct GenericSetup {
    /// `jot-mcp --dir <folder>`, quoted for a shell.
    pub command: String,
    /// `{ "mcpServers": { "jot": { "command", "args" } } }`.
    pub json: String,
}
