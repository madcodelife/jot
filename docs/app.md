# The app

The app's Rust face (`jot/native`), the open note's keys and live preview, row actions, updates and packaging. Part of
[the architecture](architecture.md).

## The app's Rust face (`jot/native`, src/)

What App.tsx imports; the TypeScript is generated from these types. Platform code lives in `src/platform/<os>.rs`
behind one interface; App.tsx never checks the platform for these.

```ts
class Notes {                                   // wraps jot_store::Store
  constructor(dir: string);                     // creates the folder; throws on failure
  readonly dir: string;
  list(): NoteMeta[];
  search(query: string, limit: number): SearchHit[];
  read(title: string): Note | null;
  write(title: string, body: string): NoteMeta; // the editor's autosave
  create(title: string, body: string): NoteMeta;
  append(title: string, text: string): NoteMeta;   // after one blank line; creates the note (source "user") if missing
  rename(from: string, to: string): NoteMeta;
  delete(title: string): void;                  // for good; the app uses trash
  trash(title: string): TrashedNote;            // to the system trash; ERR_JOT_NOT_FOUND
  restore(token: number): NoteMeta;             // ERR_JOT_ALREADY_EXISTS (token stays good), ERR_JOT_NOT_FOUND (unknown / used token)
  path(title: string): string | null;           // the note's file (Folder.reveal shows it)
  watch(onChange: () => void): void;            // folder changed (debounced); replaces the previous listener
  conflicts(title: string): Conflict[];         // iCloud's conflict versions, newest first
  resolveConflict(title: string, id: string, choice: "mine" | "theirs" | "both", copyTitle?: string | null): ResolvedConflict;  // ERR_JOT_CHANGED
  lock(title: string): NoteMeta;                // locked: true + the file's flag, mtime kept
  unlock(title: string): NoteMeta;
  settleLocks(): string[];                      // the missing half of each lock put back (folder opened / changed)
  todos(): Todo[];
  setTodoDone(note: string, line: number, text: string, done: boolean): NoteMeta;
  setTodoDue(note: string, line: number, text: string, due: string | null /* "YYYY-MM-DDTHH:mm", else TypeError; null removes */): NoteMeta;  // ERR_JOT_CHANGED
  addTodo(text: string, due?: string | null /* "YYYY-MM-DDTHH:mm", else TypeError */, note?: string | null /* "待办" */): Todo;
}
interface NoteMeta { title: string; modified: number /* ms since epoch */; source: string | null /* null: the user; else the AI app's name, "Cursor" */; preview: string; downloading: boolean /* not on this Mac yet: read-only, empty */; locked: boolean /* read-only till unlocked */ }
interface Conflict { id: string; device: string | null; modified: number; body: string }
interface ResolvedConflict { note: NoteMeta; copy: NoteMeta | null }
// Errors also: ERR_JOT_NOT_DOWNLOADED (the note is not on this Mac yet; nothing was changed), ERR_JOT_LOCKED (the note
// is locked; nothing was changed).
interface Note { meta: NoteMeta; body: string }
interface SearchHit { meta: NoteMeta; snippet: string; titleMatch: boolean }
interface TrashedNote { title: string; token: number }   // the last 64 trashed per folder can be restored
interface Todo { note: string; line: number; text: string; done: boolean; due: string | null /* "2026-11-14T09:00" */; doneOn: string | null }

module When {                                   // phrases of every language are read whatever the locale
  parse(text: string, options?: WhenOptions): { start: number; end: number; due: string; label: string } | null;   // start/end: UTF-16 offsets
  normalizeLine(line: string, options?: WhenOptions): string | null;
}
interface WhenOptions {
  locale?: string;       // the label's language: "zh-Hans" (default), "zh-Hant", "en", "ja"; others label in English
  defaultTime?: string;  // "HH:mm" a date alone means, default "09:00"; anything else throws a TypeError
}

class Reminders {                               // fires at due times while the app runs
  constructor(notes: Notes);
  start(onDue: (event: { todos: Todo[]; missed: boolean }) => void): void;  // missed: they came due while the Mac slept
  snooze(note: string, line: number, minutes: number): void;               // in memory: fires again later
}
// The reminders' thread reads the folder again when it changes: a to-do given a new time fires at that time, and a
// snooze of it is dropped (the new time is the reminder now); one whose time was removed fires no more.

module Folder {                                 // the settings' notes folder (src/folder.rs)
  choose(start: string, button: string): Promise<string | null>;
  reveal(path: string): Promise<void>;
  shown(path: string): string;                  // "~/Documents/Jot"
  icloud(): { path: string | null; available: boolean };   // Jot's folder in iCloud Drive; on = signed in + Drive on
  moveNotes(from: string, to: string): Promise<MovedNotes>; // Store::move_into, off the engine thread
}
interface MovedNotes { moved: string[]; renamed: { from: string; to: string }[]; same: string[]; failed: { title: string; error: string }[] }

module Summon {                                 // gestures of a modifier, system-wide
  isTrusted(): boolean;                         // macOS: Accessibility granted
  requestTrust(): void;                         // shows the system prompt / opens the pane
  onDoubleTap(key: "option" | "control", listener: () => void): void;      // replaces the previous listener
  // Tap, then press again and hold 250 ms: start; released: end. Another key or modifier pressed meanwhile ends it
  // with cancelled: true (mouse buttons do not). A second press released sooner is a double tap, never both.
  // Replaces the previous handlers; the key may differ from onDoubleTap's.
  onDoubleTapHold(key: "option" | "control", handlers: { start: () => void; end: (event: { cancelled: boolean }) => void }): void;
}

module Connections {                            // the AI apps jot-mcp is registered with (src/connect.rs, src/connections.rs)
  server(): string | null;                      // jot-mcp: beside the executable (Jot.app/Contents/MacOS), else (debug builds only) this checkout's target/{release,debug}
  translocated(): boolean;                      // Jot runs from App Translocation's temporary path: nothing is connected (move it to Applications)
  clients(dir: string): Promise<AiClient[]>;    // every known app, its state for the notes folder `dir`
  connect(id: string, dir: string): Promise<AiClient>;     // registers `jot-mcp --dir <dir>`; rejects with why
  disconnect(id: string, dir: string): Promise<AiClient>;  // takes the `jot` entry out
  sync(dir: string): Promise<AiClient[]>;       // the folder changed: re-registers every connected app Jot can write (one it cannot stays connected elsewhere, `manual` saying why)
  generic(dir: string): { command: string; json: string }; // for any other app: the command line, the mcpServers JSON
}
interface AiClient {
  id: string;            // "claude-code" | "claude-desktop" | "cursor" | "vscode" | "windsurf" | "codex" | "gemini" | "zed"
  name: string;          // "Claude Code", "Claude", …
  installed: boolean;    // its app bundle or its settings folder is there
  connected: boolean;    // its configuration has `jot`
  current: boolean;      // … with this folder and this jot-mcp
  manual: "no-cli" | "unreadable" | "unsupported" | null;  // why Jot cannot do it itself (then: copy `snippet`)
  config: string;        // "~/.cursor/mcp.json"
  snippet: string;       // Claude Code's command, else the entry its file takes
  error: string | null;  // sync's failure for it
}
// One table (`connect::CLIENTS`) lists the apps: id, name, markers under ~ and app bundles that say it is installed,
// its configuration file and its form: Claude Code through its CLI (`claude mcp remove/add --scope user`; when `add`
// fails after `remove`, the old entry is put back with `claude mcp add-json` and the error says whether it was;
// `claude` looked for in ~/.local/bin, ~/.claude/local, /opt/homebrew/bin, /usr/local/bin, ~/.npm-global/bin,
// ~/.bun/bin, run with a PATH that has node, its output read as it runs, 30 s at most), JSON files (`mcpServers` /
// VS Code's `servers` with "type": "stdio" / Zed's `context_servers`, read only), Codex's TOML (`[mcp_servers.jot]`,
// edited with toml_edit, layout and comments kept). Writes change the `jot` entry only (an entry there keeps its other
// keys); a JSON file is written out again keeping its data, key order, indentation, CRLF and final newline, not its
// other formatting. A file that does not parse strictly, or whose servers are not an object / table, is refused (JSON
// with comments is read for the state, never written). Before Jot's first change the file is copied to
// `<file>.jot.bak` (kept from then on: copied again only when the file has no `jot`, or the backup is gone); the new
// file is a temporary one of its own beside it (`create_new`, the old permissions) renamed over it (a symlink is
// followed; a hard link is not kept). One change at a time per process (a lock around connect, disconnect, sync).
// A translocated Jot connects nothing; sync then keeps each app's command and moves the folder only. Tests run on a
// temporary home (`Env`).

module AiAccess {                                // the AI apps' permission (src/ai_access.rs): ai.json, which jot-mcp reads
  allowsTrashAndRewrite(): boolean;             // off when the file is missing
  set(allowTrashAndRewrite: boolean, language: string): void;  // throws when it cannot be written
}

module NativeBuild {                            // what the installed app was built from (src/native_build.rs)
  fingerprint(): string;                        // its native fingerprint, 16 hex digits; "dev" for a build without one (Updates, below)
}

module InputSource {                            // the keyboard input source selected now
  // Its first language, BCP 47 ("zh-Hans" for Pinyin, "ja", "en"); null where the platform does not say.
  // macOS: Carbon's Text Input Sources, read on the main thread (a promise for the hop).
  language(): Promise<string | null>;
}
```
Dictation listens with `nsh-extra`'s `Speech` (`import { Speech } from "nsh-extra"`; `Cargo.toml` turns on its
`speech` feature, which brings the macOS microphone entitlement); headless tests speak through its fake,
`app.fake("nsh-extra/speech", …)`.
Dictation's language (`app/speechlang.ts`, pure): switched to while listening (the language tag, ⌘L: 中 → EN → 日 →
繁, kept for the run) › chosen in the settings › on "auto", the input source's when it is Chinese or Japanese › the
first of the user's languages that is Chinese, Japanese or English with a region › Jot's language in its usual region.
The notch comes from NSH: `displays()` → `cutouts` (`nsh/desktop`).

