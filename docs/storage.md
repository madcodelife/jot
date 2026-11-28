# Storage

The notes folder: its format, a synced folder (iCloud Drive) and jot-store's API, then how the app shows a synced
folder. Part of [the architecture](architecture.md).

## Notes folder format

- One note per `.md` file directly in the folder (no subfolders in v1). Other files are ignored.
- The title is the file stem. A title is trimmed; `/`, `\`, `:` and control characters become `-`; an empty
  title, `.` / `..`, or a title starting with `.` is rejected (`StoreError::InvalidTitle`). Titles compare
  case-insensitively for existence checks (macOS file systems are case-insensitive).
- Optional YAML frontmatter at the very top (`---` lines). Jot writes these keys: `source`, on notes created through
  MCP: the app that created it (`source: cursor`, `source: "agent:Goose"`), `locked: true` on a locked note
  ([locks.md](locks.md)), `icon: "🍕"`, the note's emoji ([below](#a-notes-emoji-storesrciconrs)), and `apple-notes-id` and `folder` on a note imported from Apple Notes (below). Only the
  values Jot writes mark a note as an app's; any other `source` (a web clipper's URL, a book) is the user's. Unknown
  keys are preserved on every write. `body` never includes the frontmatter.
- Writes are atomic: a temp file in the same folder, then rename.
- `modified` is the file's mtime.

## A note's emoji (store/src/icon.rs)

A note may have one emoji, shown before its title (`NoteMeta::icon`): the frontmatter's first top-level `icon` line,
its value unquoted and without a trailing `# comment` (as `locked`'s), when that value is one emoji. One emoji is one
grapheme cluster (`unicode-segmentation`) whose first character is an emoji character (`unicode-properties`:
`Emoji=Yes`), or `#`, `*` or a digit with the keycap mark (`1️⃣`), at most 64 bytes: `🍕`, `❤`, `👩🏽‍💻`, `🇯🇵`.
Anything else (words, two emoji, a bare digit) is no emoji; the line stays in the file as the user wrote it.
`Icon::parse` says which, trimmed.

`set_icon` writes `icon: "<emoji>"` (double quotes: an emoji holds no quote or backslash) in place of the first `icon`
line, else as the frontmatter's last line, or in a new frontmatter; `clear_icon` takes every top-level `icon` line out,
and a frontmatter left empty goes. The rest of the frontmatter, its line breaks and the body stay as they are, and so
does the file's mtime (written as a lock's frontmatter is: the time set on the temporary file before the rename), so
the list keeps its order: an emoji is no change of the note. Like every write, both fail with `NotFound`,
`NotDownloaded` and `Locked`, the file untouched. Body writes keep the line, as they keep the whole frontmatter.
`frontmatter.rs` reads and writes one top-level key on its own, for `locked` and `icon`.

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

## Importing (store/src/import.rs)

