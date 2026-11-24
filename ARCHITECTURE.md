# Jot architecture

```
store/   jot-store   pure Rust: the notes folder's format, listing, search, atomic writes, folder watching
mcp/     jot-mcp     stdio MCP server for AI apps, on jot-store
src/     nsh-app-jot the app's Rust crate (`jot/native`): wraps jot-store as a class for App.tsx
App.tsx              the UI (NSH, TSX)
```

The root `Cargo.toml` is the app crate and the workspace (`members = ["store", "mcp"]`).

## Notes folder format

- One note per `.md` file directly in the folder (no subfolders in v1). Other files are ignored.
- The title is the file stem. A title is trimmed; `/`, `\`, `:` and control characters become `-`; an empty
  title, `.` / `..`, or a title starting with `.` is rejected (`StoreError::InvalidTitle`). Titles compare
  case-insensitively for existence checks (macOS file systems are case-insensitive).
- Optional YAML frontmatter at the very top (`---` lines). The only key Jot writes is `source`, on notes created
  through MCP: the app that created it (`source: cursor`, `source: "agent:Goose"`). Only the values Jot writes mark
  a note as an app's; any other `source` (a web clipper's URL, a book) is the user's. Unknown keys are preserved on
  every write. `body` never includes the frontmatter.
- Writes are atomic: a temp file in the same folder, then rename.
- `modified` is the file's mtime.

## jot-store API (store/src/lib.rs)

```rust
pub struct Store { /* root: PathBuf */ }

impl Store {
    /// Opens the folder, creating it if missing.
    pub fn open(root: impl Into<PathBuf>) -> Result<Store, StoreError>;
    pub fn root(&self) -> &Path;
    /// Every note, most recently modified first.
    pub fn list(&self) -> Result<Vec<NoteMeta>, StoreError>;
    /// Case-insensitive match of every whitespace-separated term in the title or body.
    /// Title matches rank first, then by `modified`, newest first. An empty query is `list()` truncated.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, StoreError>;
    pub fn read(&self, title: &str) -> Result<Option<Note>, StoreError>;
    /// Fails with `AlreadyExists` if the title exists.
    pub fn create(&self, title: &str, body: &str, source: Source) -> Result<NoteMeta, StoreError>;
    /// Replaces the body (creates the note as `Source::User` if missing); keeps the frontmatter. The app's editor saves with it.
    pub fn write(&self, title: &str, body: &str) -> Result<NoteMeta, StoreError>;
    /// Appends `text` after one blank line. Fails with `NotFound`.
    pub fn append(&self, title: &str, text: &str) -> Result<NoteMeta, StoreError>;
    /// Fails with `NotFound` / `AlreadyExists`.
    pub fn rename(&self, from: &str, to: &str) -> Result<NoteMeta, StoreError>;
    /// Deletes the file for good. Only the app calls it (the app's own delete goes through `trash`).
    pub fn delete(&self, title: &str) -> Result<(), StoreError>;
    /// Moves the note to the system trash (macOS: NSFileManager, remembering where it went; elsewhere the
    /// `trash` crate). Fails with `NotFound`. The MCP server never calls it.
    pub fn trash(&self, title: &str) -> Result<Trashed, StoreError>;
    /// Moves it back out of the trash, or rebuilds it from `Trashed::content` (frontmatter included, mtime kept)
    /// when the trash no longer has it or the platform did not say where it went. `AlreadyExists` when the
    /// title is taken.
    pub fn restore(&self, trashed: &Trashed) -> Result<NoteMeta, StoreError>;
    /// The note's file, if any.
    pub fn path(&self, title: &str) -> Result<Option<PathBuf>, StoreError>;
    /// Calls `on_change` (debounced ~150 ms) when `.md` files in the folder change. Dropping the `Watcher` stops it.
    pub fn watch(&self, on_change: impl Fn() + Send + 'static) -> Result<Watcher, StoreError>;
}

pub struct NoteMeta { pub title: String, pub modified: SystemTime, pub source: Source, pub preview: String /* first ~120 chars of the body, one line */ }
pub struct Note { pub meta: NoteMeta, pub body: String }
pub struct SearchHit { pub meta: NoteMeta, pub snippet: String /* ~120 chars around the first body match, or the preview */, pub title_match: bool }
pub struct Trashed { pub title: String, pub in_trash: Option<PathBuf>, pub content: String, pub modified: SystemTime }  // non_exhaustive
/// Who created a note: the user, or an AI app by its key (`claude`, `claude-code`, `cursor`, `codex`, `vscode`,
/// `windsurf`, `gemini`, `zed`; `agent` for one that gave no name) or, for an app Jot does not know,
/// `agent:<the name it gave itself>`.
pub enum Source { User, Agent(String) }
impl Source {
    pub fn agent(key: impl Into<String>) -> Source;
    /// From an MCP client's `clientInfo.name`: Claude's apps by their exact names (`claude-ai` → `claude`,
    /// `claude-code`; a `claude-dev` is not Claude), the others by what their names contain (`cursor-vscode` →
    /// `cursor`, `Visual Studio Code` → `vscode`, …); any other as `agent:<name>` (one line, ≤ 64 chars, no quotes or
    /// backslashes).
    pub fn from_client(name: &str) -> Source;
    /// The name shown: "Claude", "Claude Code", "Cursor", "VS Code", "Gemini CLI", …, the name after `agent:`, "AI"
    /// for `agent`; None for the user.
    pub fn label(&self) -> Option<String>;
}
pub enum StoreError { InvalidTitle, NotFound, AlreadyExists, Io(std::io::Error) }  // Display + std::error::Error
pub struct Watcher { /* … */ }
```

Structs derive `Debug, Clone` (and `PartialEq` where it makes sense). The frontmatter's `source` is written as the
key, double-quoted unless YAML reads it as that plain string (`cursor`; but `"agent:Goose"`, and never a bare `true`,
`null`, number or `-…`). Reading takes the top-level `source` line only (not an indented one), its value unquoted and
without a trailing `# comment`: a known key or `agent` in any case is that app (`Claude` → `claude`: notes from before
the apps were told apart say `claude`), `agent:<name>` the app of that name, and anything else (URLs, book titles,
`user`, empty) the user. An older Jot reads `source: cursor` and the like as the user's (it knew `claude` only).

