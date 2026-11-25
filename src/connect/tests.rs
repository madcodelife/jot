//! Every test runs on a temporary home folder: the user's own configuration files are never read or written.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::*;

/// A temporary home with a fake `jot-mcp`, no apps, and `claude` looked for in its own `bin` only.
struct Home {
    dir: tempfile::TempDir,
    env: Env,
}

impl Home {
    fn new() -> Home {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let server = dir.path().join("Jot.app/Contents/MacOS/jot-mcp");
        executable(&server, "#!/bin/sh\n");
        let env = Env {
            applications: vec![dir.path().join("Applications")],
            claude: vec![home.join("bin/claude")],
            server: Some(server),
            home,
        };
        Home { dir, env }
    }

    fn path(&self, under_home: &str) -> PathBuf {
        self.env.home.join(under_home)
    }

    fn write(&self, under_home: &str, text: &str) {
        let path = self.path(under_home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn read(&self, under_home: &str) -> String {
        fs::read_to_string(self.path(under_home)).unwrap()
    }

    fn json(&self, under_home: &str) -> Value {
        serde_json::from_str(&self.read(under_home)).unwrap()
    }

    fn server(&self) -> String {
        self.env.server.as_ref().unwrap().display().to_string()
    }

    fn notes(&self) -> PathBuf {
        self.env.home.join("Documents/Jot")
    }
}

fn executable(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

fn json_clients() -> impl Iterator<Item = &'static Client> {
    CLIENTS
        .iter()
        .filter(|c| matches!(c.kind, Kind::Json { writable: true, .. }))
}

fn key_of(client: &Client) -> &'static str {
    match client.kind {
        Kind::Json { key, .. } => key,
        _ => unreachable!(),
    }
}

#[test]
fn ids_are_unique_and_found() {
    for (i, a) in CLIENTS.iter().enumerate() {
        assert!(CLIENTS[i + 1..].iter().all(|b| b.id != a.id), "{}", a.id);
        assert_eq!(client(a.id), Some(a));
    }
    assert_eq!(client("nope"), None);
}

#[test]
fn installed_from_settings_folders_or_app_bundles() {
    let home = Home::new();
    let dir = home.notes();
    assert!(statuses(&home.env, &dir).iter().all(|s| !s.installed));

    fs::create_dir_all(home.path(".cursor")).unwrap();
    fs::create_dir_all(home.dir.path().join("Applications/Claude.app")).unwrap();
    fs::create_dir_all(home.path(".codex")).unwrap();
    let installed: Vec<_> = statuses(&home.env, &dir)
        .into_iter()
        .filter(|s| s.installed)
        .map(|s| s.client.id)
        .collect();
    assert_eq!(installed, ["claude-desktop", "cursor", "codex"]);
}

#[test]
fn json_clients_connect_into_a_missing_file() {
    for client in json_clients() {
        let home = Home::new();
        let status = connect(&home.env, client, &home.notes()).unwrap();
        assert!(status.current, "{}", client.id);
        let file = home.json(client.config);
        let entry = &file[key_of(client)]["jot"];
        assert_eq!(entry["command"], json!(home.server()));
        assert_eq!(
            entry["args"],
            json!(["--dir", home.notes().display().to_string()])
        );
        // VS Code's servers say their transport.
        assert_eq!(
            entry.get("type").is_some(),
            client.id == "vscode",
            "{}",
            client.id
        );
        // No backup of a file that was not there.
        assert!(!backup_path(&home.path(client.config)).exists());
    }
}

#[test]
fn json_clients_keep_other_servers_and_keys() {
    for client in json_clients() {
        let home = Home::new();
        let key = key_of(client);
        let before = format!(
            "{{\n    \"theme\": \"dark\",\n    \"{key}\": {{\n        \"other\": {{ \"command\": \"x\", \"args\": [] }}\n    }},\n    \"zzz\": 1\n}}\n"
        );
        home.write(client.config, &before);
        connect(&home.env, client, &home.notes()).unwrap();
        let after = home.read(client.config);
        let file: Value = serde_json::from_str(&after).unwrap();
        assert_eq!(file["theme"], "dark");
        assert_eq!(file["zzz"], 1);
        assert_eq!(file[key]["other"]["command"], "x");
        assert_eq!(file[key]["jot"]["command"], json!(home.server()));
        // Keys keep their order and the file its four-space indentation.
        assert!(after.find("\"theme\"").unwrap() < after.find("\"zzz\"").unwrap());
        assert!(after.contains("\n    \"theme\""), "{after}");
        // The file as it was is kept beside it.
        assert_eq!(
            fs::read_to_string(backup_path(&home.path(client.config))).unwrap(),
            before
        );

        // Disconnecting takes Jot out, and only Jot.
        let status = disconnect(&home.env, client, &home.notes()).unwrap();
        assert_eq!(status.registered, Registered::No);
        let file = home.json(client.config);
        assert_eq!(file[key]["other"]["command"], "x");
        assert!(file[key].get("jot").is_none());
        // The backup stays the version before Jot.
        assert_eq!(
            fs::read_to_string(backup_path(&home.path(client.config))).unwrap(),
            before
        );
    }
}

#[test]
fn an_old_registration_is_replaced_keeping_what_jot_does_not_set() {
    let home = Home::new();
    let cursor = client("cursor").unwrap();
    home.write(
        cursor.config,
        r#"{"mcpServers":{"jot":{"command":"/old/jot-mcp","args":["--dir","/old"],"env":{"A":"1"}}}}"#,
    );
    let status = status(&home.env, cursor, &home.notes());
    assert!(matches!(status.registered, Registered::Yes(_)));
    assert!(!status.current);

    let status = connect(&home.env, cursor, &home.notes()).unwrap();
    assert!(status.current);
    let entry = &home.json(cursor.config)["mcpServers"]["jot"];
    assert_eq!(entry["command"], json!(home.server()));
    assert_eq!(entry["env"]["A"], "1");
}

#[test]
fn a_file_that_does_not_parse_is_never_written() {
    for client in json_clients() {
        let home = Home::new();
        let key = key_of(client);
        // Comments: readable for the state, refused for writing.
        let commented = format!(
            "// mine\n{{ \"{key}\": {{ \"jot\": {{ \"command\": \"/x\", \"args\": [] }}, }} }}\n"
        );
        home.write(client.config, &commented);
        let status = status(&home.env, client, &home.notes());
        assert!(
            matches!(status.registered, Registered::Yes(_)),
            "{}",
            client.id
        );
        assert_eq!(status.manual, Some(Manual::Unreadable));
        assert!(matches!(
            connect(&home.env, client, &home.notes()),
            Err(ConnectError::Manual(Manual::Unreadable))
        ));
        assert!(matches!(
            disconnect(&home.env, client, &home.notes()),
            Err(ConnectError::Manual(Manual::Unreadable))
        ));
        assert_eq!(home.read(client.config), commented);
        assert!(!backup_path(&home.path(client.config)).exists());

        // Broken JSON: unreadable altogether, and left as it is.
        home.write(client.config, "{ \"mcpServers\": ");
        let status = self::status(&home.env, client, &home.notes());
        assert_eq!(status.registered, Registered::Unreadable);
        assert!(connect(&home.env, client, &home.notes()).is_err());
        assert_eq!(home.read(client.config), "{ \"mcpServers\": ");

        // A root or a server list that is no object.
        home.write(client.config, "[]");
        assert!(connect(&home.env, client, &home.notes()).is_err());
        home.write(client.config, &format!("{{\"{key}\": []}}"));
        assert!(connect(&home.env, client, &home.notes()).is_err());
        assert_eq!(home.read(client.config), format!("{{\"{key}\": []}}"));
    }
}

#[test]
fn codex_toml_keeps_comments_and_other_servers() {
    let home = Home::new();
    let codex = client("codex").unwrap();
    let before = "# my settings\nmodel = \"gpt-5\" # pinned\n\n[mcp_servers.other]\ncommand = \"x\" # keep\nargs = []\n";
    home.write(codex.config, before);
    let status = connect(&home.env, codex, &home.notes()).unwrap();
    assert!(status.current);
    let after = home.read(codex.config);
    assert!(after.starts_with(before), "{after}");
    assert!(after.contains("[mcp_servers.jot]"), "{after}");
    let doc: toml_edit::DocumentMut = after.parse().unwrap();
    assert_eq!(
        doc["mcp_servers"]["jot"]["command"].as_str(),
        Some(home.server().as_str())
    );
    assert_eq!(
        fs::read_to_string(backup_path(&home.path(codex.config))).unwrap(),
        before
    );

    // An old entry: its command and args change, the rest stays.
    home.write(
        codex.config,
        "[mcp_servers.jot]\n# Jot\ncommand = \"/old\"\nargs = [\"--dir\", \"/old\"]\nstartup_timeout_sec = 20\n",
    );
    connect(&home.env, codex, &home.notes()).unwrap();
    let after = home.read(codex.config);
    assert!(
        after.contains("# Jot") && after.contains("startup_timeout_sec = 20"),
        "{after}"
    );
    assert!(!after.contains("/old"), "{after}");

    disconnect(&home.env, codex, &home.notes()).unwrap();
    assert!(!home.read(codex.config).contains("jot"));

    // A missing file gets the table alone; one that does not parse is refused.
    let fresh = Home::new();
    connect(&fresh.env, codex, &fresh.notes()).unwrap();
    assert!(
        fresh.read(codex.config).starts_with("[mcp_servers.jot]\n"),
        "{}",
        fresh.read(codex.config)
    );
    fresh.write(codex.config, "model = \n");
    assert!(matches!(
        connect(&fresh.env, codex, &fresh.notes()),
        Err(ConnectError::Manual(Manual::Unreadable))
    ));
    assert_eq!(fresh.read(codex.config), "model = \n");
}

#[test]
fn zed_is_read_but_never_written() {
    let home = Home::new();
    let zed = client("zed").unwrap();
    let settings = "// Zed settings\n{\n  \"theme\": \"One Dark\",\n  \"context_servers\": {\n    \"jot\": { \"command\": \"/x\", \"args\": [\"--dir\", \"/y\"], },\n  },\n}\n";
    home.write(zed.config, settings);
    let status = status(&home.env, zed, &home.notes());
    assert_eq!(status.manual, Some(Manual::Unsupported));
    assert!(matches!(&status.registered, Registered::Yes(l) if l.command == "/x"));
    assert!(
        status.snippet.contains("\"context_servers\""),
        "{}",
        status.snippet
    );
    assert!(connect(&home.env, zed, &home.notes()).is_err());
    assert!(disconnect(&home.env, zed, &home.notes()).is_err());
    assert_eq!(home.read(zed.config), settings);
}

#[test]
fn claude_code_goes_through_its_cli() {
    let home = Home::new();
    let claude = client("claude-code").unwrap();
    // Without `claude`: by hand, with the command filled in.
    let status = status(&home.env, claude, &home.notes());
    assert_eq!(status.manual, Some(Manual::NoCli));
    assert_eq!(
        status.snippet,
        format!(
            "claude mcp add --scope user jot -- {} --dir {}",
            home.server(),
            home.notes().display()
        )
    );
    assert!(matches!(
        connect(&home.env, claude, &home.notes()),
        Err(ConnectError::Manual(Manual::NoCli))
    ));

    // A stand-in `claude` that logs its arguments and the home it was given, and fails `remove` of what is
    // not there, as the real one does.
    let log = home.dir.path().join("claude.log");
    executable(
        &home.path("bin/claude"),
        &format!(
            "#!/bin/sh\necho \"HOME=$HOME $*\" >> '{}'\n[ \"$2\" = remove ] && [ ! -f \"$HOME/.registered\" ] && {{ echo 'No MCP server found' >&2; exit 1; }}\n[ \"$2\" = add ] && touch \"$HOME/.registered\"\n[ \"$2\" = remove ] && rm -f \"$HOME/.registered\"\nexit 0\n",
            log.display()
        ),
    );
    assert_eq!(home.env.claude_cli(), Some(home.path("bin/claude")));
    connect(&home.env, claude, &home.notes()).unwrap();
    let home_arg = format!("HOME={}", home.env.home.display());
    assert_eq!(
        fs::read_to_string(&log).unwrap(),
        format!(
            "{home_arg} mcp remove --scope user jot\n{home_arg} mcp add --scope user jot -- {} --dir {}\n",
            home.server(),
            home.notes().display()
        )
    );
    // Its state comes from ~/.claude.json, which the real CLI writes.
    home.write(
        ".claude.json",
        &json!({ "numStartups": 3, "mcpServers": { "jot": { "type": "stdio", "command": home.server(), "args": ["--dir", home.notes().display().to_string()], "env": {} } } }).to_string(),
    );
    assert!(self::status(&home.env, claude, &home.notes()).current);

    // Disconnecting runs `remove`; its failure is reported.
    fs::write(&log, "").unwrap();
    disconnect(&home.env, claude, &home.notes()).unwrap();
    assert_eq!(
        fs::read_to_string(&log).unwrap(),
        format!("{home_arg} mcp remove --scope user jot\n")
    );
    // Jot never writes ~/.claude.json itself.
    assert!(!backup_path(&home.path(".claude.json")).exists());

    executable(
        &home.path("bin/claude"),
        "#!/bin/sh\necho 'boom' >&2\nexit 1\n",
    );
    match connect(&home.env, claude, &home.notes()) {
        Err(ConnectError::Cli {
            command: "add",
            message,
            restored: None,
        }) => assert_eq!(message, "boom"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn claude_code_gets_its_old_server_back_when_add_fails() {
    let home = Home::new();
    let claude = client("claude-code").unwrap();
    let old = json!({ "type": "stdio", "command": "/old/jot-mcp", "args": ["--dir", "/old"], "env": { "A": "1" } });
    home.write(
        ".claude.json",
        &json!({ "mcpServers": { "jot": old.clone() } }).to_string(),
    );
    // `remove` works, `add` fails, `add-json` works; each logs its arguments.
    let log = home.dir.path().join("claude.log");
    executable(
        &home.path("bin/claude"),
        &format!(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\n[ \"$2\" = add ] && {{ echo 'env: node: No such file or directory' >&2; exit 127; }}\nexit 0\n",
            log.display()
        ),
    );
    let error = connect(&home.env, claude, &home.notes()).unwrap_err();
    assert!(
        matches!(
            &error,
            ConnectError::Cli {
                command: "add",
                restored: Some(Ok(())),
                ..
            }
        ),
        "{error:?}"
    );
    assert_eq!(
        error.to_string(),
        "claude mcp add failed: env: node: No such file or directory (Claude Code keeps its previous jot server)"
    );
    let lines: Vec<String> = fs::read_to_string(&log)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect();
    assert_eq!(lines.len(), 3, "{lines:?}");
    assert_eq!(lines[0], "mcp remove --scope user jot");
    assert!(lines[1].starts_with("mcp add --scope user jot -- "));
    let restored = lines[2]
        .strip_prefix("mcp add-json --scope user jot ")
        .unwrap();
    assert_eq!(serde_json::from_str::<Value>(restored).unwrap(), old);

    // When putting it back fails too, the error says so.
    executable(
        &home.path("bin/claude"),
        "#!/bin/sh\n[ \"$2\" = remove ] && exit 0\necho \"no $2\" >&2\nexit 1\n",
    );
    assert_eq!(
        connect(&home.env, claude, &home.notes())
            .unwrap_err()
            .to_string(),
        "claude mcp add failed: no add (and its previous jot server could not be put back: no add-json; connect again)"
    );
}

#[test]
fn claude_output_is_read_while_it_runs() {
    let home = Home::new();
    let claude = client("claude-code").unwrap();
    // More than a pipe holds, then a failure: read as it comes, it does not stall.
    executable(
        &home.path("bin/claude"),
        "#!/bin/sh\n[ \"$2\" = remove ] && exit 0\nhead -c 300000 /dev/zero | tr '\\0' x\necho 'too long' >&2\nexit 1\n",
    );
    let started = std::time::Instant::now();
    match connect(&home.env, claude, &home.notes()) {
        Err(ConnectError::Cli { message, .. }) => assert_eq!(message, "too long"),
        other => panic!("{other:?}"),
    }
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[test]
fn claude_is_the_first_executable_candidate() {
    let home = Home::new();
    let env = Env {
        claude: vec![
            home.path("a/claude"),
            home.path("b/claude"),
            home.path("c/claude"),
        ],
        ..home.env.clone()
    };
    assert_eq!(env.claude_cli(), None);
    home.write("a/claude", "not executable");
    executable(&home.path("c/claude"), "");
    assert_eq!(env.claude_cli(), Some(home.path("c/claude")));
    executable(&home.path("b/claude"), "");
    assert_eq!(env.claude_cli(), Some(home.path("b/claude")));
    // The installers' places, the native one's first.
    let candidates = claude_candidates(Path::new("/Users/me"));
    assert_eq!(candidates[0], Path::new("/Users/me/.local/bin/claude"));
    assert!(candidates.contains(&PathBuf::from("/opt/homebrew/bin/claude")));
}

#[test]
fn the_server_beside_the_app_then_in_the_build_folders() {
    let dir = tempfile::tempdir().unwrap();
    let exe = dir.path().join("Jot.app/Contents/MacOS/Jot");
    let target = dir.path().join("target");
    assert_eq!(find_server(Some(&exe), std::slice::from_ref(&target)), None);
    executable(&target.join("debug/jot-mcp"), "");
    assert_eq!(
        find_server(Some(&exe), std::slice::from_ref(&target)),
        Some(target.join("debug/jot-mcp"))
    );
    executable(&target.join("release/jot-mcp"), "");
    assert_eq!(
        find_server(Some(&exe), std::slice::from_ref(&target)),
        Some(target.join("release/jot-mcp"))
    );
    executable(&exe.with_file_name("jot-mcp"), "");
    assert_eq!(
        find_server(Some(&exe), &[target]),
        Some(exe.with_file_name("jot-mcp"))
    );
}

#[test]
fn without_the_server_nothing_is_connected_and_snippets_say_where_it_goes() {
    let home = Home::new();
    let env = Env {
        server: None,
        ..home.env.clone()
    };
    let cursor = client("cursor").unwrap();
    assert!(matches!(
        connect(&env, cursor, &home.notes()),
        Err(ConnectError::NoServer)
    ));
    assert!(!home.path(cursor.config).exists());
    assert!(
        status(&env, cursor, &home.notes())
            .snippet
            .contains(SERVER_PLACEHOLDER)
    );
    let (command, json) = generic(&env, &home.notes());
    assert!(command.starts_with(SERVER_PLACEHOLDER));
    assert!(json.contains("\"mcpServers\""));
}

#[test]
fn sync_moves_every_connected_app_to_the_new_folder() {
    let home = Home::new();
    let old = home.env.home.join("Old");
    let new = home.env.home.join("New Notes");
    connect(&home.env, client("cursor").unwrap(), &old).unwrap();
    connect(&home.env, client("codex").unwrap(), &old).unwrap();
    // Gemini has another server only; VS Code's file does not parse.
    home.write(
        ".gemini/settings.json",
        r#"{"mcpServers":{"other":{"command":"x"}}}"#,
    );
    let vscode = client("vscode").unwrap();
    home.write(
        vscode.config,
        "// x\n{\"servers\":{\"jot\":{\"command\":\"/a\",\"args\":[\"--dir\",\"/b\"]}}}",
    );

    let results = sync(&home.env, &new);
    let by_id = |id: &str| results.iter().find(|(s, _)| s.client.id == id).unwrap();
    assert!(by_id("cursor").0.current);
    assert!(by_id("codex").0.current);
    assert!(by_id("cursor").1.is_none());
    assert_eq!(
        home.json(".cursor/mcp.json")["mcpServers"]["jot"]["args"],
        json!(["--dir", new.display().to_string()])
    );
    // Not connected: left alone. By hand: reported as it is, its file untouched.
    assert!(!home.read(".gemini/settings.json").contains("jot"));
    assert!(!by_id("vscode").0.current);
    assert_eq!(by_id("vscode").0.manual, Some(Manual::Unreadable));
    assert!(home.read(vscode.config).contains("/b"));

    // Without jot-mcp found, the command the app has stays and the folder moves.
    let env = Env {
        server: None,
        ..home.env.clone()
    };
    let newer = home.env.home.join("Newer");
    sync(&env, &newer);
    let entry = &home.json(".cursor/mcp.json")["mcpServers"]["jot"];
    assert_eq!(entry["command"], json!(home.server()));
    assert_eq!(entry["args"], json!(["--dir", newer.display().to_string()]));
}

#[test]
fn a_symlinked_config_is_written_through() {
    let home = Home::new();
    let real = home.dir.path().join("dotfiles/mcp.json");
    fs::create_dir_all(real.parent().unwrap()).unwrap();
    fs::write(&real, "{}").unwrap();
    fs::create_dir_all(home.path(".cursor")).unwrap();
    std::os::unix::fs::symlink(&real, home.path(".cursor/mcp.json")).unwrap();
    connect(&home.env, client("cursor").unwrap(), &home.notes()).unwrap();
    assert!(
        fs::symlink_metadata(home.path(".cursor/mcp.json"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(fs::read_to_string(&real).unwrap().contains("jot-mcp"));
}

#[test]
fn permissions_are_kept() {
    let home = Home::new();
    let cursor = client("cursor").unwrap();
    home.write(cursor.config, "{}");
    fs::set_permissions(home.path(cursor.config), fs::Permissions::from_mode(0o600)).unwrap();
    connect(&home.env, cursor, &home.notes()).unwrap();
    let mode = fs::metadata(home.path(cursor.config))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    // No temporary file is left.
    let left: Vec<_> = fs::read_dir(home.path(".cursor"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(left.len(), 2, "{left:?}");
}

#[test]
fn jsonc_is_read_as_json() {
    let text = "{\n // a\n \"a\": \"// not a comment\", /* b */ \"c\": [1, 2,],\n \"d\": \"\\\"x,}\",\n}\n";
    let value: Value = serde_json::from_str(&strip_jsonc(text)).unwrap();
    assert_eq!(
        value,
        json!({ "a": "// not a comment", "c": [1, 2], "d": "\"x,}" })
    );
}

#[test]
fn shell_words_and_snippets() {
    assert_eq!(
        shell_word("/Applications/Jot.app/Contents/MacOS/jot-mcp"),
        "/Applications/Jot.app/Contents/MacOS/jot-mcp"
    );
    assert_eq!(shell_word("/Users/me/My Notes"), "'/Users/me/My Notes'");
    assert_eq!(shell_word("it's"), r"'it'\''s'");
    assert_eq!(shell_word("~/x"), "'~/x'");
    let launch = Launch::new(
        Some(Path::new("/A/jot-mcp")),
        Path::new("/Users/me/My Notes"),
    );
    assert_eq!(
        launch.command_line(),
        "/A/jot-mcp --dir '/Users/me/My Notes'"
    );
    let vscode = snippet(client("vscode").unwrap(), &launch);
    let value: Value = serde_json::from_str(&vscode).unwrap();
    assert_eq!(
        value,
        json!({ "servers": { "jot": { "type": "stdio", "command": "/A/jot-mcp", "args": ["--dir", "/Users/me/My Notes"] } } })
    );
    let codex = snippet(client("codex").unwrap(), &launch);
    assert_eq!(
        codex,
        "[mcp_servers.jot]\ncommand = \"/A/jot-mcp\"\nargs = [\"--dir\", \"/Users/me/My Notes\"]"
    );
}

#[test]
fn the_backup_is_the_file_before_jot() {
    let home = Home::new();
    let cursor = client("cursor").unwrap();
    let original = "{\"mcpServers\": {}}";
    home.write(cursor.config, original);
    let backup = backup_path(&home.path(cursor.config));
    connect(&home.env, cursor, &home.notes()).unwrap();
    assert_eq!(fs::read_to_string(&backup).unwrap(), original);
    // Moving to another folder and disconnecting keep it.
    connect(&home.env, cursor, &home.notes().join("sub")).unwrap();
    disconnect(&home.env, cursor, &home.notes()).unwrap();
    assert_eq!(fs::read_to_string(&backup).unwrap(), original);
    // A file that has no Jot again is the new "before".
    let edited = "{\"mcpServers\": {\"other\": {\"command\": \"x\"}}}";
    home.write(cursor.config, edited);
    connect(&home.env, cursor, &home.notes()).unwrap();
    assert_eq!(fs::read_to_string(&backup).unwrap(), edited);
    // One with Jot, its backup gone (removed by hand): copied, as there is none.
    fs::remove_file(&backup).unwrap();
    let with_jot = home.read(cursor.config);
    connect(&home.env, cursor, &home.notes().join("sub")).unwrap();
    assert_eq!(fs::read_to_string(&backup).unwrap(), with_jot);
}

#[test]
fn line_endings_and_the_final_newline_are_kept() {
    let home = Home::new();
    let cursor = client("cursor").unwrap();
    home.write(cursor.config, "{\r\n  \"a\": 1\r\n}");
    connect(&home.env, cursor, &home.notes()).unwrap();
    let after = home.read(cursor.config);
    assert!(after.contains("\r\n"), "{after:?}");
    assert!(!after.replace("\r\n", "").contains('\n'), "{after:?}");
    assert!(after.ends_with('}'), "{after:?}");

    let codex = client("codex").unwrap();
    home.write(codex.config, "# mine\r\n[other]\r\nx = 1\r\n");
    connect(&home.env, codex, &home.notes()).unwrap();
    let after = home.read(codex.config);
    assert!(
        after.starts_with("# mine\r\n[other]\r\nx = 1\r\n"),
        "{after:?}"
    );
    assert!(!after.replace("\r\n", "").contains('\n'), "{after:?}");
    assert!(after.ends_with("\r\n"), "{after:?}");
}

#[test]
fn servers_of_the_wrong_type_are_set_up_by_hand() {
    let home = Home::new();
    let cursor = client("cursor").unwrap();
    home.write(cursor.config, "{\"mcpServers\": []}");
    assert_eq!(
        status(&home.env, cursor, &home.notes()).manual,
        Some(Manual::Unreadable)
    );
    let codex = client("codex").unwrap();
    home.write(codex.config, "mcp_servers = 1\n");
    assert_eq!(
        status(&home.env, codex, &home.notes()).manual,
        Some(Manual::Unreadable)
    );
}

#[test]
fn a_translocated_jot_connects_nothing() {
    let home = Home::new();
    let cursor = client("cursor").unwrap();
    let server = home
        .dir
        .path()
        .join("private/var/folders/x/T/AppTranslocation/ABC/d/Jot.app/Contents/MacOS/jot-mcp");
    executable(&server, "#!/bin/sh\n");
    let env = Env {
        server: Some(server),
        ..home.env.clone()
    };
    assert!(env.translocated());
    assert!(matches!(
        connect(&env, cursor, &home.notes()),
        Err(ConnectError::Translocated)
    ));
    assert!(!home.path(cursor.config).exists());
    // A sync keeps the command the app has, and moves the folder only.
    home.write(
        cursor.config,
        r#"{"mcpServers":{"jot":{"command":"/Applications/Jot.app/Contents/MacOS/jot-mcp","args":["--dir","/old"]}}}"#,
    );
    let synced = sync(&env, &home.notes());
    assert!(synced.iter().all(|(_, error)| error.is_none()));
    let entry = &home.json(cursor.config)["mcpServers"]["jot"];
    assert_eq!(
        entry["command"],
        "/Applications/Jot.app/Contents/MacOS/jot-mcp"
    );
    assert_eq!(entry["args"][1], json!(home.notes().display().to_string()));
}

#[test]
fn changes_at_once_do_not_undo_one_another() {
    let home = Home::new();
    let cursor = client("cursor").unwrap();
    home.write(cursor.config, r#"{"mcpServers":{"other":{"command":"x"}}}"#);
    let threads: Vec<_> = (0..8)
        .map(|i| {
            let env = home.env.clone();
            let dir = home.notes().join(format!("f{i}"));
            std::thread::spawn(move || {
                for _ in 0..5 {
                    connect(&env, client("cursor").unwrap(), &dir).unwrap();
                    sync(&env, &dir);
                }
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    let file = home.json(cursor.config);
    assert_eq!(file["mcpServers"]["other"]["command"], "x");
    assert!(file["mcpServers"]["jot"]["command"].is_string());
    // No temporary file is left.
    let left: Vec<_> = fs::read_dir(home.path(".cursor"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".tmp"))
        .collect();
    assert!(left.is_empty(), "{left:?}");
}

#[test]
fn an_empty_json_file_is_an_empty_object() {
    for text in ["", "  \n\t\n", "\r\n"] {
        for client in json_clients() {
            let home = Home::new();
            home.write(client.config, text);
            let status = status(&home.env, client, &home.notes());
            assert_eq!(status.registered, Registered::No, "{} {text:?}", client.id);
            assert_eq!(status.manual, None, "{} {text:?}", client.id);
            let status = connect(&home.env, client, &home.notes()).unwrap();
            assert!(status.current, "{} {text:?}", client.id);
            let file = home.json(client.config);
            assert_eq!(file[key_of(client)]["jot"]["command"], json!(home.server()));
            let status = disconnect(&home.env, client, &home.notes()).unwrap();
            assert_eq!(status.registered, Registered::No);
            assert!(
                home.json(client.config)[key_of(client)]
                    .get("jot")
                    .is_none()
            );
        }
    }
}
