//! Connecting AI apps to Jot: registering `jot-mcp` as an MCP server named `jot` in each app's own configuration.
//!
//! One table, [`CLIENTS`], says for each app how to tell it is installed, where its configuration lives and in
//! which form; adding an app is adding a row. Claude Code is registered through its own CLI (`claude mcp
//! add/remove --scope user`); the others by editing their file, JSON or TOML.
//!
//! Every edit changes the `jot` entry only; the rest of the file keeps its data. A TOML file keeps its layout and
//! comments too. A JSON file is written out again: its keys keep their order, the file its indentation, line
//! endings (CRLF) and final newline, but not the rest of its formatting (a one-line array is spread over lines,
//! `1.50` becomes `1.5`). A file that does not parse (JSON with comments, say) is never written: the app is then
//! set up by hand, from the snippet Jot shows. Before Jot's first change to a file, the file is copied beside it
//! (`<name>.jot.bak`, the version without Jot, kept from then on); the new one replaces it atomically (a temporary
//! file in the same folder, renamed over it; a hard link to the old file keeps the old content).
//!
//! One change at a time in the process ([`exclusive`]): a sync and a click on the same file never interleave.
//!
//! Everything here reads and writes under [`Env::home`], so tests run on a temporary home.

use std::fs;
use std::io::{self, Read as _, Write as _};
use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError, mpsc};
use std::time::{Duration, Instant};

use serde_json::{Map, Value};

/// The server's name in every app's configuration.
pub(crate) const SERVER_NAME: &str = "jot";
/// What a snippet shows for `jot-mcp` while Jot has not found it.
pub(crate) const SERVER_PLACEHOLDER: &str = "/path/to/jot-mcp";
/// How long `claude mcp …` may take.
const CLI_TIMEOUT: Duration = Duration::from_secs(30);

/// Where an app keeps its MCP servers, and in which form.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// Claude Code: written with its CLI (`claude mcp add/remove --scope user`), read from `~/.claude.json`'s
    /// `mcpServers`.
    ClaudeCli,
    /// A JSON file whose `key` object holds the servers by name, each `{ "command", "args" }`, with
    /// `"type": "stdio"` when `stdio_type`. `writable: false` for files that are JSON with comments by design
    /// (Zed's settings): Jot reads them, never writes them.
    Json {
        key: &'static str,
        stdio_type: bool,
        writable: bool,
    },
    /// A TOML file whose `[<table>.<name>]` tables hold the servers, `command` and `args` (Codex). Edited
    /// keeping its comments and layout.
    Toml { table: &'static str },
}

/// An app Jot can connect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Client {
    /// Its id (`claude-desktop`), what TS passes back.
    pub id: &'static str,
    /// Its name as people know it.
    pub name: &'static str,
    /// Paths under the home folder, any of which says the app is installed.
    pub markers: &'static [&'static str],
    /// App bundles in the Applications folders, any of which says the same.
    pub bundles: &'static [&'static str],
    /// Its configuration file, under the home folder.
    pub config: &'static str,
    pub kind: Kind,
}

/// The apps Jot connects, macOS paths (checked against each app's documentation, 2026-11).
pub(crate) const CLIENTS: &[Client] = &[
    Client {
        id: "claude-code",
        name: "Claude Code",
        markers: &[".claude.json", ".claude"],
        bundles: &[],
        config: ".claude.json",
        kind: Kind::ClaudeCli,
    },
    Client {
        id: "claude-desktop",
        name: "Claude",
        markers: &["Library/Application Support/Claude"],
        bundles: &["Claude.app"],
        config: "Library/Application Support/Claude/claude_desktop_config.json",
        kind: Kind::Json {
            key: "mcpServers",
            stdio_type: false,
            writable: true,
        },
    },
    Client {
        id: "cursor",
        name: "Cursor",
        markers: &[".cursor"],
        bundles: &["Cursor.app"],
        config: ".cursor/mcp.json",
        kind: Kind::Json {
            key: "mcpServers",
            stdio_type: false,
            writable: true,
        },
    },
    Client {
        id: "vscode",
        name: "VS Code",
        markers: &["Library/Application Support/Code/User"],
        bundles: &["Visual Studio Code.app"],
        config: "Library/Application Support/Code/User/mcp.json",
        kind: Kind::Json {
            key: "servers",
            stdio_type: true,
            writable: true,
        },
    },
    Client {
        id: "windsurf",
        name: "Windsurf",
        markers: &[".codeium/windsurf"],
        bundles: &["Windsurf.app"],
        config: ".codeium/windsurf/mcp_config.json",
        kind: Kind::Json {
            key: "mcpServers",
            stdio_type: false,
            writable: true,
        },
    },
    Client {
        id: "codex",
        name: "Codex",
        markers: &[".codex"],
        bundles: &[],
        config: ".codex/config.toml",
        kind: Kind::Toml {
            table: "mcp_servers",
        },
    },
    Client {
        id: "gemini",
        name: "Gemini CLI",
        markers: &[".gemini"],
        bundles: &[],
        config: ".gemini/settings.json",
        kind: Kind::Json {
            key: "mcpServers",
            stdio_type: false,
            writable: true,
        },
    },
    Client {
        id: "zed",
        name: "Zed",
        markers: &[".config/zed"],
        bundles: &["Zed.app"],
        config: ".config/zed/settings.json",
        kind: Kind::Json {
            key: "context_servers",
            stdio_type: false,
            writable: false,
        },
    },
];

