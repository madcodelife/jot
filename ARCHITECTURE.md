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
- Optional YAML frontmatter at the very top (`---` lines). Jot writes two keys: `source`, on notes created through
  MCP: the app that created it (`source: cursor`, `source: "agent:Goose"`), and `locked: true` on a locked note
  (below). Only the values Jot writes mark a note as an app's; any other `source` (a web clipper's URL, a book) is
  the user's. Unknown keys are preserved on every write. `body` never includes the frontmatter.
- Writes are atomic: a temp file in the same folder, then rename.
- `modified` is the file's mtime.

## A synced folder (iCloud Drive; store/src/cloud.rs)

Jot does no syncing itself; the folder may sit in iCloud Drive (Settings › General › iCloud Drive moves it there,
below). Two things a synced folder does that a local one does not:

- **Notes not on this Mac.** With "Optimize Mac Storage" on, iCloud Drive moves notes it thinks unused off the Mac.
  On macOS 14 and later (iCloud Drive is a File Provider) the file stays under its own name as a *dataless* file:
  `stat` works and shows its size and dates, `st_flags` has `SF_DATALESS` (0x40000000), and the first read
  downloads it, blocking the reader as long as that takes (indefinitely offline). Older systems left a hidden
  placeholder, `.<title>.md.icloud`, in its place. jot-store handles both and never waits:
  - reads go through `Cloud::read`, which turns the thread's dataless materialization off
    (`setiopolicy_np(IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES, IOPOL_SCOPE_THREAD, OFF)`) so a dataless file fails
    at once with `EDEADLK` instead of downloading; the flag is also checked first;
  - such a note is listed all the same, `NoteMeta::downloading` set, its preview empty, its source the user, its
    body empty (search matches its title only, `todos` has none of its to-dos until it is here), and the system is
    asked for it: `NSFileManager startDownloadingUbiquitousItemAtURL:` (another File Provider, which that call
    refuses, gets a thread of its own that reads one byte: one per file at a time);
  - anything that changes it (`write`, `append`, the to-do edits, `trash`; `rename` of a placeholder) fails with
    `StoreError::NotDownloaded` and leaves it as it is; renaming a dataless file needs no download and works;
  - the watcher also reports placeholders coming and going; the app reads the folder again every 2 s while a note
    is downloading, as a file filled in place may not reach the watcher.