## To-dos (store/src/todo.rs, part of jot-store)

A to-do is a Markdown task line in any note: `- [ ] text`, `- [x] text ✅ 2026-11-14`. A reminder time is written as
` ⏰ YYYY-MM-DD HH:mm` (local time, no zone; the Obsidian Reminder plugin's form). Relative phrases are only an input
form: they are turned into this absolute form when a line is committed, never stored.

```rust
pub use jiff::civil::DateTime;   // local wall-clock time

pub struct Todo {
    pub note: String,            // the note's title
    pub line: usize,             // 0-based line in the note's body
    pub text: String,            // the line's text without the box, the ⏰ and ✅ parts
    pub done: bool,
    pub due: Option<DateTime>,
    pub done_on: Option<jiff::civil::Date>,
}

impl Store {
    /// Every to-do in every note; open ones first, by due time (none last), then by note `modified`.
    pub fn todos(&self) -> Result<Vec<Todo>, StoreError>;
    /// Checks or unchecks the to-do at `line` of `note`, if that line's text is still `text`
    /// (else `StoreError::Changed`); checking adds ` ✅ <today>`, unchecking removes it.
    pub fn set_todo_done(&self, note: &str, line: usize, text: &str, done: bool, today: jiff::civil::Date) -> Result<NoteMeta, StoreError>;
    /// Sets (`Some`) or clears (`None`) the reminder of the to-do at `line` of `note`, if that line's text is
    /// still `text` (else `StoreError::Changed`): a time it has is replaced where it is written, a new one goes at
    /// the end (before a done stamp). The reminder time picker of the to-do view and `reschedule_todo` write with it.
    pub fn set_todo_due(&self, note: &str, line: usize, text: &str, due: Option<DateTime>) -> Result<NoteMeta, StoreError>;
    /// Appends `- [ ] text[ ⏰ due]` to `note` (default "待办", created as needed, with `source`).
    pub fn add_todo(&self, note: Option<&str>, text: &str, due: Option<DateTime>, source: Source) -> Result<Todo, StoreError>;
}

pub mod when {                   // store/src/when/: mod.rs (driver, labels), zh.rs, en.rs, ja.rs
    /// The first time phrase in `text`, in any of the languages, mixed or not (zh-Hans / zh-Hant: 今天 / 明天 /
    /// 后天 / 後天, 周一…周日 / 週一, 下周五 / 下週五, 11月20日, 20号 / 20號, 9点 / 9點, 下午3点, 半小时后 / 半小時後;
    /// en: today / tomorrow / the day after tomorrow, mon…sun / monday…sunday, next friday, nov 20 / 20 nov / 11/20,
    /// 9am / 3:30 pm / 15:00 / noon, tonight, this afternoon, in 30 min / in half an hour / in 2 hours; ja: 今日 /
    /// 明日 / 明後日, 月曜…日曜 / 月曜日, 来週の金曜, 11月20日, 20日, 9時 / 9時半 / 午後3時, 30分後 / 2時間後),
    /// numbers in Chinese numerals / kanji as speech-to-text writes them (九点, 三点半, 十一点四十五, 十二点零五,
    /// 三点一刻, 十一月二十号, 二十号, 半个小时后, 九時, 三時半; a numeral hour on its own is no time when it reads as
    /// something else: 一点 without minutes, 第三点, 三点意见, 一時停止), as a byte range, the time, and a short
    /// label in `options.lang`. An hour without a part of the day or am / pm (九点, 3点, 3:30, 三時, `at 4`):
    /// 1–6 is the afternoon's (13:00–18:00), 7–12, 0 and 13–23 as written (`03:00` with its leading zero too); then
    /// the next one from `now` (tomorrow once past), with or without a date.
    pub fn parse_with(text: &str, now: DateTime, options: &Options) -> Option<When>;
    /// `parse_with` with `Options::default()` (a date alone is 09:00, the label zh-Hans).
    pub fn parse(text: &str, now: DateTime) -> Option<When>;
    pub struct When { pub range: std::ops::Range<usize>, pub at: DateTime, pub label: String }
    pub struct Options { pub default_time: jiff::civil::Time /* a date alone; 09:00 */, pub lang: Lang /* ZhHans */ }
    /// The label's language: zh-Hans "明天 09:00" / "周五 15:00" / "11月20日 09:00", zh-Hant "後天 09:00" /
    /// "週五 15:00", en "Tomorrow 9:00 AM" / "Fri 3:00 PM" / "Nov 20 9:00 AM", ja "明日 9:00" / "金曜 15:00" /
    /// "11月20日 9:00". Today / tomorrow / (the day after, where the language has a word) / the weekday within the
    /// coming week / the month and day.
    pub enum Lang { ZhHans, ZhHant, En, Ja }
    impl Lang { pub fn from_locale(locale: &str) -> Lang; }  // "zh-TW" / "zh-Hant" → ZhHant, other zh → ZhHans, ja, else En
    /// A to-do line with its phrase replaced by ` ⏰ YYYY-MM-DD HH:mm` (whatever the language), or None when it
    /// has none / is not an open to-do.
    pub fn normalize_line_with(line: &str, now: DateTime, options: &Options) -> Option<String>;
    pub fn normalize_line(line: &str, now: DateTime) -> Option<String>;   // with Options::default()
}
```
`StoreError` gains `Changed`.

MCP tools (mcp/): `create_note` and `add_todo` record the calling app as the new note's `source`
(`Source::from_client` of the `initialize` handshake's `clientInfo.name`). `add_todo(text, due?, note?)` (`due`: ISO `2026-11-14T09:00` or a phrase `when::parse` reads, in
Chinese, English or Japanese; without `due`, a phrase in `text` becomes the time),
`list_todos(range?)` (`overdue` | `today` | `upcoming` | `all`, default `today`+`overdue`), `complete_todo(note, text)`,
`reschedule_todo(note, text, due)` (`due` required: ISO or a phrase `when::parse` reads; `null` removes the reminder;
only the `⏰` part of the line changes). The last two find the open to-do the same way: the exact text, else the one
whose text holds it; several or none fail, listing the candidates.

## Packaging (scripts/package-macos.sh)

NSH's `nsh package` bundles its runner and the app's assets only, so the script builds `jot-mcp` (in cargo's
`target_directory` from `cargo metadata`; lipo'd for `--arch universal`), removes `<out>/<name>.app` (`--name`, else
nsh.json's), runs `nsh package --target macos` with its options (paths taken from the caller's folder; no ENTRY: it
packages this checkout; `--arch` is `arm64`, `x86_64` or `universal`), copies `jot-mcp` to
`<name>.app/Contents/MacOS/jot-mcp`, signs it, signs the bundle again keeping its entitlements, and verifies
(`codesign --verify --deep --strict`). `NSH` picks the CLI (0.6.0), `SIGN_IDENTITY` the identity: ad hoc by default;
any other signs both with `--timestamp --options runtime`, as notarization asks.

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
  todos(): Todo[];
  setTodoDone(note: string, line: number, text: string, done: boolean): NoteMeta;
  setTodoDue(note: string, line: number, text: string, due: string | null /* "YYYY-MM-DDTHH:mm", else TypeError; null removes */): NoteMeta;  // ERR_JOT_CHANGED
  addTodo(text: string, due?: string | null /* "YYYY-MM-DDTHH:mm", else TypeError */, note?: string | null /* "待办" */): Todo;
}
interface NoteMeta { title: string; modified: number /* ms since epoch */; source: string | null /* null: the user; else the AI app's name, "Cursor" */; preview: string }
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