/// The client with `id`.
pub(crate) fn client(id: &str) -> Option<&'static Client> {
    CLIENTS.iter().find(|client| client.id == id)
}

/// What the connections read and run: the real machine's in the app, a temporary one in tests.
#[derive(Debug, Clone)]
pub(crate) struct Env {
    /// The user's home folder: every configuration is under it.
    pub home: PathBuf,
    /// The folders apps are installed in (`/Applications`, `~/Applications`).
    pub applications: Vec<PathBuf>,
    /// Where `claude` may be, first found first: a GUI app has no shell's `PATH`.
    pub claude: Vec<PathBuf>,
    /// `jot-mcp`, when found.
    pub server: Option<PathBuf>,
}

impl Env {
    /// This Mac's: `$HOME`, the Applications folders, the places Claude Code's installers put `claude`, and
    /// `jot-mcp` ([`find_server`]).
    pub(crate) fn system() -> Env {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(std::env::home_dir)
            .unwrap_or_else(|| PathBuf::from("/"));
        Env {
            applications: vec![PathBuf::from("/Applications"), home.join("Applications")],
            claude: claude_candidates(&home),
            server: find_server(std::env::current_exe().ok().as_deref(), &dev_target_dirs()),
            home,
        }
    }

    fn path(&self, under_home: &str) -> PathBuf {
        self.home.join(under_home)
    }

    /// `path` as people read it: under the home folder as `~/…`.
    pub(crate) fn shown(&self, path: &Path) -> String {
        match path.strip_prefix(&self.home) {
            Ok(rest) => format!("~/{}", rest.display()),
            Err(_) => path.display().to_string(),
        }
    }

    /// The `claude` to run: the first candidate that is an executable file.
    pub(crate) fn claude_cli(&self) -> Option<PathBuf> {
        self.claude.iter().find(|path| is_executable(path)).cloned()
    }

    /// Whether Jot runs from where macOS moved it (App Translocation: an app opened from Downloads with its
    /// quarantine): a random read-only path, gone once Jot quits, that no app's configuration may keep.
    pub(crate) fn translocated(&self) -> bool {
        self.server.as_deref().is_some_and(is_translocated)
    }
}

/// Whether `path` is under App Translocation's random mount.
pub(crate) fn is_translocated(path: &Path) -> bool {
    path.to_string_lossy().contains("/AppTranslocation/")
}

/// Where Claude Code's installers put `claude`: the native installer's (`~/.local/bin`), the old local install's,
/// Homebrew's, npm's global folders and Bun's.
pub(crate) fn claude_candidates(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local/bin/claude"),
        home.join(".claude/local/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
        home.join(".npm-global/bin/claude"),
        home.join(".bun/bin/claude"),
    ]
}

/// `jot-mcp`: beside the running executable (the packaged app has it in `Contents/MacOS`; `nsh run` runs from
/// the app's `target/debug`), else in a build folder of this checkout (`target/release`, then `target/debug`:
/// `cargo build -p jot-mcp` while developing).
pub(crate) fn find_server(exe: Option<&Path>, targets: &[PathBuf]) -> Option<PathBuf> {
    let beside = exe.and_then(Path::parent).map(|dir| dir.join("jot-mcp"));
    beside
        .into_iter()
        .chain(
            targets
                .iter()
                .flat_map(|target| [target.join("release/jot-mcp"), target.join("debug/jot-mcp")]),
        )
        .find(|path| is_executable(path))
}