`Store::import` writes notes another app had (Apple Notes: [app.md](app.md#importing-from-apple-notes-appimportingts-srcapple_notesrs)),
their bodies already Markdown, each as a new note:

```markdown
---
apple-notes-id: "x-coredata://5C2A…/ICNote/p1234"
folder: "Work/Projects"
---
The note's text, without its title (the file's name).
```

- `apple-notes-id` is the note's id in Notes; `folder` its Notes folder (a nested one as `Parent/Child`), left out
  when it has none. Both are written as `source` is (plain when YAML reads them back as that string, else
  double-quoted). No `source`: an imported note is the user's own.
- The file's modification time is the note's in Notes (set before the rename), so the list orders the notes as
  Notes did.
- **Nothing here changes.** A note whose id a note of the folder has in its frontmatter (a top-level
  `apple-notes-id`, any quoting) is left out (`already`), so importing again adds only the new ones; a note
  renamed or edited in Jot since stays as it is, and one deleted in Jot comes back. A title taken by another note
  is numbered (`Title 2`…, as `move_into` does); a new file never replaces one (`persist_noclobber`).
- Titles are cleaned as every title is, leading dots dropped, cut to leave room for a number; an empty one is
  `Untitled`.
- A note not downloaded (iCloud Drive) cannot be read for its id: an imported note whose title (or numbered title)
  meets one is left out for now (`waiting`), its download asked for; importing again once it is here brings it in.
  Only the title is checked, so a note imported before, renamed in Jot and then moved off this Mac by iCloud Drive
  (its id unread, its old title free) is imported again, a second copy.
- The body is written as it comes, nothing in it escaped: Markdown the user typed in Notes is Markdown here. A line
  typed as `- [ ] …` is a Jot to-do (with a time phrase, a reminder: [todos.md](todos.md)), `2*3*4` italic, a
  literal `<b>` HTML.
- `Store::import_with_progress` is the same, calling back with how many notes are done (written or left out) after
  each, for the settings' "Writing… 12/53".

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
    /// Replaces the one place `old` is in the body with `new` (empty removes it); the frontmatter is never searched.
    /// None or several places (overlapping ones counted) change nothing: `Edited::Matches(count)`. `NotFound`; an
    /// `InvalidInput` I/O error for an empty `old` or a body that would start with a `---` block. `edit_note` calls it.
    pub fn edit(&self, title: &str, old: &str, new: &str) -> Result<Edited, StoreError>;
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
    /// Locks / unlocks (locks.md). `settle_locks` puts back a missing half of each lock; returns the titles it changed.
    pub fn lock(&self, title: &str) -> Result<NoteMeta, StoreError>;
    pub fn unlock(&self, title: &str) -> Result<NoteMeta, StoreError>;
    pub fn settle_locks(&self) -> Result<Vec<String>, StoreError>;
    /// The note's emoji: `icon: "<emoji>"` in its frontmatter / its `icon` lines out (mtime kept; above).
    pub fn set_icon(&self, title: &str, icon: &Icon) -> Result<NoteMeta, StoreError>;
    pub fn clear_icon(&self, title: &str) -> Result<NoteMeta, StoreError>;
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
    /// Writes each note as a new one (`apple-notes-id`, `folder`, its date as the file's), never changing a note
    /// here: an id the folder has is left out (`already`), a title taken numbered, one taken by a note not
    /// downloaded left for later (`waiting`). Fails only when the folder cannot be read.
    pub fn import(&self, notes: &[ImportNote]) -> Result<Imported, StoreError>;
    /// `import`, calling `progress` with how many notes are done after each.
    pub fn import_with_progress(&self, notes: &[ImportNote], progress: impl FnMut(usize))
        -> Result<Imported, StoreError>;
}

pub struct Conflict { pub id: String, pub device: Option<String>, pub modified: SystemTime, pub body: String }  // non_exhaustive
pub enum Resolution { KeepCurrent, UseOther, KeepBoth { title: String } }
pub struct Resolved { pub note: NoteMeta, pub copy: Option<NoteMeta> }  // non_exhaustive
pub struct Moved { pub moved: Vec<String>, pub renamed: Vec<(String, String)>, pub same: Vec<String>, pub failed: Vec<(String, String)> }  // non_exhaustive
pub struct ImportNote { pub id: String, pub title: String, pub body: String /* Markdown, no title */, pub folder: Option<String>, pub modified: SystemTime }
pub struct Imported { pub imported: Vec<String>, pub renamed: Vec<(String, String)>, pub already: Vec<String>, pub waiting: Vec<String>, pub failed: Vec<(String, String)> }  // non_exhaustive

pub struct NoteMeta { pub title: String, pub modified: SystemTime, pub source: Source, pub preview: String /* first ~120 chars of the body, one line */, pub downloading: bool /* its text is not on this Mac yet; asked for */, pub locked: bool /* the flag, or `locked: true` */, pub icon: Option<String> /* its emoji; None while downloading */ }
/// One emoji (above). `parse` trims; `None` for anything else.
pub struct Icon(/* … */);
impl Icon { pub fn parse(text: &str) -> Option<Icon>; pub fn as_str(&self) -> &str; }  // + Display
pub struct Note { pub meta: NoteMeta, pub body: String }
pub struct SearchHit { pub meta: NoteMeta, pub snippet: String /* ~120 chars around the first body match, or the preview */, pub title_match: bool }
pub struct Trashed { pub title: String, pub in_trash: Option<PathBuf>, pub content: String, pub modified: SystemTime }  // non_exhaustive
pub struct Replaced { pub note: NoteMeta, pub previous: Option<Trashed> }  // non_exhaustive
/// Jot's settings for AI apps, a file the app writes and jot-mcp reads (mcp.md).
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

## The app and a synced folder

The list shows a note not downloaded with "Downloading…" for its snippet; opened, the editor is read-only and empty,
says so, and takes the text when it lands. A note with conflict versions shows a bar over its text: "Keep This
Mac's", "Use the Other", "Keep Both" (the other as `Title (iPhone)`), one version at a time, the open note's edits
saved first. Settings › General › iCloud Drive: "Move to iCloud Drive…" (disabled, saying why, while iCloud Drive
is off: `Folder.icloud`), asks first (`AlertDialog`), moves the notes to `~/Library/Mobile
Documents/com~apple~CloudDocs/Jot` (`moveNotesTo` in app/store.ts: `Folder.moveNotes`, then `changeFolder`, which
the connected AI apps follow), and says what it did; a folder already in iCloud Drive shows "In iCloud Drive".

With no folder stored (`jot.dir`), `openFolder` takes `defaultFolder`: Jot's folder in iCloud Drive when
`Folder.icloud` says it is on, else `~/Documents/Jot`; a Mac already welcomed (`jot.welcomed`, an earlier version)
keeps `~/Documents/Jot`. The folder taken is stored, so iCloud Drive turned off or on later does not move Jot.