## The island writing an AI app's note (app/ui/Island.tsx)

When an AI app writes a note, the island opens inside a glow of flowing colors (the theme's `island-aurora-*`) with a
thin edge of the same colors; the app's avatar falls out of the notch and bounces to rest, and the title's letters rise
in one after another. While the note is written (`T.timing.islandSheen`, 1.3 s) a sheen sweeps the title. Then the
colors give way to a green flash, the label says the note is saved, the avatar hops and the check pops in; after
`T.timing.islandHold` the content lifts out and the island closes. Each step waits for the one before. Reminders and
dictation keep their own motion.

Everything runs natively: the avatar's fall and hop are physics frames computed once in JS and played as
`Animated.keyframes`. NSH draws no blur on a view, so the glow is drawn as a blurred box would look: a turning conic
gradient seen through two nested `maskImage`s whose stops follow a blurred edge's falloff, one across and one down. The
sheen is a full-white copy of the title in a masked band that moves across while the copy in it moves back as much. The
island's window leaves room around it for the glow; it takes no clicks unless a reminder shows. With reduced motion
nothing falls, grows, turns, moves or loops: the glow, the title and the check only fade.

## The open note's Return and ⌘↩ (app/ui/Paper.tsx)

NSH's `Editor` binds Return (a line break) and ⌘↩ (a line below) itself while it has the focus, before the app's
bindings; Jot takes them with `keymap.bind`'s `overFocused`, bound while the editor has the focus (`onFocus` /
`onBlur`). ⌘↩ ticks or unticks the caret's to-do and does nothing on another line (the panel's own ⌘↩, which does
the same while the note's text has no focus, is in app/ui/Panel.tsx). Return is bound only while the caret is on a list
item, a to-do or a quote line outside fenced code with nothing selected (`continuation` in app/markdown.ts says what it
does there), so a line break elsewhere is the editor's own; it writes the line and the next item's start as one
`editor.edit`, which one undo takes back, and falls back to the editor's `newline` command when the caret has left
such a line before the key arrives. ⇧↩ is never bound: a plain break. While an input method composes (pinyin), NSH
gives the bindings no key, so Return commits the letters.