/// The build folders of the checkout a development build was built from: `CARGO_TARGET_DIR` when it was set, and
/// `target/`. None in a release build, which finds `jot-mcp` beside it or not at all.
#[cfg(debug_assertions)]
fn dev_target_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = option_env!("CARGO_TARGET_DIR") {
        dirs.push(PathBuf::from(dir));
    }
    dirs.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("target"));
    dirs
}

#[cfg(not(debug_assertions))]
fn dev_target_dirs() -> Vec<PathBuf> {
    Vec::new()
}

fn is_executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

/// How Jot is started for a notes folder: `jot-mcp --dir <folder>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Launch {
    pub command: String,
    pub args: Vec<String>,
}

impl Launch {
    /// `jot-mcp` (its placeholder while it is not found) for `dir`, an absolute folder.
    pub(crate) fn new(server: Option<&Path>, dir: &Path) -> Launch {
        Launch {
            command: server.map_or_else(
                || SERVER_PLACEHOLDER.to_owned(),
                |path| path.display().to_string(),
            ),
            args: vec!["--dir".to_owned(), dir.display().to_string()],
        }
    }

    /// One line for a terminal: the words quoted as a POSIX shell needs.
    pub(crate) fn command_line(&self) -> String {
        std::iter::once(&self.command)
            .chain(&self.args)
            .map(|word| shell_word(word))
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// The server's entry in an app's JSON: `{ "command", "args" }`, after `"type": "stdio"` when asked.
    fn json(&self, stdio_type: bool) -> Value {
        let mut entry = Map::new();
        if stdio_type {
            entry.insert("type".into(), "stdio".into());
        }
        entry.insert("command".into(), self.command.clone().into());
        entry.insert("args".into(), self.args.clone().into());
        Value::Object(entry)
    }
}

/// `word` as a POSIX shell word: as it is when plain, else in single quotes.
pub(crate) fn shell_word(word: &str) -> String {
    let plain = !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "@%+=:,./-_~".contains(c));
    if plain && !word.starts_with('~') {
        word.to_owned()
    } else {
        format!("'{}'", word.replace('\'', r"'\''"))
    }
}

/// What the app's configuration says of Jot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Registered {
    /// Nothing (or no file).
    No,
    /// An entry named `jot`, started this way (`command` empty when the entry has none Jot can read).
    Yes(Launch),
    /// The file is there but Jot cannot read it.
    Unreadable,
}

/// Why Jot cannot connect or disconnect an app itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Manual {
    /// Claude Code without its CLI where Jot looks.
    NoCli,
    /// The configuration does not parse (comments, a syntax error): Jot will not rewrite it.
    Unreadable,
    /// The app's settings are JSON with comments by design (Zed): set up by hand.
    Unsupported,
}

/// An app's state for a notes folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Status {
    pub client: &'static Client,
    pub installed: bool,
    pub registered: Registered,
    /// Connected to this folder with this `jot-mcp`.
    pub current: bool,
    /// Why Jot cannot do it itself; `None` when it can.
    pub manual: Option<Manual>,
    /// The configuration file, shown (`~/.cursor/mcp.json`).
    pub config: String,
    /// What to run (Claude Code) or put in the file (the others) to connect by hand.
    pub snippet: String,
}

/// Every app's state for `dir`.
pub(crate) fn statuses(env: &Env, dir: &Path) -> Vec<Status> {
    CLIENTS
        .iter()
        .map(|client| status(env, client, dir))
        .collect()
}

/// `client`'s state for `dir`.
pub(crate) fn status(env: &Env, client: &'static Client, dir: &Path) -> Status {
    let config = env.path(client.config);
    let launch = Launch::new(env.server.as_deref(), dir);
    let installed = client.markers.iter().any(|m| env.path(m).exists())
        || client
            .bundles
            .iter()
            .any(|b| env.applications.iter().any(|apps| apps.join(b).exists()));
    let registered = read_registered(client, &config);
    let current = match &registered {
        Registered::Yes(found) => {
            found.args == launch.args && (env.server.is_none() || found.command == launch.command)
        }
        _ => false,
    };
    let manual = match client.kind {
        Kind::ClaudeCli if env.claude_cli().is_none() => Some(Manual::NoCli),
        // Its CLI writes the file, whatever Jot makes of it.
        Kind::ClaudeCli => None,
        Kind::Json {
            writable: false, ..
        } => Some(Manual::Unsupported),
        _ if registered == Registered::Unreadable || !parses(client, &config) => {
            Some(Manual::Unreadable)
        }
        _ => None,
    };
    Status {
        client,
        installed,
        registered,
        current,
        manual,
        config: env.shown(&config),
        snippet: snippet(client, &launch),
    }
}

