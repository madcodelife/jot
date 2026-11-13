# Jot

A TSX app with a Rust crate of its own: `App.tsx` is the app, and the directory is also a crate (`Cargo.toml`,
`src/lib.rs`; `nsh.json` `"rust": "."`) whose `#[native_module("jot/native")]` exports a component (`Badge`), a
module (`Format`) and a class (`Counter`) that `App.tsx` imports from `jot/native`.

```sh
nsh run                      # this machine's backend; --target ios, android, web, macos, linux, windows or gpui
nsh check                    # cargo check of the crate, then type checks App.tsx against the declarations generated from it
nsh test                     # cargo test, then App.test.tsx, headless; --target to run it on a platform
nsh package --target web     # or ios, android, macos, linux, windows
```

`nsh` describes the crate's exports with a small program of the crate and builds the app's hosts with it linked in.
TSX edits are hot updates; Rust edits rebuild and restart the app. The first build writes the crate's TypeScript declarations into
`.nsh/types/jot/native.d.ts`, doc comments included.

A function or a member runs the way its Rust signature says: one that is not `async` runs inside the TSX call and
returns its value (`Format.times(2)`, `counter.count`); an `async fn` returns a Promise and runs as a task with NSH's
services; a module function taking `cx: &mut ModuleCx` reaches the platform in order with the UI and returns a Promise.
Register more in `src/lib.rs` with `registry.register::<…>()` (components), `registry.module::<…>()` and
`registry.class::<…>()`.

The `nsh` commands build the app's hosts from the NSH crates `Cargo.toml` depends on: crates.io's at the version of the
`nsh` you run (keep the `nsh-*` dependencies at that version when you upgrade `nsh`), or an NSH checkout's by path.

NSH-generated files stay in `.nsh/`: runner sources in `.nsh/rust/` and default packages in `.nsh/out/`.
Cargo keeps its normal `target/` directory and respects your existing `CARGO_TARGET_DIR`.

We recommend building with [huacnlee/cargo](https://github.com/huacnlee/cargo), the Cargo NSH is developed with: a
drop-in fork that builds each dependency once for all your projects and Git worktrees and keeps its build directory
under a size limit on its own, with nothing to configure. It builds under `~/.cargo/targets/` and still puts the
binaries in `target/`; it replaces `~/.cargo/bin/cargo`, and its README says how to put rustup's back.

```sh
curl -fsSL https://huacnlee.github.io/cargo/install.sh | sh     # Windows: irm https://huacnlee.github.io/cargo/install.ps1 | iex
```

## 连接 Claude

`jot-mcp` is a stdio MCP server over the notes folder: Claude can search and read your notes, create notes (marked
`source: claude`) and append to them, whether the app is running or not. It never deletes or overwrites a note.

```sh
cargo build --release -p jot-mcp
claude mcp add jot -- "$PWD/target/release/jot-mcp" --dir ~/Documents/Jot
```

The folder is `--dir`, else the `JOT_DIR` environment variable, else `~/Documents/Jot`; a leading `~` is expanded by
`jot-mcp` itself, since MCP clients start it without a shell. Add `--scope user` to `claude mcp add` to use Jot in every
project.

Claude Desktop: add the server to `~/Library/Application Support/Claude/claude_desktop_config.json` (Settings →
Developer → Edit Config) with the binary's absolute path, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "jot": {
      "command": "/absolute/path/to/jot/target/release/jot-mcp",
      "args": ["--dir", "~/Documents/Jot"]
    }
  }
}
```

Tools: `search_notes(query, limit?)`, `read_note(title)`, `recent_notes(limit?)`, `create_note(title, body)` and
`append_note(title, text)`.
