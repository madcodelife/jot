# AGENTS.md

Notes for AI agents working on Jot. [CONTRIBUTING.md](CONTRIBUTING.md) has the commands and where code goes in full;
[docs/architecture.md](docs/architecture.md) maps the code.

## Layout

- `nsh.json` at the root names the entry, `app/App.tsx`. The client is all under `app/`: logic in `app/*.ts`,
  components and design tokens in `app/ui/`, TSX tests in `app/tests/`.
- `locales/` stays beside `nsh.json`: NSH reads translations from the folder of `nsh.json`, not from `app/`.
- The TypeScript project is `app/tsconfig.json` (NSH type-checks the entry's folder); the declarations it extends are
  generated into `app/.nsh/`.
- Rust: `src/` is the app's crate (`jot/native`, platform code in `src/platform/<os>.rs`), `store/` is jot-store (the
  notes folder, to-dos, time phrases, locks), `mcp/` is jot-mcp. The root `Cargo.toml` is the app crate and the
  workspace.
- Anything that reads or writes the notes folder goes through jot-store, so the app and jot-mcp behave the same.

## Tests

- TSX tests are `app/tests/*.test.tsx`; `nsh test` only looks under `app/` (the entry's folder). A test opens the app
  with `open("../App.tsx", …)`.
- Rust tests sit beside the code in each crate; jot-mcp's are in `mcp/tests/`.

## Before you finish

Run what CI runs (`.github/workflows/ci.yml`), in this order, with the `nsh` CLI of the version `Cargo.lock` pins
(`scripts/install-nsh.sh`):

```sh
cargo fmt --all --check
nsh check
cargo clippy --workspace --all-targets --locked -- -D warnings
nsh test
```

## Docs

A change in behavior updates the page of its topic in `docs/` in the same change: `storage.md`, `locks.md`,
`todos.md`, `mcp.md` or `app.md` (`product.md` for the product definition). Each topic is written in one place;
`docs/architecture.md` keeps the map and links, not the details.