- **Conflicts.** When a note changed on two devices before either synced, iCloud keeps one version as the file and
  the others as unresolved conflict versions (`NSFileVersion`); `Store::conflicts` lists them (checked with the
  URL's `NSURLUbiquitousItemHasUnresolvedConflictsKey` first: about a millisecond, so `read` paths can afford it)
  and `Store::resolve` settles one: keep this Mac's, use the other (its whole file replaces the note), or keep
  both (the other becomes a note of its own, `Title (iPhone)`, numbered when taken, dated when it was saved). The
  version is then marked resolved (`NSFileVersion.resolved`); other versions are left to iCloud. Two devices
  creating the same title each keep theirs, the second as `Title 2.md`: two notes, nothing lost, nothing to do.

No `NSFileCoordinator`. Jot writes with a temporary file renamed over the note (`write_file`), without file
coordination: iCloud Drive on macOS 14+ is a File Provider that sees every change to its folder, coordinated or
not, and the atomic rename means it never uploads half a note. A coordinated write would block the caller (the
engine thread, for the editor's autosave) while another process holds the file, for a download for instance, which
Jot must never do. The race left (a version from another device landing between Jot's read and its rename) ends as
an iCloud conflict, which Jot shows and lets the user settle, so nothing is lost. Checked on macOS 27 with iCloud
Drive: renamed-over writes upload (`NSURLUbiquitousItemIsUploadedKey`) and leave no conflict version.

`Cloud` is the seam (`cloud::system()`: iCloud through Foundation on macOS, nothing elsewhere); the tests stand
in for it (`store/src/cloud_tests.rs`: placeholders as real files, dataless files and conflict versions faked).
`on_icloud_drive` (ignored) runs the store on a real iCloud Drive folder: `JOT_ICLOUD_DIR=<a test folder in iCloud
Drive> cargo test -p jot-store on_icloud_drive -- --ignored --nocapture`.

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
    /// `trash` crate). Fails with `NotFound`. The app's ⌃X and `trash_note` call it.
    pub fn trash(&self, title: &str) -> Result<Trashed, StoreError>;
    /// The trash a plain folder instead of the system's (tests: nothing reaches the user's trash).
    pub fn with_trash_folder(self, dir: impl Into<PathBuf>) -> Store;
    /// Rewrites the whole body, the frontmatter kept. The file as it was (frontmatter included, mtime kept) is written
    /// under `previous(title)` in a temporary folder outside the notes folder and trashed from there first; if that
    /// fails the note stays. The same body changes nothing (`previous: None`). `replace_note` calls it.
    pub fn replace(&self, title: &str, body: &str, previous: impl FnOnce(&str) -> String) -> Result<Replaced, StoreError>;
    /// Locks / unlocks (below). `settle_locks` puts back a missing half of each lock; returns the titles it changed.
    pub fn lock(&self, title: &str) -> Result<NoteMeta, StoreError>;
    pub fn unlock(&self, title: &str) -> Result<NoteMeta, StoreError>;
    pub fn settle_locks(&self) -> Result<Vec<String>, StoreError>;
    /// Moves it back out of the trash, or rebuilds it from `Trashed::content` (frontmatter included, mtime kept)
    /// when the trash no longer has it or the platform did not say where it went. `AlreadyExists` when the
    /// title is taken.
    pub fn restore(&self, trashed: &Trashed) -> Result<NoteMeta, StoreError>;
    /// The note's file, if any.
    pub fn path(&self, title: &str) -> Result<Option<PathBuf>, StoreError>;
    /// Calls `on_change` (debounced ~150 ms) when `.md` files in the folder change, or an older iCloud Drive's
    /// placeholders of them. Dropping the `Watcher` stops it.
    pub fn watch(&self, on_change: impl Fn() + Send + 'static) -> Result<Watcher, StoreError>;
    /// The other versions iCloud kept in a conflict, newest first (empty for most notes). `NotFound`.
    pub fn conflicts(&self, title: &str) -> Result<Vec<Conflict>, StoreError>;
    /// Settles the conflict version `id`. `Changed` when it is settled already.
    pub fn resolve(&self, title: &str, id: &str, resolution: Resolution) -> Result<Resolved, StoreError>;
    /// Moves every note into `to`, never over a note there: the very same text stays here (`same`), another text
    /// moves in as `Title 2`… (`renamed`); a note not downloaded moves when the move is a rename (one volume),
    /// else stays (`failed`). Files that are not notes stay. Dates and frontmatter are kept.
    pub fn move_into(&self, to: &Store) -> Result<Moved, StoreError>;
}

pub struct Conflict { pub id: String, pub device: Option<String>, pub modified: SystemTime, pub body: String }  // non_exhaustive
pub enum Resolution { KeepCurrent, UseOther, KeepBoth { title: String } }
pub struct Resolved { pub note: NoteMeta, pub copy: Option<NoteMeta> }  // non_exhaustive
pub struct Moved { pub moved: Vec<String>, pub renamed: Vec<(String, String)>, pub same: Vec<String>, pub failed: Vec<(String, String)> }  // non_exhaustive

pub struct NoteMeta { pub title: String, pub modified: SystemTime, pub source: Source, pub preview: String /* first ~120 chars of the body, one line */, pub downloading: bool /* its text is not on this Mac yet; asked for */, pub locked: bool /* the flag, or `locked: true` */ }
pub struct Note { pub meta: NoteMeta, pub body: String }
pub struct SearchHit { pub meta: NoteMeta, pub snippet: String /* ~120 chars around the first body match, or the preview */, pub title_match: bool }
pub struct Trashed { pub title: String, pub in_trash: Option<PathBuf>, pub content: String, pub modified: SystemTime }  // non_exhaustive
pub struct Replaced { pub note: NoteMeta, pub previous: Option<Trashed> }  // non_exhaustive
/// Jot's settings for AI apps, a file the app writes and jot-mcp reads (below).
pub struct AiSettings { pub allow_trash_and_rewrite: bool, pub language: Option<String> }  // non_exhaustive
impl AiSettings { pub fn path(home: &Path) -> PathBuf; pub fn default_path() -> Option<PathBuf>; pub fn read(path: &Path) -> AiSettings /* missing, broken: off */; pub fn write(&self, path: &Path) -> io::Result<()>; }
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
pub enum StoreError { InvalidTitle, NotFound, AlreadyExists, NotDownloaded, Locked, Io(std::io::Error) }  // Display + std::error::Error
pub struct Watcher { /* … */ }
```

Structs derive `Debug, Clone` (and `PartialEq` where it makes sense). The frontmatter's `source` is written as the
key, double-quoted unless YAML reads it as that plain string (`cursor`; but `"agent:Goose"`, and never a bare `true`,
`null`, number or `-…`). Reading takes the top-level `source` line only (not an indented one), its value unquoted and
without a trailing `# comment`: a known key or `agent` in any case is that app (`Claude` → `claude`: notes from before
the apps were told apart say `claude`), `agent:<name>` the app of that name, and anything else (URLs, book titles,
`user`, empty) the user. An older Jot reads `source: cursor` and the like as the user's (it knew `claude` only).

## Locked notes (store/src/lock.rs)

A lock is two marks, either of which makes the note locked (`NoteMeta::locked`):

- **The file's `UF_IMMUTABLE` flag** (`chflags uchg`, Finder's Get Info › Locked), so that no other program changes it.
- **`locked: true` in the frontmatter** (a top-level line, `true` in any case, quoted or not, a `# comment` after
  it allowed), so the lock travels with the text to other devices.

Every write of the store (`write`, `append`, `set_todo_done`, `set_todo_due`, `add_todo` into the note, `rename`,
`delete`, `trash`, `replace`, `resolve` with `UseOther`) checks both before it touches the file and fails with
`StoreError::Locked`, the file left as it was. `lock` writes the frontmatter (mtime kept: locking is no change of
the note; the write sets the time on the temporary file before the rename) and then the flag; `unlock` clears the
flag, then takes the line out (a frontmatter left empty goes), and sets the flag back if that write fails.
`settle_locks` (the app calls it when it opens a folder and on every change the watcher reports) puts back the flag
on a note whose frontmatter says locked, and writes the frontmatter of a note with the flag alone (clearing the
flag for the write and setting it again after, also when the write fails). Notes not downloaded wait. Its own
changes come back through the watcher with nothing left to do. A note unlocked in Finder alone is locked again by
it while the frontmatter says so: unlocking is Jot's. `move_into` moves a locked note locked: a flag-only one gets
the frontmatter first; the flag is cleared for the rename (or, across volumes, the copy and the removal) and set
on the file that is left; on a failure, on the one still here (and on a copy already made).

What the system does with the flag, checked on macOS 27 (APFS):

- On a file with it, `rm`, `rm -f`, `mv`, a write (`>`, `>>`), a rename over it (an atomic save), renaming it,
  `touch`, `chmod` and `xattr -w` all fail with `EPERM`; `rm -rf` of its folder leaves the folder ("Directory not
  empty"), though the folder itself can be renamed. `NSFileManager trashItemAtURL:` refuses it
  (`NSCocoaErrorDomain` 513); nothing reaches the trash. Reading is unaffected.
- The file's owner clears it without `sudo` (`chflags nouchg`, Finder): the flag stops mistakes and programs that
  respect it, not one that sets out to change the file.
- FSEvents reports setting and clearing it (`kFSEventStreamEventFlagItemInodeMetaMod`), and `notify`'s debouncer
  passes it on: the folder's watcher fires (`the_watcher_sees_the_flag_change`).

What iCloud Drive does with it, checked on macOS 27 with one Mac signed in, in a test folder in iCloud Drive:

- Measured: when it uploads a file's new contents (a new file, changed text, a file moved in), it clears the flag
  within about a second, on the same inode. A flag set on a file already uploaded, with no change to its text,
  stays (watched for 30 s), as it does through an eviction (`brctl evict`: dataless and flagged) and the download
  back. No extended attribute carries it.
- Not measurable with one Mac, inferred: the flag does not reach other devices (it is cleared at upload, and no
  attribute holds it). So the frontmatter carries the lock, and `settle_locks` sets the flag on each Mac: a note
  locked in Jot on iCloud Drive is unflagged for about a second after its upload, until the watcher's report brings
  the flag back. `lock_on_icloud_drive` (ignored) runs this on a real folder: `JOT_ICLOUD_DIR=<a test folder in
  iCloud Drive> cargo test -p jot-store lock_on_icloud_drive -- --ignored --nocapture` (measured: cleared ~1.1 s
  after the lock; set again, it stayed).

## AI apps removing and rewriting notes (store/src/settings.rs, mcp/)

`trash_note` and `replace_note` work only while the user allows it: Settings › AI Apps › "Allow AI apps to move
notes to the Trash and rewrite notes", off by default. `jot-mcp` runs in each AI app's process, started by the app
with the arguments written in its configuration, so the setting cannot be an argument (changing it would mean
rewriting every app's configuration and restarting the apps) nor in NSH's Storage (the app's alone). It is a file
outside the notes folder that the app writes and `jot-mcp` reads on every call of the two tools (and as it starts,
for its instructions): `~/Library/Application Support/Jot/ai.json`, `{"allowTrashAndRewrite": true, "language":
"zh-Hans"}` (`AiSettings`; missing or unreadable is off). The language is the one Jot shows, which names a
rewritten note's previous version: `Plan (before rewrite · 2026-11-25 14.30)`, `计划（改写前 · …）`, `計劃（改寫前 · …）`,
`計画（書き換え前 · …）` (no colon: Finder shows one as a slash; the title shortened to fit 255 bytes).

The tools stay listed while the setting is off and refuse with where to turn it on: a changing tool list needs the
client to follow `notifications/tools/list_changed`, which not every client does, and `jot-mcp` would have to watch
the file; a listed tool that explains itself lets the model tell the user how to allow it. Both are annotated
`destructiveHint: true`, `readOnlyHint: false`, `openWorldHint: false` and `idempotentHint: true` (`trash_note`
again finds nothing to trash; `replace_note` with the same body changes nothing and trashes nothing). The server's
instructions say how the setting stood as the app connected, to use the tools only when asked, and to list the
notes and ask before removing many at once. `replace_note` refuses an empty body and a body that starts with a `---`
frontmatter block (it would become the note's frontmatter); the note's own frontmatter is kept.

The switch is about Jot's tools: an app that runs shell commands can edit the file, or the notes, itself; locking
a note is what keeps it as it is.

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

MCP tools (mcp/) never wait on a download unbounded: a tool that needs a note's text (`read_note`, `append_note`,
`add_todo`, `complete_todo`, `reschedule_todo`) waits up to 20 s for a note iCloud is downloading, then says it is
still downloading (`NotDownloaded`); listings mark such a note "not downloaded to this Mac yet"; `read_note`
mentions conflict versions iCloud kept.

MCP tools (mcp/) on a locked note: reading, searching, listing and `list_todos` go on (listings and `read_note` say
"locked in Jot (read-only)"); every tool that writes fails with "locked in Jot … the user unlocks it in Jot first".
No tool locks or unlocks.

MCP tools (mcp/): `create_note` and `add_todo` record the calling app as the new note's `source`
(`Source::from_client` of the `initialize` handshake's `clientInfo.name`). `add_todo(text, due?, note?)` (`due`: ISO `2026-11-14T09:00` or a phrase `when::parse` reads, in
Chinese, English or Japanese; without `due`, a phrase in `text` becomes the time),
`list_todos(range?)` (`overdue` | `today` | `upcoming` | `all`, default `today`+`overdue`), `complete_todo(note, text)`,
`reschedule_todo(note, text, due)` (`due` required: ISO or a phrase `when::parse` reads; `null` removes the reminder;
only the `⏰` part of the line changes). The last two find the open to-do the same way: the exact text, else the one
whose text holds it; several or none fail, listing the candidates.

## The app and a synced folder

The list shows a note not downloaded with a cloud and "Downloading…"; opened, the editor is read-only and empty,
says so, and takes the text when it lands. A note with conflict versions shows a bar over its text: "Keep This
Mac's", "Use the Other", "Keep Both" (the other as `Title (iPhone)`), one version at a time, the open note's edits
saved first. Settings › General › iCloud Drive: "Move to iCloud Drive…" (disabled, saying why, while iCloud Drive
is off: `Folder.icloud`), asks first (`AlertDialog`), moves the notes to `~/Library/Mobile
Documents/com~apple~CloudDocs/Jot` (`moveNotesTo` in app/store.ts: `Folder.moveNotes`, then `changeFolder`, which
the connected AI apps follow), and says what it did; a folder already in iCloud Drive shows "In iCloud Drive".

With no folder stored (`jot.dir`), `openFolder` takes `defaultFolder`: Jot's folder in iCloud Drive when
`Folder.icloud` says it is on, else `~/Documents/Jot`; a Mac already welcomed (`jot.welcomed`, an earlier version)
keeps `~/Documents/Jot`. The folder taken is stored, so iCloud Drive turned off or on later does not move Jot.

## The app and locked notes

`isLocked(title)` (app/store.ts) reads `NoteMeta.locked` from the listing, so a lock set or cleared anywhere (another
Mac through the frontmatter, Finder, `chflags`) shows at the watcher's next report, after `settleLocks`. The open
note (ui/Paper.tsx) is read-only while locked (`readOnly`: the editor, ticks, time chips, the time phrases' rewrite,
list continuation, dictation all stop; the microphone hides) and its header shows a padlock and "Locked", a
`Button` that unlocks it (`setLocked`, which saves the open note's edits before locking). Rows show a padlock
(`note-locked`). The to-do view's tick and the island's checkbox catch `ERR_JOT_LOCKED`: the footer says to unlock the
note, the island shows "Locked" with a padlock for its checkbox and closes; the reminder still comes due.

## Packaging (scripts/package-macos.sh)

NSH's `nsh package` bundles its runner and the app's assets only, so the script builds `jot-mcp` (in cargo's
`target_directory` from `cargo metadata`; lipo'd for `--arch universal`), removes `<out>/<name>.app` (`--name`, else
nsh.json's), runs `nsh package --target macos` with its options (paths taken from the caller's folder; no ENTRY: it
packages this checkout; `--arch` is `arm64`, `x86_64` or `universal`), copies `jot-mcp` to
`<name>.app/Contents/MacOS/jot-mcp`, signs it, signs the bundle again keeping its entitlements, and verifies
(`codesign --verify --deep --strict`). `NSH` picks the CLI, which must be the NSH `Cargo.toml`'s `nsh-core` names (a
commit of NSH's repository, `rev`, which a nightly CLI's `--version` names; or a crates.io release; it warns
otherwise), `SIGN_IDENTITY` the identity: ad hoc by default;
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

## The open note's Return and ⌘↩ (ui/Paper.tsx)

NSH's `Editor` binds Return (a line break) and ⌘↩ (a line below) itself while it has the focus, before the app's
bindings; Jot takes them with `keymap.bind`'s `overFocused`, bound while the editor has the focus (`onFocus` /
`onBlur`). ⌘↩ ticks or unticks the caret's to-do and does nothing on another line (the panel's own ⌘↩, which does
the same while the note's text has no focus, is in ui/Panel.tsx). Return is bound only while the caret is on a list
item, a to-do or a quote line outside fenced code with nothing selected (`continuation` in app/markdown.ts says what it
does there), so a line break elsewhere is the editor's own; it writes the line and the next item's start as one
`editor.edit`, which one undo takes back, and falls back to the editor's `newline` command when the caret has left
such a line before the key arrives. ⇧↩ is never bound: a plain break. While an input method composes (pinyin), NSH
gives the bindings no key, so Return commits the letters.

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
⇧⌘A, lock / unlock (no key), move to trash ⌃X (Windows / Linux Ctrl+D; keys in `ui/tokens.ts`). A locked note has
"Unlock" for "Lock" and no rename or reminder time; ⌃X on it says to unlock it first (`ERR_JOT_LOCKED`). "New" row: create; today's row: show
to-dos; a to-do: open its note, tick ⌘↩, its reminder time ⇧⌘D (and "Remove Reminder" when it has one); in the open
note, the caret's to-do's reminder time ⇧⌘D. Nothing but a note can be trashed. Moving to the trash folds the row away
and turns the footer into "Moved to the Trash" with Undo for 5 s (`T.timing.undoFor`); while it shows, ⌘Z takes
the trashed notes back one at a time, the last first (an undo stack); then ⌘Z is the search field's again. With the
note's text focused, Ctrl+D stays the editor's (select the next occurrence); macOS's ⌃X is no text key.
