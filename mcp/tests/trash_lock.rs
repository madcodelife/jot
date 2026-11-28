//! `trash_note` and `replace_note` with the setting off and on, and notes the user locked, through an MCP client
//! over an in-memory transport. The trash is a folder of the test (`Store::with_trash_folder`): nothing reaches the
//! user's trash.

use std::fs;
use std::path::{Path, PathBuf};

use jiff::civil::{DateTime, date};
use jot_mcp::JotServer;
use jot_store::{AiSettings, Store};
use rmcp::model::{CallToolRequestParams, CallToolResult, ClientConfig, Implementation};
use rmcp::service::RunningService;
use rmcp::{ClientHandler, RoleClient, ServiceExt as _};

#[derive(Debug, Clone)]
struct Client;

impl ClientHandler for Client {
    fn get_info(&self) -> ClientConfig {
        let mut config = ClientConfig::default();
        config.client_info = Implementation::new("claude-code", "1.0.0");
        config
    }
}

type Connection = RunningService<RoleClient, Client>;

fn wednesday() -> DateTime {
    date(2026, 11, 25).at(14, 30, 0, 0)
}

/// A notes folder, the trash standing in for the system's, and Jot's settings file.
struct Setup {
    dir: tempfile::TempDir,
}

impl Setup {
    fn new() -> Setup {
        let setup = Setup {
            dir: tempfile::tempdir().unwrap(),
        };
        fs::create_dir_all(setup.notes()).unwrap();
        setup
    }

    fn notes(&self) -> PathBuf {
        self.dir.path().join("Jot")
    }

    fn trash(&self) -> PathBuf {
        self.dir.path().join("Trash")
    }

    fn settings(&self) -> PathBuf {
        self.dir.path().join("Application Support/Jot/ai.json")
    }

    fn activity(&self) -> PathBuf {
        self.dir
            .path()
            .join("Application Support/Jot/activity.jsonl")
    }

    fn allow(&self, on: bool, language: Option<&str>) {
        AiSettings::new(on, language.map(str::to_owned))
            .write(&self.settings())
            .unwrap();
    }

    fn store(&self) -> Store {
        Store::open(self.notes())
            .unwrap()
            .with_trash_folder(self.trash())
    }

    fn note(&self, title: &str) -> PathBuf {
        self.notes().join(format!("{title}.md"))
    }

    async fn connect(&self) -> Connection {
        let server = JotServer::new(self.store())
            .with_clock(wednesday)
            .with_settings_file(self.settings())
            .with_activity_file(self.activity());
        let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
        tokio::spawn(async move {
            server
                .serve(server_transport)
                .await
                .unwrap()
                .waiting()
                .await
                .unwrap();
        });
        Client.serve(client_transport).await.unwrap()
    }
}

impl Drop for Setup {
    /// Locked files stay unless their flag is cleared first.
    fn drop(&mut self) {
        unlock_all(self.dir.path());
    }
}

fn unlock_all(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            unlock_all(&path);
        } else {
            let _ = std::process::Command::new("chflags")
                .arg("nouchg")
                .arg(&path)
                .status();
        }
    }
}