/// What connects `client` by hand: Claude Code's command, else the file's entry.
pub(crate) fn snippet(client: &Client, launch: &Launch) -> String {
    match client.kind {
        Kind::ClaudeCli => format!(
            "claude mcp add --scope user {SERVER_NAME} -- {}",
            launch.command_line()
        ),
        Kind::Json {
            key, stdio_type, ..
        } => {
            let mut servers = Map::new();
            servers.insert(SERVER_NAME.into(), launch.json(stdio_type));
            let mut root = Map::new();
            root.insert(key.into(), Value::Object(servers));
            serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default()
        }
        Kind::Toml { table } => {
            let mut doc = toml_edit::DocumentMut::new();
            let mut servers = toml_edit::Table::new();
            servers.set_implicit(true);
            servers.insert(SERVER_NAME, toml_edit::Item::Table(toml_entry(launch)));
            doc.insert(table, toml_edit::Item::Table(servers));
            doc.to_string().trim().to_owned()
        }
    }
}

/// The generic setup, for any other app: the command line, and the `mcpServers` JSON most apps take.
pub(crate) fn generic(env: &Env, dir: &Path) -> (String, String) {
    let launch = Launch::new(env.server.as_deref(), dir);
    let json = snippet(
        &Client {
            id: "",
            name: "",
            markers: &[],
            bundles: &[],
            config: "",
            kind: Kind::Json {
                key: "mcpServers",
                stdio_type: false,
                writable: true,
            },
        },
        &launch,
    );
    (launch.command_line(), json)
}

/// Whether Jot would write `config`: missing, empty, or plain JSON / TOML whose servers, if there, are an object
/// / a table (JSON with comments is read, never written).
fn parses(client: &Client, config: &Path) -> bool {
    let Ok(text) = fs::read_to_string(config) else {
        return !config.exists();
    };
    if text.trim().is_empty() {
        return true;
    }
    match client.kind {
        Kind::ClaudeCli => true,
        Kind::Json { key, .. } => serde_json::from_str::<Value>(&text).is_ok_and(|root| {
            root.as_object()
                .is_some_and(|root| root.get(key).is_none_or(Value::is_object))
        }),
        Kind::Toml { table } => text
            .parse::<toml_edit::DocumentMut>()
            .is_ok_and(|doc| doc.get(table).is_none_or(toml_edit::Item::is_table_like)),
    }
}

fn read_registered(client: &Client, config: &Path) -> Registered {
    let text = match fs::read_to_string(config) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Registered::No,
        Err(_) => return Registered::Unreadable,
    };
    match client.kind {
        Kind::ClaudeCli => json_registered(&text, "mcpServers"),
        Kind::Json { key, .. } => json_registered(&text, key),
        Kind::Toml { table } => {
            let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else {
                return Registered::Unreadable;
            };
            match doc.get(table).and_then(|t| t.get(SERVER_NAME)) {
                None => Registered::No,
                Some(entry) => Registered::Yes(Launch {
                    command: entry
                        .get("command")
                        .and_then(|c| c.as_str())
                        .unwrap_or_default()
                        .to_owned(),
                    args: entry
                        .get("args")
                        .and_then(|a| a.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_str().map(str::to_owned))
                                .collect()
                        })
                        .unwrap_or_default(),
                }),
            }
        }
    }
}

/// The `jot` entry under `key` of a JSON file, read leniently (comments and trailing commas allowed: reading
/// never writes).
fn json_registered(text: &str, key: &str) -> Registered {
    match json_entry(text, key) {
        Err(()) => Registered::Unreadable,
        Ok(None) => Registered::No,
        Ok(Some(entry)) => Registered::Yes(Launch {
            command: entry
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            args: entry
                .get("args")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default(),
        }),
    }
}

/// The `jot` entry under `key` of a JSON file as it is, read leniently; `Err` when the file does not parse.
fn json_entry(text: &str, key: &str) -> Result<Option<Value>, ()> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let root = serde_json::from_str::<Value>(text)
        .or_else(|_| serde_json::from_str::<Value>(&strip_jsonc(text)))
        .map_err(|_| ())?;
    Ok(root
        .get(key)
        .and_then(|servers| servers.get(SERVER_NAME))
        .cloned())
}

