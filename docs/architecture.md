# Jot architecture

Jot is an [NSH](https://github.com/longbridge/nsh) app: the client is TSX, the notes store, the reminders and the
platform code are Rust, and an MCP server lets AI apps use the same notes folder. This page is the map; each topic
has its own page (below), and the product itself is defined in [product.md](product.md).

## Overview

```
app/App.tsx            the client's entry (NSH, TSX); nsh.json names it ("entry")
  app/*.ts             the client's logic: store, settings, to-dos, reminders, dictation, actions, sounds
  app/ui/              components and design tokens
        │  import … from "jot/native"
        ▼
src/     nsh-app-jot   the app's Rust crate (`jot/native`): wraps jot-store as classes for App.tsx
        │
        ▼
store/   jot-store     pure Rust: the notes folder's format, listing, search, atomic writes, folder watching
        ▲
        │
mcp/     jot-mcp       stdio MCP server for AI apps, on jot-store
```

The root `Cargo.toml` is the app crate and the workspace (`members = ["store", "mcp"]`).

The app and `jot-mcp` never talk to each other: both work on the same notes folder through jot-store, and beside it
share two files outside the folder: the setting the app writes and `jot-mcp` reads, and the log of what AI apps wrote,
which `jot-mcp` writes and the app reads for the island ([mcp.md](mcp.md)).

## Paths

| Path | What it is |
| --- | --- |
| `nsh.json` | The NSH app: its entry (`app/App.tsx`), version and build, theme, window, capabilities, where updates come from (`updater`). Paths in it are relative to it. |
| `Cargo.toml`, `Cargo.lock` | The app's Rust crate and the workspace; `Cargo.lock` pins the NSH crates, and so the `nsh` CLI to use. |
| `app/tsconfig.json` | The client's TypeScript project; it extends the `app/.nsh/tsconfig.json` the `nsh` CLI writes. |
| `app/App.tsx` | The client's entry: the menu bar app's windows (the panel, settings, the island), the tray, summoning, reminders and dictation. |
| `app/*.ts` | The client's logic, no components: `store.ts` (Jot's state: the notes folder, the panel's stage, the query and the selection), `settings.ts`, `i18n.ts`, `time.ts`, `tasks.ts`, `due.ts`, `markdown.ts`, `actions.ts`, `voice.ts`, `speechlang.ts`, `spoken.ts`, `quicknote.ts`, `connections.ts`, `ink.ts` (Jot's logo written by one pen stroke), `trayink.ts`, `updates.ts`, `sounds.ts` (the sounds of AI apps' writes). |
| `app/ui/` | Components (`Panel.tsx`, `Paper.tsx`, `NoteList.tsx`, `TodoView.tsx`, `Settings.tsx`, `Island.tsx`, …), design tokens (`tokens.ts`), motion (`motion.ts`), themes (`theme.json`, `themes.json`, `themes.ts`) and the app's SVGs. |
| `app/tests/` | The client's TSX tests (`*.test.tsx`), which `nsh test` runs headless. |
| `locales/` | The client's translations (`en`, `zh`, `zh-Hant`, `ja`), read by `nsh/i18n`. |
| `src/` | `nsh-app-jot`, the Rust that `App.tsx` imports as `jot/native` ([app.md](app.md)); platform code in `src/platform/<os>.rs`. |
| `store/` | `jot-store`: the notes folder, iCloud Drive, locks, to-dos and time phrases (`store/src/when/`), the AI apps' setting and activity log, in plain Rust. |
| `mcp/` | `jot-mcp`, the MCP server AI apps start ([mcp.md](mcp.md)). |
| `install.sh` | Installs `Jot.app` from the latest GitHub release (`curl … \| sh`; README's "Install"); published at `https://madcodelife.github.io/jot/install.sh`. |
| `scripts/install-nsh.sh` | Installs the `nsh` CLI that `Cargo.lock` pins (CI uses it too). |
| `scripts/package-macos.sh` | Builds `Jot.app` with `jot-mcp` inside, and its update archives ([app.md](app.md#packaging-scriptspackage-macossh)). |
| `scripts/native-fingerprint.sh` | The fingerprint of the native code, which an OTA package must match ([app.md](app.md#updates-appupdatests)). |
| `scripts/demo-notes.sh` | Writes English example notes into a folder (default `~/Documents/Jot Demo`) for the README's screenshots. |
| `scripts/screenshots.sh` | Takes the README's screenshots (`design/screenshots/light.png`, `dark.png`) with a `Jot.app` on those notes, its settings put back after; `scripts/screenshots/helper.swift` does what the shell cannot (the backdrop, typing, the capture). |
| `site/` | The website at `https://madcodelife.github.io/jot/`: one static page (`index.html`, `style.css`, `main.js`, no build step) in the app's languages (English, Simplified and Traditional Chinese, Japanese), with a working copy of the panel; its colors are the app's themes. |
| `scripts/build-site.sh` | Puts the site together in `_site/`: `site/`, `install.sh`, and the icons and screenshot from `design/`. |
| `assets/` | The app icon, the reminders' chime (`reminder.wav`, their notifications' sound) and the sounds of AI apps' writes the island says (`new.wav`, a new note; `done.wav`, a to-do completed). |
| `docs/` | This page, the topic pages and the product definition. |
| `design/` | The interactive design draft, the logo, the generator of Jot's sounds (`sound/build.py`) and the README's screenshots (`screenshots/`). |
| `.github/workflows/ci.yml` | CI: rustfmt, `nsh check`, clippy and `nsh test` on pull requests and `main` (whose run saves the caches pull requests start from). |
| `.github/workflows/release.yml` | For a `v*` tag: the app packaged for arm64 and x86_64, the OTA package, the signed `latest.json`, and the release ([CONTRIBUTING.md](../CONTRIBUTING.md#releasing)). |
| `.github/workflows/pages.yml` | Publishes the site (`scripts/build-site.sh`) to GitHub Pages when it or `install.sh` changes on `main`. |
| `.nsh/`, `app/.nsh/`, `target/`, `_site/` | Generated by `nsh`, cargo and `scripts/build-site.sh`; not in git. |

## Where NSH looks

- `nsh.json` sits at the root and names the entry (`"entry": "app/App.tsx"`). NSH takes the folder of `nsh.json` as
  the app's folder: `locales/`, `.nsh/` and the paths `nsh.json` names (`theme`, `icon`, `rust`) are relative to the
  root, so `locales/` stays beside `nsh.json`.
- The TypeScript project is the entry's folder: `nsh check` type-checks with `app/tsconfig.json`, and the `nsh` CLI
  writes the declarations it extends to `app/.nsh/` (`types/`, `tsconfig.json`).
- `nsh test` looks for test files under the entry's folder, `app/`: TSX tests go in `app/tests/` (a test opens the app
  with `open("../App.tsx", …)`).
- The `nsh` CLI must be the version of the NSH crates `Cargo.lock` pins (`scripts/install-nsh.sh` installs it).

## Rules that cross modules

- **The notes folder is the only shared state.** One note is one `.md` file; Jot writes through jot-store only, every
  write atomic (a temporary file renamed over the note), and never waits for iCloud to download a note
  ([storage.md](storage.md)).
- **A lock is checked by the store.** Every write of jot-store fails on a locked note, so the app, `jot-mcp` and
  anything built on the store respect it the same way ([locks.md](locks.md)).
- **To-dos are Markdown lines.** A reminder time is stored in one absolute form (` ⏰ YYYY-MM-DD HH:mm`); relative
  phrases are an input form only. The client's line edits (`app/tasks.ts`) mirror the store's
  ([todos.md](todos.md)).
- **AI apps may remove and rewrite notes only while the user allows it**, a setting in a file outside the notes
  folder that `jot-mcp` reads on every call ([mcp.md](mcp.md)).
- **The client never checks the platform** for what `jot/native` does: platform code lives in `src/platform/<os>.rs`
  behind one interface ([app.md](app.md)).
- **`jot-mcp` ships inside `Jot.app`.** `nsh package` bundles NSH's runner and the app's assets only, so
  `scripts/package-macos.sh` adds and signs it ([app.md](app.md#packaging-scriptspackage-macossh)).
- **An OTA package runs only on the native code it was published for.** It carries the TSX, never the Rust or
  `jot-mcp`: the app takes it only when its native fingerprint is the app's, else the whole app updates
  ([app.md](app.md#updates-appupdatests)).

## Topics

- [storage.md](storage.md): the notes folder format, a synced folder (iCloud Drive), jot-store's API, the app and a
  synced folder.
- [locks.md](locks.md): locked notes, in the store and in the app.
- [todos.md](todos.md): to-dos, time phrases (`when`) and the reminder time picker.
- [mcp.md](mcp.md): `jot-mcp`'s tools, AI apps removing and rewriting notes, and the activity log.
- [app.md](app.md): the app's Rust face (`jot/native`), the open note's Return and ⌘↩, its live Markdown preview, row
  actions, updates, packaging.
- [product.md](product.md): the product definition.