## The open note's live preview (app/markdown.ts, app/ui/Paper.tsx)

The note's text is NSH's `Editor` on the file's Markdown, drawn as Typora draws it: the words as they render, the
syntax hidden, and the syntax back where the caret is. Nothing of the file changes: a hidden range is an
`EditorDecoration` with `label: ""` (shown in place of its text), a stand-in one with a label of its own, and a size a
decoration's `fontSize` / `fontFamily`. `lineMarks(line, touched)` (pure, app/markdown.ts) works out a line's marks and
labels from what of the line the carets and selections cover; Paper.tsx turns them into decorations. While the editor
has no focus, no caret counts: everything shows rendered.

- **Leading syntax**: a heading's `#` and its space, a quote's `>`, a list's `-` / `*` / `+`: shown, muted, while a
  caret or a selection is on the line; hidden otherwise. A bullet then stands for a muted `•`; an ordered item's `1.`
  stays, muted. A heading with no words keeps its `#`.
- **Inline syntax**: emphasis's `**` / `__` / `*` / `_` / `~~`, code's backticks, a link's `[` and `](target)` (an
  image's `![` too): both marks of a span show while a caret or a selection is in it or at either end; hidden
  otherwise. Its words: bold, italic, struck through, in the link colour (an image shows its alt words, no picture),
  code in the code font on a faint fill.