/// JSON with comments as plain JSON: `//` and `/* */` comments and commas before `}` or `]` taken out, strings
/// left alone.
pub(crate) fn strip_jsonc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            match c {
                '\\' => {
                    if let Some(next) = chars.next() {
                        out.push(next);
                    }
                }
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut last = '\0';
                for next in chars.by_ref() {
                    if last == '*' && next == '/' {
                        break;
                    }
                    last = next;
                }
                out.push(' ');
            }
            _ => out.push(c),
        }
    }
    // Trailing commas: a comma whose next non-space character closes an object or array.
    let bytes: Vec<char> = out.chars().collect();
    let mut result = String::with_capacity(out.len());
    let mut in_string = false;
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if in_string {
            result.push(c);
            if c == '\\' && i + 1 < bytes.len() {
                result.push(bytes[i + 1]);
                i += 2;
                continue;
            }
            if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
            result.push(c);
        } else if c == ',' {
            let next = bytes[i + 1..].iter().find(|c| !c.is_whitespace());
            if !matches!(next, Some('}') | Some(']')) {
                result.push(c);
            }
        } else {
            result.push(c);
        }
        i += 1;
    }
    result
}

/// Why connecting or disconnecting failed.
#[derive(Debug)]
pub(crate) enum ConnectError {
    /// Jot cannot do it itself (the reason): the snippet is the way.
    Manual(Manual),
    /// `jot-mcp` is not found: nothing to register.
    NoServer,
    /// Jot runs from App Translocation's temporary path ([`Env::translocated`]): it must be moved to the
    /// Applications folder first.
    Translocated,
    /// `claude mcp <command>` failed: what it said. After a failed `add` that replaced a registration, whether
    /// the old one was put back (`Err`: why not).
    Cli {
        command: &'static str,
        message: String,
        restored: Option<Result<(), String>>,
    },
    Io(io::Error),
}

impl std::fmt::Display for ConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectError::Manual(Manual::NoCli) => write!(f, "the claude command was not found"),
            ConnectError::Manual(Manual::Unreadable) => {
                write!(
                    f,
                    "its configuration file does not parse, so Jot leaves it alone"
                )
            }
            ConnectError::Manual(Manual::Unsupported) => {
                write!(f, "this app is set up by hand")
            }
            ConnectError::NoServer => write!(f, "jot-mcp was not found"),
            ConnectError::Translocated => write!(
                f,
                "Jot is running from a temporary location; move it to the Applications folder first"
            ),
            ConnectError::Cli {
                command,
                message,
                restored,
            } => {
                write!(f, "claude mcp {command} failed: {message}")?;
                match restored {
                    None => Ok(()),
                    Some(Ok(())) => write!(f, " (Claude Code keeps its previous jot server)"),
                    Some(Err(why)) => write!(
                        f,
                        " (and its previous jot server could not be put back: {why}; connect again)"
                    ),
                }
            }
            ConnectError::Io(error) => write!(f, "{error}"),
        }
    }
}

impl From<io::Error> for ConnectError {
    fn from(error: io::Error) -> Self {
        ConnectError::Io(error)
    }
}

/// The process's lock on the apps' configuration: each change reads, edits and writes a file, and two at once
/// (a sync and a click) would undo one another.
fn exclusive() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Registers Jot for `dir` with `client` (replacing an older registration), and says how it stands then.
pub(crate) fn connect(
    env: &Env,
    client: &'static Client,
    dir: &Path,
) -> Result<Status, ConnectError> {
    let server = env.server.as_deref().ok_or(ConnectError::NoServer)?;
    if env.translocated() {
        return Err(ConnectError::Translocated);
    }
    let launch = Launch::new(Some(server), dir);
    let _lock = exclusive();
    register(env, client, Some(&launch))?;
    Ok(status(env, client, dir))
}

/// Takes Jot out of `client`'s configuration, and says how it stands then (for `dir`).
pub(crate) fn disconnect(
    env: &Env,
    client: &'static Client,
    dir: &Path,
) -> Result<Status, ConnectError> {
    let _lock = exclusive();
    register(env, client, None)?;
    Ok(status(env, client, dir))
}