async fn call(client: &Connection, tool: &str, arguments: serde_json::Value) -> (bool, String) {
    let result: CallToolResult = client
        .call_tool(
            CallToolRequestParams::new(tool.to_owned())
                .with_arguments(arguments.as_object().unwrap().clone()),
        )
        .await
        .unwrap();
    let text = result
        .content
        .iter()
        .filter_map(|content| content.as_text())
        .map(|text| text.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    (result.is_error == Some(true), text)
}

fn trash_names(setup: &Setup) -> Vec<String> {
    let Ok(entries) = fs::read_dir(setup.trash()) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

#[tokio::test]
async fn the_tools_are_listed_with_their_hints() {
    let setup = Setup::new();
    let client = setup.connect().await;
    let tools = client.list_all_tools().await.unwrap();
    let mut names: Vec<&str> = tools.iter().map(|tool| tool.name.as_ref()).collect();
    names.sort();
    assert_eq!(
        names,
        [
            "add_todo",
            "append_note",
            "complete_todo",
            "create_note",
            "edit_note",
            "list_todos",
            "read_note",
            "recent_notes",
            "replace_note",
            "reschedule_todo",
            "search_notes",
            "trash_note"
        ]
    );
    for tool in &tools {
        let hints = tool.annotations.as_ref().expect("annotated");
        let destructive = matches!(tool.name.as_ref(), "trash_note" | "replace_note");
        assert_eq!(
            hints.destructive_hint.unwrap_or(false),
            destructive,
            "{}",
            tool.name
        );
        if destructive {
            assert_eq!(hints.read_only_hint, Some(false), "{}", tool.name);
            assert_eq!(hints.idempotent_hint, Some(true), "{}", tool.name);
            assert_eq!(hints.open_world_hint, Some(false), "{}", tool.name);
            let description = tool.description.as_deref().unwrap();
            assert!(description.contains("Trash"), "{description}");
            assert!(description.contains("Settings › AI Apps"), "{description}");
        }
    }
}

#[tokio::test]
async fn with_the_setting_off_nothing_is_removed_or_rewritten() {
    let setup = Setup::new();
    fs::write(setup.note("Plan"), "old\n").unwrap();
    let client = setup.connect().await;
    let instructions = client.peer_info().unwrap().instructions.clone().unwrap();
    assert!(instructions.contains("has not allowed"), "{instructions}");
    assert!(!instructions.contains("cannot delete"), "{instructions}");

    for (tool, args) in [
        ("trash_note", serde_json::json!({ "title": "Plan" })),
        (
            "replace_note",
            serde_json::json!({ "title": "Plan", "body": "new" }),
        ),
    ] {
        let (is_error, text) = call(&client, tool, args).await;
        assert!(is_error, "{tool}: {text}");
        assert!(text.contains("Jot › Settings › AI Apps"), "{text}");
        assert!(text.contains("nothing was changed"), "{text}");
    }
    assert_eq!(fs::read_to_string(setup.note("Plan")).unwrap(), "old\n");
    assert!(trash_names(&setup).is_empty());

    // An explicit "off" is off too.
    setup.allow(false, Some("en"));
    let (is_error, _) = call(
        &client,
        "trash_note",
        serde_json::json!({ "title": "Plan" }),
    )
    .await;
    assert!(is_error);
    assert!(setup.note("Plan").exists());

    // Turned on in the app: the next call follows, with no reconnecting.
    setup.allow(true, None);
    let (is_error, text) = call(
        &client,
        "trash_note",
        serde_json::json!({ "title": "plan" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(!setup.note("Plan").exists());
}

#[tokio::test]
async fn trash_and_rewrite_with_the_setting_on() {
    let setup = Setup::new();
    setup.allow(true, Some("zh-Hans"));
    fs::write(setup.note("Old idea"), "nothing much\n").unwrap();
    fs::write(
        setup.note("Plan"),
        "---\nsource: claude\nkeep: this\n---\n1. one\n2. two\n",
    )
    .unwrap();
    let client = setup.connect().await;
    let instructions = client.peer_info().unwrap().instructions.clone().unwrap();
    assert!(instructions.contains("allows you"), "{instructions}");
    assert!(
        instructions.contains("ask the user to confirm"),
        "{instructions}"
    );

    // Trash: the file goes to the trash as it is.
    let (is_error, text) = call(
        &client,
        "trash_note",
        serde_json::json!({ "title": "old IDEA" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(
        text.contains("Moved the note \"Old idea\" to the Trash"),
        "{text}"
    );
    assert!(!setup.note("Old idea").exists());
    assert_eq!(
        fs::read_to_string(setup.trash().join("Old idea.md")).unwrap(),
        "nothing much\n"
    );
    let (is_error, text) = call(
        &client,
        "trash_note",
        serde_json::json!({ "title": "Old idea" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("No note is titled"), "{text}");

    // Rewrite: the frontmatter stays, the old file goes to the trash under a name in the language shown.
    let (is_error, text) = call(
        &client,
        "replace_note",
        serde_json::json!({ "title": "plan", "body": "- one\n- two\n" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(
        text.contains("Plan（改写前 · 2026-11-25 14.30）.md"),
        "{text}"
    );
    assert_eq!(
        fs::read_to_string(setup.note("Plan")).unwrap(),
        "---\nsource: claude\nkeep: this\n---\n- one\n- two\n"
    );
    assert_eq!(
        fs::read_to_string(setup.trash().join("Plan（改写前 · 2026-11-25 14.30）.md")).unwrap(),
        "---\nsource: claude\nkeep: this\n---\n1. one\n2. two\n"
    );

    // The same text again changes nothing, and puts nothing more in the trash.
    let (is_error, text) = call(
        &client,
        "replace_note",
        serde_json::json!({ "title": "Plan", "body": "- one\n- two\n" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.contains("nothing changed"), "{text}");
    assert_eq!(trash_names(&setup).len(), 2);

    // A body that would become the frontmatter, or none at all, is refused.
    for body in ["---\nsource: user\nlocked: false\n---\ntaken over", "  \n"] {
        let (is_error, text) = call(
            &client,
            "replace_note",
            serde_json::json!({ "title": "Plan", "body": body }),
        )
        .await;
        assert!(is_error, "{body:?}: {text}");
    }
    assert_eq!(
        fs::read_to_string(setup.note("Plan")).unwrap(),
        "---\nsource: claude\nkeep: this\n---\n- one\n- two\n"
    );
    let (is_error, text) = call(
        &client,
        "replace_note",
        serde_json::json!({ "title": "Nothing", "body": "x" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("No note is titled"), "{text}");
}

#[tokio::test]
async fn a_locked_note_is_read_only() {
    let setup = Setup::new();
    setup.allow(true, None);
    fs::write(
        setup.note("Passport"),
        "Number 123\n- [ ] renew ⏰ 2026-12-01 09:00\n",
    )
    .unwrap();
    let store = setup.store();
    store.lock("Passport").unwrap();
    let before = fs::read_to_string(setup.note("Passport")).unwrap();
    let client = setup.connect().await;

    // Reading, searching and listing go on, and say it is locked.
    let (is_error, text) = call(
        &client,
        "read_note",
        serde_json::json!({ "title": "Passport" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(
        text.contains("Number 123") && text.contains("locked in Jot"),
        "{text}"
    );
    let (_, text) = call(
        &client,
        "search_notes",
        serde_json::json!({ "query": "number" }),
    )
    .await;
    assert!(text.contains("locked in Jot"), "{text}");
    let (_, text) = call(&client, "recent_notes", serde_json::json!({})).await;
    assert!(text.contains("locked in Jot"), "{text}");
    let (_, text) = call(&client, "list_todos", serde_json::json!({ "range": "all" })).await;
    assert!(text.contains("renew"), "{text}");

    // Every change is refused, saying to unlock it in Jot.
    for (tool, args) in [
        (
            "append_note",
            serde_json::json!({ "title": "Passport", "text": "more" }),
        ),
        (
            "edit_note",
            serde_json::json!({ "title": "Passport", "old_text": "123", "new_text": "456" }),
        ),
        (
            "add_todo",
            serde_json::json!({ "text": "call", "note": "Passport" }),
        ),
        (
            "complete_todo",
            serde_json::json!({ "note": "Passport", "text": "renew" }),
        ),
        (
            "reschedule_todo",
            serde_json::json!({ "note": "Passport", "text": "renew", "due": "2026-12-02T09:00" }),
        ),
        ("trash_note", serde_json::json!({ "title": "Passport" })),
        (
            "replace_note",
            serde_json::json!({ "title": "Passport", "body": "gone" }),
        ),
        (
            "create_note",
            serde_json::json!({ "title": "passport", "body": "over it" }),
        ),
    ] {
        let (is_error, text) = call(&client, tool, args).await;
        assert!(is_error, "{tool}: {text}");
        if tool != "create_note" {
            assert!(text.contains("locked in Jot"), "{tool}: {text}");
            assert!(text.contains("unlocks it in Jot"), "{tool}: {text}");
        }
        assert_eq!(
            fs::read_to_string(setup.note("Passport")).unwrap(),
            before,
            "{tool} changed it"
        );
    }
    assert!(trash_names(&setup).is_empty());
    // No tool unlocks a note.
    let tools = client.list_all_tools().await.unwrap();
    assert!(tools.iter().all(|tool| !tool.name.contains("lock")));
}
