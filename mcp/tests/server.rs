//! Drives the server through an MCP client over an in-memory transport: create → search → read → append.

use std::fs;

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
            "append_note",
            "create_note",
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
