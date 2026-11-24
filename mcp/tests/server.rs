//! Drives the server through an MCP client over an in-memory transport: create → search → read → append, and
//! add → list → complete → reschedule for to-dos.

use std::fs;

use jiff::civil::{DateTime, date};
use jot_mcp::JotServer;
use jot_store::Store;
use rmcp::model::{CallToolRequestParams, CallToolResult, ClientConfig, Implementation};
use rmcp::service::RunningService;
use rmcp::{ClientHandler, RoleClient, ServiceExt as _};

/// An MCP client that calls itself by the name it holds (`clientInfo.name`), as Claude Desktop calls itself
/// `claude-ai`.
#[derive(Debug, Clone)]
struct Client(&'static str);

impl ClientHandler for Client {
    fn get_info(&self) -> ClientConfig {
        let mut config = ClientConfig::default();
        config.client_info = Implementation::new(self.0, "1.0.0");
        config
    }
}

async fn call(
    client: &RunningService<RoleClient, Client>,
    tool: &str,
    arguments: serde_json::Value,
) -> (bool, String) {
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

#[tokio::test]
async fn create_search_read_append() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    fs::write(dir.path().join("Groceries.md"), "milk, eggs\n").unwrap();

    let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
    let server = tokio::spawn(async move {
        JotServer::new(store)
            .serve(server_transport)
            .await
            .unwrap()
            .waiting()
            .await
            .unwrap();
    });
    let client = Client("claude-ai").serve(client_transport).await.unwrap();

    let info = client.peer_info().unwrap();
    assert_eq!(info.server_info.as_ref().unwrap().name, "jot");
    assert!(info.instructions.as_deref().unwrap().contains("sensitive"));

    let mut tools: Vec<String> = client
        .list_all_tools()
        .await
        .unwrap()
        .into_iter()
        .map(|tool| tool.name.to_string())
        .collect();
    tools.sort();
    assert_eq!(
        tools,
        [
            "add_todo",
            "append_note",
            "complete_todo",
            "create_note",
            "list_todos",
            "read_note",
            "recent_notes",
            "reschedule_todo",
            "search_notes"
        ]
    );

    // Create.
    let (is_error, text) = call(
        &client,
        "create_note",
        serde_json::json!({ "title": "Deploy command", "body": "cargo build --release" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.contains("Deploy command"), "{text}");
    assert_eq!(
        fs::read_to_string(dir.path().join("Deploy command.md")).unwrap(),
        "---\nsource: claude\n---\ncargo build --release"
    );

    // The title is taken: the error points to append_note.
    let (is_error, text) = call(
        &client,
        "create_note",
        serde_json::json!({ "title": "deploy COMMAND", "body": "x" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("append_note"), "{text}");

    // Search.
    let (is_error, text) = call(
        &client,
        "search_notes",
        serde_json::json!({ "query": "release" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.starts_with("1 note matching \"release\""), "{text}");
    assert!(text.contains("## Deploy command"), "{text}");
    assert!(text.contains("written by Claude"), "{text}");
    assert!(text.contains("cargo build --release"), "{text}");
    assert!(!text.contains("Groceries"), "{text}");

    let (is_error, text) = call(
        &client,
        "search_notes",
        serde_json::json!({ "query": "wifi" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.starts_with("No notes match"), "{text}");

    // Read.
    let (is_error, text) = call(
        &client,
        "read_note",
        serde_json::json!({ "title": "deploy command" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.starts_with("# Deploy command\n"), "{text}");
    assert!(text.ends_with("\n\ncargo build --release"), "{text}");

    let (is_error, text) = call(
        &client,
        "read_note",
        serde_json::json!({ "title": "Missing" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("search_notes"), "{text}");

    // Append.
    let (is_error, text) = call(
        &client,
        "append_note",
        serde_json::json!({ "title": "Deploy command", "text": "Then run ./deploy.sh" }),
    )
    .await;
    assert!(!is_error, "{text}");
    let (_, text) = call(
        &client,
        "read_note",
        serde_json::json!({ "title": "Deploy command" }),
    )
    .await;
    assert!(
        text.ends_with("cargo build --release\n\nThen run ./deploy.sh\n"),
        "{text}"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("Deploy command.md")).unwrap(),
        "---\nsource: claude\n---\ncargo build --release\n\nThen run ./deploy.sh\n"
    );

    let (is_error, text) = call(
        &client,
        "append_note",
        serde_json::json!({ "title": "Nope", "text": "x" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("search_notes"), "{text}");

    // Recent: the user's note too, with limits.
    let (is_error, text) = call(&client, "recent_notes", serde_json::json!({})).await;
    assert!(!is_error, "{text}");
    assert!(
        text.contains("## Deploy command") && text.contains("## Groceries"),
        "{text}"
    );
    assert!(text.contains("written by the user"), "{text}");
    let (_, text) = call(&client, "recent_notes", serde_json::json!({ "limit": 1 })).await;
    assert_eq!(text.matches("\n## ").count(), 1, "{text}");

    client.cancel().await.unwrap();
    server.await.unwrap();
}

/// Friday 2026-11-13 10:30.
fn friday_morning() -> DateTime {
    date(2026, 11, 13).at(10, 30, 0, 0)
}

#[tokio::test]
async fn add_list_complete_todos() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    fs::write(dir.path().join("Groceries.md"), "milk, eggs\n").unwrap();

    let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
    let server = tokio::spawn(async move {
        JotServer::new(store)
            .with_clock(friday_morning)
            .serve(server_transport)
            .await
            .unwrap()
            .waiting()
            .await
            .unwrap();
    });
    let client = Client("claude-ai").serve(client_transport).await.unwrap();
    let todo_note = dir.path().join("待办.md");

    // Add: an ISO time, a phrase in the text, a phrase as `due`, another note, no time.
    let (is_error, text) = call(
        &client,
        "add_todo",
        serde_json::json!({ "text": "交房租", "due": "2026-11-13T09:00" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.contains("due Fri 2026-11-13 09:00"), "{text}");
    assert!(text.contains("already passed"), "{text}");
    let (is_error, text) = call(
        &client,
        "add_todo",
        serde_json::json!({ "text": "交周报 下周五" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.contains("\"交周报\""), "{text}");
    assert!(text.contains("due Fri 2026-11-20 09:00"), "{text}");
    let (is_error, text) = call(
        &client,
        "add_todo",
        serde_json::json!({ "text": "开会", "due": "下午3点" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.contains("due Fri 2026-11-13 15:00"), "{text}");
    let (is_error, text) = call(
        &client,
        "add_todo",
        serde_json::json!({ "text": "买面包", "note": "groceries" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.contains("note \"Groceries\" with no time"), "{text}");
    assert_eq!(
        fs::read_to_string(&todo_note).unwrap(),
        "---\nsource: claude\n---\n- [ ] 交房租 ⏰ 2026-11-13 09:00\n- [ ] 交周报 ⏰ 2026-11-20 09:00\n\
         - [ ] 开会 ⏰ 2026-11-13 15:00\n"
    );
    // The user's note gets the line, and no frontmatter.
    assert_eq!(
        fs::read_to_string(dir.path().join("Groceries.md")).unwrap(),
        "milk, eggs\n\n- [ ] 买面包\n"
    );

    let (is_error, text) = call(
        &client,
        "add_todo",
        serde_json::json!({ "text": "x", "due": "someday" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("2026-11-13T10:30"), "{text}");
    let (is_error, _) = call(&client, "add_todo", serde_json::json!({ "text": "明天" })).await;
    assert!(is_error);

    // List: today's and overdue by default.
    let (is_error, text) = call(&client, "list_todos", serde_json::json!({})).await;
    assert!(!is_error, "{text}");
    assert!(text.starts_with("Now: Fri 2026-11-13 10:30."), "{text}");
    assert!(
        text.contains("## Overdue\n- 交房租 · due Fri 2026-11-13 09:00 · note \"待办\""),
        "{text}"
    );
    assert!(
        text.contains("## Today\n- 开会 · due Fri 2026-11-13 15:00 · note \"待办\""),
        "{text}"
    );
    assert!(
        !text.contains("交周报") && !text.contains("买面包"),
        "{text}"
    );
    assert!(text.contains("2 more open to-dos"), "{text}");

    let (_, text) = call(
        &client,
        "list_todos",
        serde_json::json!({ "range": "upcoming" }),
    )
    .await;
    assert!(text.contains("## Upcoming\n- 交周报"), "{text}");
    assert!(!text.contains("开会"), "{text}");
    let (_, text) = call(
        &client,
        "list_todos",
        serde_json::json!({ "range": "overdue" }),
    )
    .await;
    assert!(text.contains("交房租") && !text.contains("开会"), "{text}");
    let (_, text) = call(&client, "list_todos", serde_json::json!({ "range": "all" })).await;
    assert!(text.contains("4 to-dos:"), "{text}");
    assert!(
        text.contains("## No time\n- 买面包 · note \"Groceries\""),
        "{text}"
    );
    assert!(!text.contains("more open"), "{text}");

    // Complete: a unique part of the text is enough; only the box changes.
    let (is_error, text) = call(
        &client,
        "complete_todo",
        serde_json::json!({ "note": "待办", "text": "房租" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.contains("Checked off \"交房租\""), "{text}");
    assert!(
        fs::read_to_string(&todo_note)
            .unwrap()
            .contains("- [x] 交房租 ⏰ 2026-11-13 09:00 ✅ 2026-11-13\n")
    );
    let (is_error, text) = call(
        &client,
        "complete_todo",
        serde_json::json!({ "note": "待办", "text": "交房租" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(
        text.contains("already checked off (Fri 2026-11-13)"),
        "{text}"
    );
    let (_, text) = call(&client, "list_todos", serde_json::json!({})).await;
    assert!(!text.contains("交房租"), "{text}");

    // Errors: nothing matches, several match, the note is missing.
    let (is_error, text) = call(
        &client,
        "complete_todo",
        serde_json::json!({ "note": "待办", "text": "遛狗" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("Its open to-dos:\n- 开会"), "{text}");
    call(&client, "add_todo", serde_json::json!({ "text": "交周报" })).await;
    let (is_error, text) = call(
        &client,
        "complete_todo",
        serde_json::json!({ "note": "待办", "text": "交周报" }),
    )
    .await;
    assert!(is_error);
    assert!(
        text.starts_with("2 to-dos in the note \"待办\" match"),
        "{text}"
    );
    assert!(text.contains("read the same"), "{text}");
    let (is_error, text) = call(
        &client,
        "complete_todo",
        serde_json::json!({ "note": "Nope", "text": "x" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("list_todos"), "{text}");

    // Phrases in English, traditional Chinese and Japanese, as `due` or in the text.
    for (args, task, due) in [
        (
            serde_json::json!({ "text": "Pay rent", "due": "tomorrow 3pm", "note": "Trips" }),
            "Pay rent",
            "Sat 2026-11-14 15:00",
        ),
        (
            serde_json::json!({ "text": "Call mom in 30 min", "note": "Trips" }),
            "Call mom",
            "Fri 2026-11-13 11:00",
        ),
        (
            serde_json::json!({ "text": "繳費", "due": "下週五 下午3點", "note": "Trips" }),
            "繳費",
            "Fri 2026-11-20 15:00",
        ),
        (
            serde_json::json!({ "text": "家賃", "due": "来週の金曜 15時", "note": "Trips" }),
            "家賃",
            "Fri 2026-11-20 15:00",
        ),
        (
            serde_json::json!({ "text": "会議 明日の午後3時", "note": "Trips" }),
            "会議",
            "Sat 2026-11-14 15:00",
        ),
    ] {
        let (is_error, text) = call(&client, "add_todo", args).await;
        assert!(!is_error, "{text}");
        assert!(text.contains(&format!("\"{task}\"")), "{text}");
        assert!(text.contains(&format!("due {due}")), "{text}");
    }
    assert_eq!(
        fs::read_to_string(dir.path().join("Trips.md")).unwrap(),
        "---\nsource: claude\n---\n- [ ] Pay rent ⏰ 2026-11-14 15:00\n- [ ] Call mom ⏰ 2026-11-13 11:00\n\
         - [ ] 繳費 ⏰ 2026-11-20 15:00\n- [ ] 家賃 ⏰ 2026-11-20 15:00\n- [ ] 会議 ⏰ 2026-11-14 15:00\n"
    );

    client.cancel().await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn reschedule_todos() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let todo_note = dir.path().join("待办.md");
    fs::write(
        &todo_note,
        "- [ ] 交房租 ⏰ 2026-11-14 09:00\n- [ ] 交周报\n- [x] 发版 ✅ 2026-11-12\n- [ ] 遛狗 ⏰ 2026-11-13 18:00\n",
    )
    .unwrap();

    let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
    let server = tokio::spawn(async move {
        JotServer::new(store)
            .with_clock(friday_morning)
            .serve(server_transport)
            .await
            .unwrap()
            .waiting()
            .await
            .unwrap();
    });
    let client = Client("claude-ai").serve(client_transport).await.unwrap();

    // The schema asks for `due`, null allowed.
    let tool = client
        .list_all_tools()
        .await
        .unwrap()
        .into_iter()
        .find(|tool| tool.name == "reschedule_todo")
        .unwrap();
    let schema = serde_json::Value::Object((*tool.input_schema).clone());
    let required = schema["required"].as_array().unwrap();
    for field in ["note", "text", "due"] {
        assert!(required.contains(&serde_json::json!(field)), "{schema}");
    }

    // A phrase, as "把交房租改到下周五 9点" gives it.
    let (is_error, text) = call(
        &client,
        "reschedule_todo",
        serde_json::json!({ "note": "待办", "text": "房租", "due": "下周五 9点" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(
        text.contains("\"交房租\" in the note \"待办\" is now due Fri 2026-11-20 09:00 (it was due Sat 2026-11-14 09:00)."),
        "{text}"
    );
    // ISO, on a to-do without a time.
    let (is_error, text) = call(
        &client,
        "reschedule_todo",
        serde_json::json!({ "note": "待办", "text": "交周报", "due": "2026-11-16T10:00" }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(text.contains("now due Mon 2026-11-16 10:00."), "{text}");
    // A time already past says so.
    let (_, text) = call(
        &client,
        "reschedule_todo",
        serde_json::json!({ "note": "待办", "text": "遛狗", "due": "2026-11-13T08:00" }),
    )
    .await;
    assert!(text.contains("already passed"), "{text}");
    // null removes it.
    let (is_error, text) = call(
        &client,
        "reschedule_todo",
        serde_json::json!({ "note": "待办", "text": "遛狗", "due": null }),
    )
    .await;
    assert!(!is_error, "{text}");
    assert!(
        text.contains("Removed the reminder of \"遛狗\" in the note \"待办\" (it was due Fri 2026-11-13 08:00)."),
        "{text}"
    );
    assert_eq!(
        fs::read_to_string(&todo_note).unwrap(),
        "- [ ] 交房租 ⏰ 2026-11-20 09:00\n- [ ] 交周报 ⏰ 2026-11-16 10:00\n- [x] 发版 ✅ 2026-11-12\n- [ ] 遛狗\n"
    );
    let (_, text) = call(
        &client,
        "reschedule_todo",
        serde_json::json!({ "note": "待办", "text": "遛狗", "due": null }),
    )
    .await;
    assert!(text.contains("has no reminder"), "{text}");

    // Errors: `due` left out, empty or unreadable; a checked to-do; several match; nothing matches.
    let left_out = client
        .call_tool(
            CallToolRequestParams::new("reschedule_todo".to_owned()).with_arguments(
                serde_json::json!({ "note": "待办", "text": "遛狗" })
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await;
    assert!(
        left_out.is_err() || left_out.unwrap().is_error == Some(true),
        "a call without `due` fails"
    );
    for due in ["", "someday"] {
        let (is_error, text) = call(
            &client,
            "reschedule_todo",
            serde_json::json!({ "note": "待办", "text": "遛狗", "due": due }),
        )
        .await;
        assert!(is_error, "{due:?}");
        assert!(text.contains("null"), "{text}");
    }
    let (is_error, text) = call(
        &client,
        "reschedule_todo",
        serde_json::json!({ "note": "待办", "text": "发版", "due": "明天" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("already checked off"), "{text}");
    let (is_error, text) = call(
        &client,
        "reschedule_todo",
        serde_json::json!({ "note": "待办", "text": "交", "due": "明天" }),
    )
    .await;
    assert!(is_error);
    assert!(
        text.contains("pass the full text of the one to reschedule"),
        "{text}"
    );
    let (is_error, text) = call(
        &client,
        "reschedule_todo",
        serde_json::json!({ "note": "待办", "text": "买菜", "due": "明天" }),
    )
    .await;
    assert!(is_error);
    assert!(text.contains("Its open to-dos:"), "{text}");
    // Nothing changed through the errors.
    assert!(
        fs::read_to_string(&todo_note)
            .unwrap()
            .ends_with("- [ ] 遛狗\n")
    );

    client.cancel().await.unwrap();
    server.await.unwrap();
}

#[tokio::test]
async fn notes_are_marked_with_the_client_that_wrote_them() {
    let dir = tempfile::tempdir().unwrap();
    for (name, key) in [
        ("cursor-vscode", "source: cursor"),
        ("claude-code", "source: claude-code"),
        ("Goose: nightly", "source: \"agent:Goose: nightly\""),
    ] {
        let store = Store::open(dir.path()).unwrap();
        let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
        tokio::spawn(async move {
            JotServer::new(store)
                .serve(server_transport)
                .await
                .unwrap()
                .waiting()
                .await
                .unwrap();
        });
        let client = Client(name).serve(client_transport).await.unwrap();
        let (failed, text) = call(
            &client,
            "create_note",
            serde_json::json!({ "title": name.replace(':', ""), "body": "x" }),
        )
        .await;
        assert!(!failed, "{text}");
        let file = dir.path().join(format!("{}.md", name.replace(':', "")));
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            format!("---\n{key}\n---\nx")
        );
        let (_, text) = call(
            &client,
            "add_todo",
            serde_json::json!({ "text": "a", "note": format!("todo {name}").replace(':', "") }),
        )
        .await;
        assert!(text.contains("Added"), "{text}");
        let todo = dir
            .path()
            .join(format!("todo {}.md", name.replace(':', "")));
        assert!(
            fs::read_to_string(&todo)
                .unwrap()
                .starts_with(&format!("---\n{key}\n---\n"))
        );
        client.cancel().await.unwrap();
    }
    // Search says who wrote each note, by the app's name; a clipped page's `source` is the user's.
    fs::write(
        dir.path().join("Clipped.md"),
        "---\nsource: \"https://example.com/a\"\n---\nx",
    )
    .unwrap();
    let store = Store::open(dir.path()).unwrap();
    let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        let _ = JotServer::new(store)
            .serve(server_transport)
            .await
            .unwrap()
            .waiting()
            .await;
    });
    let client = Client("claude-ai").serve(client_transport).await.unwrap();
    let (_, text) = call(&client, "recent_notes", serde_json::json!({})).await;
    assert!(text.contains("written by Cursor"), "{text}");
    assert!(text.contains("written by Claude Code"), "{text}");
    assert!(text.contains("written by Goose: nightly"), "{text}");
    assert!(!text.contains("example.com"), "{text}");
    client.cancel().await.unwrap();
}

/// A note iCloud Drive moved off the Mac (an older system's placeholder, `.Away.md.icloud`): listed as not
/// downloaded, and read once it lands; a tool that needs its text waits for it a while, then says so.
#[tokio::test]
async fn notes_not_downloaded_are_waited_for() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let placeholder = dir.path().join(".Away.md.icloud");
    fs::write(&placeholder, "bplist00").unwrap();

    let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        JotServer::new(store)
            .with_download_wait(std::time::Duration::from_millis(1500))
            .serve(server_transport)
            .await
            .unwrap()
            .waiting()
            .await
            .unwrap();
    });
    let client = Client("cursor-vscode")
        .serve(client_transport)
        .await
        .unwrap();

    let (failed, out) = call(&client, "recent_notes", serde_json::json!({})).await;
    assert!(!failed, "{out}");
    assert!(out.contains("## Away"), "{out}");
    assert!(out.contains("not downloaded"), "{out}");

    // Still not here after the wait: the tool says so, and nothing was written.
    let (failed, out) = call(
        &client,
        "append_note",
        serde_json::json!({ "title": "Away", "text": "more" }),
    )
    .await;
    assert!(failed, "{out}");
    assert!(out.contains("not downloaded"), "{out}");
    assert!(!dir.path().join("Away.md").exists());

    // It lands while the tool waits.
    let root = dir.path().to_owned();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        fs::write(root.join("Away.md"), "landed\n").unwrap();
        fs::remove_file(root.join(".Away.md.icloud")).unwrap();
    });
    let (failed, out) = call(&client, "read_note", serde_json::json!({ "title": "Away" })).await;
    assert!(!failed, "{out}");
    assert!(out.ends_with("landed\n"), "{out}");
    assert!(!placeholder.exists());
}

#[tokio::test]
async fn todos_in_fenced_code_are_not_listed() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    // A shell snippet and a Markdown sample kept in a note: their task-looking lines are code.
    fs::write(
        dir.path().join("Setup.md"),
        "- [ ] 装好开发环境\n```sh\n- [ ] not a to-do\n```\n````md\n```\n- [ ] sample\n```js\n````\n- [ ] 跑一遍测试\n",
    )
    .unwrap();

    let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
    let server = tokio::spawn(async move {
        JotServer::new(store)
            .with_clock(friday_morning)
            .serve(server_transport)
            .await
            .unwrap()
            .waiting()
            .await
            .unwrap();
    });
    let client = Client("claude-ai").serve(client_transport).await.unwrap();

    let (is_error, text) = call(&client, "list_todos", serde_json::json!({ "range": "all" })).await;
    assert!(!is_error, "{text}");
    assert!(text.contains("2 to-dos:"), "{text}");
    assert!(
        text.contains("装好开发环境") && text.contains("跑一遍测试"),
        "{text}"
    );
    assert!(
        !text.contains("not a to-do") && !text.contains("sample"),
        "{text}"
    );
    // Nor can one be ticked: the file stays as it was.
    let (is_error, text) = call(
        &client,
        "complete_todo",
        serde_json::json!({ "note": "Setup", "text": "sample" }),
    )
    .await;
    assert!(is_error, "{text}");
    assert!(
        fs::read_to_string(dir.path().join("Setup.md"))
            .unwrap()
            .contains("- [ ] sample")
    );

    client.cancel().await.unwrap();
    server.await.unwrap();
}