/// Registers `dir` again with every app connected to another folder or another `jot-mcp` that Jot can write.
/// An app it could not update keeps its error; the rest go on. An app Jot cannot write comes back as it was
/// (still `registered`, not `current`, its `manual` saying why). A translocated Jot ([`Env::translocated`])
/// keeps the command each app has and moves the folder only.
pub(crate) fn sync(env: &Env, dir: &Path) -> Vec<(Status, Option<ConnectError>)> {
    let _lock = exclusive();
    let server = env.server.as_ref().filter(|_| !env.translocated());
    statuses(env, dir)
        .into_iter()
        .map(|status| {
            let stale = matches!(status.registered, Registered::Yes(_)) && !status.current;
            if !stale || status.manual.is_some() {
                return (status, None);
            }
            // Without `jot-mcp` found, keep the command the app has and move the folder only.
            let launch = match (server, &status.registered) {
                (Some(server), _) => Launch::new(Some(server), dir),
                (None, Registered::Yes(found))
                    if !found.command.is_empty() && !is_translocated(Path::new(&found.command)) =>
                {
                    Launch {
                        command: found.command.clone(),
                        args: Launch::new(None, dir).args,
                    }
                }
                _ if env.translocated() => return (status, Some(ConnectError::Translocated)),
                _ => return (status, Some(ConnectError::NoServer)),
            };
            match register(env, status.client, Some(&launch)) {
                Ok(()) => (self::status(env, status.client, dir), None),
                Err(error) => (status, Some(error)),
            }
        })
        .collect()
}

/// Writes `launch` as `client`'s `jot` entry, or takes it out (`None`). The caller holds [`exclusive`].
fn register(
    env: &Env,
    client: &'static Client,
    launch: Option<&Launch>,
) -> Result<(), ConnectError> {
    let config = env.path(client.config);
    match client.kind {
        Kind::ClaudeCli => register_claude_code(env, client, &config, launch),
        Kind::Json {
            writable: false, ..
        } => Err(ConnectError::Manual(Manual::Unsupported)),
        Kind::Json {
            key, stdio_type, ..
        } => edit_json(&config, key, stdio_type, launch),
        Kind::Toml { table } => edit_toml(&config, table, launch),
    }
}

/// Claude Code's registration, through its CLI: `add` fails on a name that is there, so the old entry is
/// removed first (an error then is "not found"), and put back as it was (`add-json`) should `add` fail.
fn register_claude_code(
    env: &Env,
    client: &Client,
    config: &Path,
    launch: Option<&Launch>,
) -> Result<(), ConnectError> {
    let cli = env
        .claude_cli()
        .ok_or(ConnectError::Manual(Manual::NoCli))?;
    let before = fs::read_to_string(config)
        .ok()
        .and_then(|text| json_entry(&text, "mcpServers").ok().flatten());
    let removed = run_claude(env, &cli, "remove", &["--scope", "user", SERVER_NAME]);
    let Some(launch) = launch else {
        return match removed {
            Err(_) if read_registered(client, config) == Registered::No => Ok(()),
            other => other,
        };
    };
    let mut args = vec![
        "--scope",
        "user",
        SERVER_NAME,
        "--",
        launch.command.as_str(),
    ];
    args.extend(launch.args.iter().map(String::as_str));
    match run_claude(env, &cli, "add", &args) {
        Ok(()) => Ok(()),
        Err(ConnectError::Cli {
            command, message, ..
        }) => {
            let restored = match (before, removed) {
                (Some(entry), Ok(())) => Some(
                    run_claude(
                        env,
                        &cli,
                        "add-json",
                        &["--scope", "user", SERVER_NAME, &entry.to_string()],
                    )
                    .map_err(|error| match error {
                        ConnectError::Cli { message, .. } => message,
                        other => other.to_string(),
                    }),
                ),
                _ => None,
            };
            Err(ConnectError::Cli {
                command,
                message,
                restored,
            })
        }
        Err(other) => Err(other),
    }
}

