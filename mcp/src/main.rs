//! `jot-mcp [--dir <path>]`: serves a Jot notes folder to an MCP client over stdio.

use std::process::ExitCode;

use jot_mcp::{JotServer, notes_dir};
use jot_store::Store;
use rmcp::ServiceExt as _;
use rmcp::transport::stdio;

const USAGE: &str = "\
Usage: jot-mcp [--dir <path>]

Serves a Jot notes folder to Claude (or any MCP client) over stdio.

The folder is --dir, else the JOT_DIR environment variable, else ~/Documents/Jot.";

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    if args.iter().any(|arg| arg == "--version" || arg == "-V") {
        println!("jot-mcp {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    // stdout carries the protocol, so everything else goes to stderr.
    let dir = match notes_dir(args, std::env::var_os("JOT_DIR"), std::env::home_dir()) {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!("jot-mcp: {error}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let store = match Store::open(&dir) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("jot-mcp: cannot open {}: {error}", dir.display());
            return ExitCode::FAILURE;
        }
    };
    let service = match JotServer::new(store).serve(stdio()).await {
        Ok(service) => service,
        Err(error) => {
            eprintln!("jot-mcp: {error}");
            return ExitCode::FAILURE;
        }
    };
    if let Err(error) = service.waiting().await {
        eprintln!("jot-mcp: {error}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
