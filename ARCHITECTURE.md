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