/// Runs `claude mcp <command> args…` with the user's home and a `PATH` a GUI app lacks (an npm install's
/// `claude` needs `node`), within [`CLI_TIMEOUT`], reading what it prints as it runs.
fn run_claude(
    env: &Env,
    cli: &Path,
    command: &'static str,
    args: &[&str],
) -> Result<(), ConnectError> {
    let failed = |message: String| ConnectError::Cli {
        command,
        message,
        restored: None,
    };
    let mut path = Vec::new();
    if let Some(dir) = cli.parent() {
        path.push(dir.to_path_buf());
    }
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        path.push(PathBuf::from(dir));
    }
    if let Some(inherited) = std::env::var_os("PATH") {
        path.extend(std::env::split_paths(&inherited));
    }
    let mut child = Command::new(cli)
        .args(["mcp", command])
        .args(args)
        .env("HOME", &env.home)
        .env(
            "PATH",
            std::env::join_paths(path).map_err(io::Error::other)?,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    // Its output is read as it comes, so a full pipe never stalls it.
    let (sender, outputs) = mpsc::channel();
    for (index, pipe) in [
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn io::Read + Send>),
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn io::Read + Send>),
    ]
    .into_iter()
    .enumerate()
    {
        let sender = sender.clone();
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_string(&mut text);
            }
            let _ = sender.send((index, text));
        });
    }
    drop(sender);
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() > CLI_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(failed(format!(
                "no answer within {} seconds",
                CLI_TIMEOUT.as_secs()
            )));
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    if status.success() {
        return Ok(());
    }
    // What it printed, stderr first; a process it left behind holding a pipe is not waited for long.
    let mut printed = [String::new(), String::new()];
    while let Ok((index, text)) = outputs.recv_timeout(Duration::from_secs(2)) {
        printed[index] = text;
    }
    let [stdout, stderr] = printed;
    let message = [stderr.trim(), stdout.trim()]
        .into_iter()
        .find(|text| !text.is_empty())
        .map_or_else(|| status.to_string(), str::to_owned);
    Err(failed(message))
}

/// Sets (or takes out) `<key>.jot` of the JSON file `config`, the rest keeping its data, key order, indentation,
/// line endings and final newline (not its other formatting: it is written out again); a file that does not
/// parse is refused.
fn edit_json(
    config: &Path,
    key: &str,
    stdio_type: bool,
    launch: Option<&Launch>,
) -> Result<(), ConnectError> {
    let text = read_or_empty(config)?;
    let mut root = if text.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str::<Value>(&text)
            .map_err(|_| ConnectError::Manual(Manual::Unreadable))?
    };
    let Some(object) = root.as_object_mut() else {
        return Err(ConnectError::Manual(Manual::Unreadable));
    };
    let had_jot = object
        .get(key)
        .and_then(|servers| servers.get(SERVER_NAME))
        .is_some();
    match launch {
        Some(launch) => {
            let servers = object
                .entry(key)
                .or_insert_with(|| Value::Object(Map::new()));
            let Some(servers) = servers.as_object_mut() else {
                return Err(ConnectError::Manual(Manual::Unreadable));
            };
            // An entry that is there keeps what Jot does not set (`env`, say).
            match servers.get_mut(SERVER_NAME).and_then(Value::as_object_mut) {
                Some(entry) => {
                    if stdio_type {
                        entry.insert("type".into(), "stdio".into());
                    }
                    entry.insert("command".into(), launch.command.clone().into());
                    entry.insert("args".into(), launch.args.clone().into());
                }
                None => {
                    servers.insert(SERVER_NAME.into(), launch.json(stdio_type));
                }
            }
        }
        None => {
            let Some(servers) = object.get_mut(key).and_then(Value::as_object_mut) else {
                return Ok(());
            };
            if servers.remove(SERVER_NAME).is_none() {
                return Ok(());
            }
        }
    }
    let indent = indentation(&text);
    let mut out = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes());
    let mut serializer = serde_json::Serializer::with_formatter(&mut out, formatter);
    serde::Serialize::serialize(&root, &mut serializer).map_err(io::Error::other)?;
    out.push(b'\n');
    let out = String::from_utf8(out).map_err(io::Error::other)?;
    write_config(config, &text, &like(&text, out), had_jot)
}

/// `new`, the new text of a file that was `old`, with `old`'s line endings (CRLF) and final newline or none.
fn like(old: &str, new: String) -> String {
    if old.trim().is_empty() {
        return new;
    }
    let mut new = if old.contains("\r\n") {
        new.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        new
    };
    if !old.ends_with('\n') {
        let kept = new.trim_end_matches(['\r', '\n']).len();
        new.truncate(kept);
    }
    new
}

/// The indentation of a JSON file's first indented line; two spaces for a new one.
fn indentation(text: &str) -> String {
    text.lines()
        .find_map(|line| {
            let indent: String = line
                .chars()
                .take_while(|c| *c == ' ' || *c == '\t')
                .collect();
            (!indent.is_empty() && line.len() > indent.len()).then_some(indent)
        })
        .unwrap_or_else(|| "  ".to_owned())
}