- **Headings**: levels 1 to 3 at 1.5, 1.3 and 1.15 times the body (`T.type.headings`), bold, in the heading colour;
  4 to 6 bold at the body's size. The row grows with its text (NSH grows the line height in proportion).
- **To-dos**: `- [ ]` (dash to bracket) is a drawn box, `- [x]` a filled one with a tick (`labelStyle`); its text
  shows only while a caret or a selection touches it (the caret before the words is past the space, so typing a to-do
  keeps its box). A press on the box lands at its front or its end: either ticks it, as ⌘↩ does, and the caret goes
  before the words. The reminder (⏰) and the done stamp (✅) are drawn as before.
- **Fenced code**: the block's rows tinted (`lineClass`), its text in the code font (`ui-monospace`, NSH's name for
  the system's monospaced font, at `T.type.code`), coloured by the built-in highlighter. Its fences show while a caret
  or a selection is in the block; otherwise the opening fence is its language's name (small, muted) or nothing, and
  the closing one nothing.
- **Quotes**: the row tinted (`lineClass`). A rule (`---`) stays as written, muted: the editor draws no line across.

Selected text is inked by more decorations over the selection (`SELECTED`); they carry a class alone, so labels and
sizes stay as they are, and a line a selection covers shows its syntax anyway. Labelled ranges never overlap (NSH
shows the first of two that do), which `lineMarks` keeps. Dictation's interim words and the time phrase chip are
drawn as before.

## Row actions (app/actions.ts)

One list of actions per row kind drives the action panel (⌘K / Ctrl+K, and a right click on a row:
`app/ui/ActionPanel.tsx`), the footer's primary action (what Return does) and the actions' own keys, which work with the
panel closed. A note: open ↩, show in Finder ⇧⌘F, rename ⌘R (in place, in its row), copy title ⇧⌘C, copy text
⇧⌘A, lock / unlock (no key), move to trash ⌃X (Windows / Linux Ctrl+D; keys in `app/ui/tokens.ts`). A locked note has
"Unlock" for "Lock" and no rename or reminder time; ⌃X on it says to unlock it first (`ERR_JOT_LOCKED`). "New" row: create; today's row: show
to-dos; a to-do: open its note, tick ⌘↩, its reminder time ⇧⌘D (and "Remove Reminder" when it has one); in the open
note, the caret's to-do's reminder time ⇧⌘D. Nothing but a note can be trashed. Moving to the trash folds the row away
and turns the footer into "Moved to the Trash" with Undo for 5 s (`T.timing.undoFor`); while it shows, ⌘Z takes
the trashed notes back one at a time, the last first (an undo stack); then ⌘Z is the search field's again. With the
note's text focused, Ctrl+D stays the editor's (select the next occurrence); macOS's ⌃X is no text key.