module InputSource {                            // the keyboard input source selected now
  // Its first language, BCP 47 ("zh-Hans" for Pinyin, "ja", "en"); null where the platform does not say.
  // macOS: Carbon's Text Input Sources, read on the main thread (a promise for the hop).
  language(): Promise<string | null>;
}
```
Dictation's language (`app/speechlang.ts`, pure): switched to while listening (the language tag, ⌘L: 中 → EN → 日 →
繁, kept for the run) › chosen in the settings › on "auto", the input source's when it is Chinese or Japanese › the
first of the user's languages that is Chinese, Japanese or English with a region › Jot's language in its usual region.
The notch comes from NSH: `displays()` → `cutouts` (`nsh/desktop`).

## The reminder time picker (app/due.ts, ui/DuePicker.tsx)

One picker for the open note and the to-do view: an `Overlay` in the panel's window, anchored to the time chip
(`EditorRef.rangeBounds` of the `⏰` range gives its box in the window; the line's end for a to-do without a time) or
to the to-do row's due label (a `ViewRef`). It opens from a press on the chip (`onTextPress`) or the label, from
⇧⌘D (`T.keys.due`, Things' deadline key, free in the editor and the panel; Ctrl+Shift+D elsewhere) and from the
action panel ("Reminder Time…", in the note while the caret is on an open to-do; on a to-do row "Reminder Time…" /
"Add Reminder…" and "Remove Reminder"). Quick choices first (in an hour, this evening 20:00, tomorrow and next Monday
at the settings' time for a date alone; those past or repeated left out: `quickChoices` in app/time.ts), then
`Calendar` and `TimeField`, set with the button or ⌘↩, then "Remove Reminder". It opens with the first choice focused:
↑↓ move among the choices, Return picks, Tab reaches the calendar and the field, Escape closes (its keys are bound
after the panel's, so they win). The open note writes through `editor.edit` (the changed part of the line only:
undo takes it back in one step and the caret stays; `withDue` in app/tasks.ts mirrors `set_todo_due`); the to-do
view through `Notes.setTodoDue`, its row following to its new group, still selected.

## Row actions (app/actions.ts)

One list of actions per row kind drives the action panel (⌘K / Ctrl+K, and a right click on a row:
`ui/ActionPanel.tsx`), the footer's primary action (what Return does) and the actions' own keys, which work with the
panel closed. A note: open ↩, show in Finder ⇧⌘F, rename ⌘R (in place, in its row), copy title ⇧⌘C, copy text
⇧⌘A, move to trash ⌃X (Windows / Linux Ctrl+D; keys in `ui/tokens.ts`). "New" row: create; today's row: show
to-dos; a to-do: open its note, tick ⌘↩, its reminder time ⇧⌘D (and "Remove Reminder" when it has one); in the open
note, the caret's to-do's reminder time ⇧⌘D. Nothing but a note can be trashed. Moving to the trash folds the row away
and turns the footer into "Moved to the Trash" with Undo for 5 s (`T.timing.undoFor`); while it shows, ⌘Z takes
the trashed notes back one at a time, the last first (an undo stack); then ⌘Z is the search field's again. With the
note's text focused, Ctrl+D stays the editor's (select the next occurrence); macOS's ⌃X is no text key.
