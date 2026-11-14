# Jot architecture

```
store/   jot-store   pure Rust: the notes folder's format, listing, search, atomic writes, folder watching
mcp/     jot-mcp     stdio MCP server for Claude, on jot-store
src/     nsh-app-jot the app's Rust crate (`jot/native`): wraps jot-store as a class for App.tsx
App.tsx              the UI (NSH, TSX)
```

The root `Cargo.toml` is the app crate and the workspace (`members = ["store", "mcp"]`).

## Notes folder format

- One note per `.md` file directly in the folder (no subfolders in v1). Other files are ignored.
- The title is the file stem. A title is trimmed; `/`, `\`, `:` and control characters become `-`; an empty
  title, `.` / `..`, or a title starting with `.` is rejected (`StoreError::InvalidTitle`). Titles compare
  case-insensitively for existence checks (macOS file systems are case-insensitive).
- Optional YAML frontmatter at the very top (`---` lines). The only key Jot writes is `source: claude`, on notes
  created through MCP. Unknown keys are preserved on every write. `body` never includes the frontmatter.
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
    /// Moves the note to the system trash is out of scope for v1: deletes the file. Only the app calls it.
    pub fn delete(&self, title: &str) -> Result<(), StoreError>;
    /// Calls `on_change` (debounced ~150 ms) when `.md` files in the folder change. Dropping the `Watcher` stops it.
    pub fn watch(&self, on_change: impl Fn() + Send + 'static) -> Result<Watcher, StoreError>;
}

pub struct NoteMeta { pub title: String, pub modified: SystemTime, pub source: Source, pub preview: String /* first ~120 chars of the body, one line */ }
pub struct Note { pub meta: NoteMeta, pub body: String }
pub struct SearchHit { pub meta: NoteMeta, pub snippet: String /* ~120 chars around the first body match, or the preview */, pub title_match: bool }
pub enum Source { User, Claude }
pub enum StoreError { InvalidTitle, NotFound, AlreadyExists, Io(std::io::Error) }  // Display + std::error::Error
pub struct Watcher { /* … */ }
```

Structs derive `Debug, Clone` (and `PartialEq` where it makes sense); `Source` is `Copy`.

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
    /// Appends `- [ ] text[ ⏰ due]` to `note` (default "待办", created as needed, with `source`).
    pub fn add_todo(&self, note: Option<&str>, text: &str, due: Option<DateTime>, source: Source) -> Result<Todo, StoreError>;
}

pub mod when {                   // store/src/when/: mod.rs (driver, labels), zh.rs, en.rs, ja.rs
    /// The first time phrase in `text`, in any of the languages, mixed or not (zh-Hans / zh-Hant: 今天 / 明天 /
    /// 后天 / 後天, 周一…周日 / 週一, 下周五 / 下週五, 11月20日, 20号 / 20號, 9点 / 9點, 下午3点, 半小时后 / 半小時後;
    /// en: today / tomorrow / the day after tomorrow, mon…sun / monday…sunday, next friday, nov 20 / 20 nov / 11/20,
    /// 9am / 3:30 pm / 15:00 / noon, tonight, this afternoon, in 30 min / in half an hour / in 2 hours; ja: 今日 /
    /// 明日 / 明後日, 月曜…日曜 / 月曜日, 来週の金曜, 11月20日, 20日, 9時 / 9時半 / 午後3時, 30分後 / 2時間後),
    /// as a byte range, the time, and a short label in `options.lang`.
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

MCP tools (mcp/): `add_todo(text, due?, note?)` (`due`: ISO `2026-11-14T09:00` or a phrase `when::parse` reads, in
Chinese, English or Japanese; without `due`, a phrase in `text` becomes the time),
`list_todos(range?)` (`overdue` | `today` | `upcoming` | `all`, default `today`+`overdue`), `complete_todo(note, text)`.

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
  rename(from: string, to: string): NoteMeta;
  delete(title: string): void;
  watch(onChange: () => void): void;            // folder changed (debounced); replaces the previous listener
  todos(): Todo[];
  setTodoDone(note: string, line: number, text: string, done: boolean): NoteMeta;
}
interface NoteMeta { title: string; modified: number /* ms since epoch */; source: "user" | "claude"; preview: string }
interface Note { meta: NoteMeta; body: string }
interface SearchHit { meta: NoteMeta; snippet: string; titleMatch: boolean }
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

module Summon {                                 // double-tap of a modifier, system-wide
  isTrusted(): boolean;                         // macOS: Accessibility granted
  requestTrust(): void;                         // shows the system prompt / opens the pane
  onDoubleTap(key: "option" | "control", listener: () => void): void;      // replaces the previous listener
}
```
The notch comes from NSH: `displays()` → `cutouts` (`nsh/desktop`).