The footer (app/ui/Panel.tsx) is Raycast's: no rule above it, a round settings button on the left (a notice or
"Copied" beside it while one shows, else a downloaded update's "Update ready · Restart":
[Updates](#updates-appupdatests)) and on the right a capsule of the primary action and "Actions ⌘K", each a button
that does what its keys do.

## The tray's icon (app/trayink.ts)

A click on the tray's icon summons or hides Jot, and the icon writes itself again: the stroke of `app/ui/tray.svg` is
drawn from its start to its end at a pen's pace (420 ms, slow in and out), then the dot lands, a touch too big, and
settles (160 ms). Each frame is that SVG as a `data:` URL with the stroke dashed up to where the pen is, so it stays a
template the menu bar paints in its text color; at rest the icon is `tray.svg` itself. A click while it writes starts it
again; with reduced motion the icon does not move. `inkFrame` copies the SVG's markup, so a change to `tray.svg` changes
it too (and the stroke's length, `LENGTH`, when the path changes).

## Updates (app/updates.ts)

A packaged Jot updates itself from the GitHub releases (`nsh/updater`, `nsh.json`'s `"updater"`: `github`, the key
that signs the manifest, the roots that certify the packages' release keys). Once it has started, and every 6 hours
while it runs (`CHECK_EVERY`), it checks in this order:

1. **A package of the code** (`checkForPackage`, an OTA update of the TSX, the theme and the translations): taken only
   when it was published for this app's native code, its version's build metadata `+native.<fingerprint>` naming the
   fingerprint built into the app (`NativeBuild.fingerprint()`). It downloads (`downloadPackage`) and runs from Jot's
   next start, or at once on a restart (`restartToPackage`).
2. **Else the whole app** (`checkForUpdate`): it downloads (`downloadUpdate`, a patch from the version before when the
   release has one) and is staged to replace Jot when it quits (`installOnQuit`); a restart installs it at once
   (`installAndRestart`). An update whose `shell` is true is skipped: the running package is already that release's
   code, so it was published for this native code and the app would bring nothing new. One that this copy cannot
   install (it sits where the user cannot write) is offered as a download page in About.

What waits is offered quietly, never in a dialog: "Update ready · Restart" in the panel's footer (when no notice or
"Copied" shows), "Restart to Update to <version>" in the tray's menu, and a Restart button in Settings → About, which
also shows the version that runs (a package's, else the app's: `runningPackage()`, `shellInfo()`), where the updates
stand and "Check for Updates". A check finding what already waits does not download it again. A failed check or
download is logged (`console.warn`, the unified log) and shown only in About's caption; the next check tries again. A
development run (`nsh run`: `shellInfo().version` is null) checks nothing.

**Why the fingerprint.** NSH offers a package to any app whose build is lower and whose runtime is new enough
(`minRuntime`); it knows nothing of Jot's own Rust. A release that changed `jot/native`, jot-store or jot-mcp would
otherwise send its TSX to apps with the old Rust, and jot-mcp, which is not in a package, would never update. The
fingerprint (`scripts/native-fingerprint.sh`) is a SHA-256, cut to 16 hex digits, of what a package cannot carry: the
Rust (`src/`, `store/`, `mcp/`, `build.rs`, `Cargo.toml`, `Cargo.lock`, which also pins the NSH runtime), `nsh.lock`,
`nsh.json` without `version` and `build`, `assets/` and the packaging scripts. `scripts/package-macos.sh` builds the
app with it (`JOT_NATIVE_FINGERPRINT`, read by `option_env!`; a build without it says "dev" and takes no package), and
the release publishes the package as `<version>+native.<fingerprint>`. The app compares the two itself, so a copy any
number of releases behind takes a package only when no release since its own changed native code, and the whole app
otherwise.

`build` in `nsh.json` is one counter for apps and packages: an app runs a package only of a higher build, and an app
update of a higher build drops a package of a lower one. How a release is made:
[CONTRIBUTING.md](../CONTRIBUTING.md#releasing).

## Packaging (scripts/package-macos.sh)

NSH's `nsh package` bundles its runner and the app's assets only, so the script builds `jot-mcp` (in cargo's
`target_directory` from `cargo metadata`; lipo'd for `--arch universal`), removes `<out>/<name>.app` (`--name`, else
nsh.json's), runs `nsh package --target macos` with its options (paths taken from the caller's folder; no ENTRY: it
packages this checkout; `--arch` is `arm64`, `x86_64` or `universal`), copies `jot-mcp` to
`<name>.app/Contents/MacOS/jot-mcp`, signs it, signs the bundle again keeping its entitlements, and verifies
(`codesign --verify --deep --strict`). With `"updater"` in nsh.json, nsh also wrote the update archives
(`<name>-<version>-macos-<aarch64|x86_64>.tar.gz`) before `jot-mcp` was in, so the script archives the signed bundle
again under those names (`tar` with `COPYFILE_DISABLE`, as nsh does). It builds the app's Rust with the native
fingerprint ([Updates](#updates-appupdatests)): `JOT_NATIVE_FINGERPRINT`, or `scripts/native-fingerprint.sh` when it
is not set. `NSH` picks the CLI, which must be the NSH `Cargo.toml`'s `nsh-core` names (a commit of NSH's repository,
`rev`, which a nightly CLI's `--version` names; or a crates.io release; it warns otherwise), `SIGN_IDENTITY` the
identity: ad hoc by default; any other signs both with `--timestamp --options runtime`, as notarization asks.
