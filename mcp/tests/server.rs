//! Drives the server through an MCP client over an in-memory transport: create → search → read → append, and
//! add → list → complete for to-dos.

use std::fs;

use jiff::civil::{DateTime, date};
use jot_mcp::JotServer;
use jot_store::Store;
use rmcp::model::{CallToolRequestParams, CallToolResult, ClientConfig};
use rmcp::service::RunningService;
use rmcp::{ClientHandler, RoleClient, ServiceExt as _};

#[derive(Debug, Clone, Default)]
struct Client;

impl ClientHandler for Client {
    fn get_info(&self) -> ClientConfig {
        ClientConfig::default()
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
    let client = Client.serve(client_transport).await.unwrap();

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
    let client = Client.serve(client_transport).await.unwrap();
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
