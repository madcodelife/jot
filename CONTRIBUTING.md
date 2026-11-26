# Contributing to Jot

Jot is built with [NSH](https://github.com/longbridge/nsh): the client is TSX, and the notes store, the reminders and
the platform code are Rust. Only macOS is supported for now.

## Setting up

- Rust stable, with `rustfmt` and `clippy`.
- The `nsh` CLI of the version `Cargo.lock` pins for the NSH crates (`nsh-core`, `nsh-extra`): the CLI and the crates
  must be the same. `scripts/install-nsh.sh` installs that one (a release, or a commit of NSH's repository built from
  source), as CI does; `scripts/install-nsh.sh --which` only prints which it would install. `NSH_INSTALL_DIR` sets
  where NSH goes (default `~/.nsh`); `nsh` is linked into `~/.local/bin`.

Jot builds against NSH's repository at a commit (`Cargo.toml`'s `nsh-core` and `nsh-extra`), not a release: the
note's live preview needs the editor decorations' labels and font sizes and a fix to them (NSH #3272), which no release
has yet (0.7.0 lacks them). Building that commit's CLI from source takes a while. It goes back to a crates.io version
once a release of NSH has them.

## Commands

```sh
nsh run                       # build and run the app
nsh check                     # cargo check, then type-check the TSX
nsh test                      # Rust tests, then the TSX tests, headless
cargo fmt --all               # format the Rust
cargo build -p jot-mcp        # the MCP server, which `nsh run` (a debug build) finds in cargo's target folder
scripts/package-macos.sh      # build Jot.app, with jot-mcp inside
scripts/demo-notes.sh         # English example notes for screenshots, in ~/Documents/Jot Demo
```

While developing, `nsh run` (a debug build) finds `jot-mcp` in cargo's target folder: build it once with
`cargo build -p jot-mcp` to connect apps from Settings.

### Before you push

CI (`.github/workflows/ci.yml`) runs these, in this order; run them first:

```sh
cargo fmt --all --check
nsh check
cargo clippy --workspace --all-targets --locked -- -D warnings
nsh test
```

Some store tests are ignored because they need a real iCloud Drive folder; [docs/storage.md](docs/storage.md) and
[docs/locks.md](docs/locks.md) say how to run them.

### Packaging

`scripts/package-macos.sh` builds `jot-mcp`, runs `nsh package --target macos` (it passes on its options: `--arch
universal`, `--out`, `--name`, …), puts `jot-mcp` in `Jot.app/Contents/MacOS` and signs both again (ad hoc;
`SIGN_IDENTITY` for another identity, then with a secure timestamp and the hardened runtime). It runs the `nsh` on your
`PATH`, or `NSH=/path/to/nsh`, and warns when that is not the NSH `Cargo.toml`
names. CI packages a universal `Jot.app` on every run, and a `v*` tag publishes it as a release. How the script works:
[docs/app.md](docs/app.md#packaging-scriptspackage-macossh).

## Where code goes

[docs/architecture.md](docs/architecture.md) maps the folders and links a page per topic. In short:

| What | Where |
| --- | --- |
| A component, a window's view | `app/ui/` |
| Radii, sizes, type steps, materials, springs, key labels | `app/ui/tokens.ts`, by platform; colors in the themes (`app/ui/theme.json`, `app/ui/themes.json`) |
| Client logic and state, no components | `app/*.ts` (state in `app/store.ts`: components read its signals, its functions write them) |
| Wiring the windows, the tray and the global keys | `app/App.tsx` |
| Text the user reads | `locales/*.yml`, in all four languages (`en`, `zh`, `zh-Hant`, `ja`) |
| Something the client needs from the system or Rust | `src/`, exported to TSX as `jot/native`; platform code in `src/platform/<os>.rs` behind one interface |
| The notes folder: its format, reading, writing, to-dos, time phrases, locks | `store/` (jot-store), so the app and `jot-mcp` share it |
| A tool for AI apps | `mcp/` (jot-mcp) |
| TSX tests | `app/tests/*.test.tsx` (`nsh test` finds tests under `app/`, the entry's folder) |
| Rust tests | beside the code in each crate (`#[cfg(test)]` modules, `store/src/tests.rs`, `store/src/*_tests.rs`, `src/connect/tests.rs`), and `mcp/tests/` for the server |

## Docs

`docs/architecture.md` is the map; each topic has one page (`docs/storage.md`, `docs/locks.md`, `docs/todos.md`,
`docs/mcp.md`, `docs/app.md`), and `docs/product.md` defines the product. A change in behavior updates the page of its
topic in the same change.