/// Sets (or takes out) `[<table>.jot]` of the TOML file `config`, keeping its comments and layout; a file that
/// does not parse is refused.
fn edit_toml(config: &Path, table: &str, launch: Option<&Launch>) -> Result<(), ConnectError> {
    let text = read_or_empty(config)?;
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| ConnectError::Manual(Manual::Unreadable))?;
    let had_jot = doc.get(table).and_then(|t| t.get(SERVER_NAME)).is_some();
    match launch {
        Some(launch) => {
            if doc.get(table).is_none() {
                let mut servers = toml_edit::Table::new();
                servers.set_implicit(true);
                doc.insert(table, toml_edit::Item::Table(servers));
            }
            let Some(servers) = doc
                .get_mut(table)
                .and_then(toml_edit::Item::as_table_like_mut)
            else {
                return Err(ConnectError::Manual(Manual::Unreadable));
            };
            match servers
                .get_mut(SERVER_NAME)
                .and_then(toml_edit::Item::as_table_like_mut)
            {
                // An entry that is there keeps the rest (`env`, its comments).
                Some(entry) => {
                    set_toml(entry, "command", launch.command.as_str().into());
                    set_toml(entry, "args", toml_array(&launch.args).into());
                }
                None => {
                    servers.insert(SERVER_NAME, toml_edit::Item::Table(toml_entry(launch)));
                }
            }
        }
        None => {
            let Some(servers) = doc
                .get_mut(table)
                .and_then(toml_edit::Item::as_table_like_mut)
            else {
                return Ok(());
            };
            if servers.remove(SERVER_NAME).is_none() {
                return Ok(());
            }
        }
    }
    write_config(config, &text, &like(&text, doc.to_string()), had_jot)
}

/// Sets `key` of `table` to `value`, keeping the comments around the key and the value that was there.
fn set_toml(table: &mut dyn toml_edit::TableLike, key: &str, mut value: toml_edit::Value) {
    match table.get_mut(key) {
        Some(item) => {
            if let Some(old) = item.as_value() {
                *value.decor_mut() = old.decor().clone();
            }
            *item = toml_edit::Item::Value(value);
        }
        None => {
            table.insert(key, toml_edit::Item::Value(value));
        }
    }
}

fn toml_entry(launch: &Launch) -> toml_edit::Table {
    let mut entry = toml_edit::Table::new();
    entry.insert("command", toml_edit::value(launch.command.clone()));
    entry.insert("args", toml_edit::value(toml_array(&launch.args)));
    entry
}

fn toml_array(items: &[String]) -> toml_edit::Array {
    items.iter().map(String::as_str).collect()
}

fn read_or_empty(path: &Path) -> io::Result<String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error),
    }
}

/// The name of `path`'s backup: `<name>.jot.bak` beside it.
pub(crate) fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".jot.bak");
    path.with_file_name(name)
}

/// Replaces the configuration `path` (whose text was `old`, with a `jot` entry or not) with `new`: nothing when
/// they are the same. Else the old file is copied to its backup when there is none yet or it has no `jot` (the
/// backup stays the version before Jot), then the new one is written to a temporary file of its own beside it,
/// made with the old one's permissions (never wider), and renamed over it. A symbolic link is followed: its
/// target is what changes, the backup beside it.
fn write_config(path: &Path, old: &str, new: &str, had_jot: bool) -> Result<(), ConnectError> {
    static TEMPORARY: AtomicU64 = AtomicU64::new(0);
    if old == new {
        return Ok(());
    }
    let path = match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(path)?,
        _ => path.to_path_buf(),
    };
    let dir = path.parent().ok_or_else(|| io::Error::other("no folder"))?;
    fs::create_dir_all(dir)?;
    let existing = fs::metadata(&path).ok();
    let backup = backup_path(&path);
    if existing.is_some() && (!had_jot || !backup.exists()) {
        fs::copy(&path, &backup)?;
    }
    let mode = existing
        .as_ref()
        .map(|meta| meta.permissions().mode() & 0o7777);
    let mut temp_name = std::ffi::OsString::from(".");
    temp_name.push(path.file_name().unwrap_or_default());
    temp_name.push(format!(
        ".jot-{}-{}.tmp",
        std::process::id(),
        TEMPORARY.fetch_add(1, Ordering::Relaxed)
    ));
    let temp = dir.join(temp_name);
    // `create_new`: never a file (or a link) that is there already.
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode.unwrap_or(0o644))
        .open(&temp)?;
    let written = (|| -> io::Result<()> {
        file.write_all(new.as_bytes())?;
        file.sync_all()?;
        // The umask may have taken bits off.
        if let Some(mode) = mode {
            fs::set_permissions(&temp, fs::Permissions::from_mode(mode))?;
        }
        fs::rename(&temp, &path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    Ok(written?)
}

#[cfg(test)]
mod tests;
