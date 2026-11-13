use std::fs;
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

use super::*;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("Jot")).unwrap();
    (dir, store)
}

/// Sets a note's mtime, so ordering tests do not depend on the clock's resolution.
fn touch(store: &Store, title: &str, seconds: u64) {
    let file = fs::File::options()
        .write(true)
        .open(store.root().join(format!("{title}.md")))
        .unwrap();
    file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(seconds))
        .unwrap();
}

fn file_names(store: &Store) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(store.root())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

fn titles(notes: &[NoteMeta]) -> Vec<&str> {
    notes.iter().map(|meta| meta.title.as_str()).collect()
}

#[test]
fn open_creates_the_folder() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("a").join("b");
    let store = Store::open(&root).unwrap();
    assert!(root.is_dir());
    assert_eq!(store.root(), root);
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn titles_are_cleaned() {
    let (_dir, store) = store();
    let meta = store.create("  a/b\\c:d\te  ", "x", Source::User).unwrap();
    assert_eq!(meta.title, "a-b-c-d-e");
    assert!(store.root().join("a-b-c-d-e.md").is_file());
    // Lookups clean the same way.
    assert_eq!(store.read("a/b\\c:d\te").unwrap().unwrap().body, "x");
}

#[test]
fn bad_titles_are_rejected() {
    let (_dir, store) = store();
    for title in ["", "   ", ".", "..", ".hidden", "  .x", &"x".repeat(300)] {
        assert!(
            matches!(
                store.create(title, "", Source::User),
                Err(StoreError::InvalidTitle)
            ),
            "{title:?}"
        );
    }
    assert!(matches!(store.read(""), Err(StoreError::InvalidTitle)));
    assert!(file_names(&store).is_empty());
}

#[test]
fn create_and_read() {
    let (_dir, store) = store();
    let meta = store
        .create("Wifi", "password: hunter2\n", Source::User)
        .unwrap();
    assert_eq!(meta.source, Source::User);
    assert_eq!(meta.preview, "password: hunter2");
    assert_eq!(
        fs::read_to_string(store.root().join("Wifi.md")).unwrap(),
        "password: hunter2\n"
    );
    let note = store.read("Wifi").unwrap().unwrap();
    assert_eq!(note.body, "password: hunter2\n");
    assert_eq!(note.meta, meta);
    assert!(store.read("Missing").unwrap().is_none());
}

#[test]
fn claude_notes_get_frontmatter() {
    let (_dir, store) = store();
    let meta = store.create("Command", "ls -la", Source::Claude).unwrap();
    assert_eq!(meta.source, Source::Claude);
    assert_eq!(
        fs::read_to_string(store.root().join("Command.md")).unwrap(),
        "---\nsource: claude\n---\nls -la"
    );
    let note = store.read("Command").unwrap().unwrap();
    assert_eq!(note.body, "ls -la");
    assert_eq!(note.meta.preview, "ls -la");
}

#[test]
fn create_fails_on_an_existing_title_in_any_case() {
    let (_dir, store) = store();
    store.create("Groceries", "milk", Source::User).unwrap();
    for title in ["Groceries", "groceries", "GROCERIES", " Groceries "] {
        assert!(
            matches!(
                store.create(title, "eggs", Source::Claude),
                Err(StoreError::AlreadyExists)
            ),
            "{title:?}"
        );
    }
    assert_eq!(store.read("groceries").unwrap().unwrap().body, "milk");
    assert_eq!(
        store.read("groceries").unwrap().unwrap().meta.title,
        "Groceries"
    );
}

#[test]
fn unknown_frontmatter_is_kept_on_every_write() {
    let (_dir, store) = store();
    let header = "---\nsource: claude\ntags: [a, b]\nx-custom: \"keep me\"\n---\n";
    fs::write(store.root().join("Meta.md"), format!("{header}first")).unwrap();

    let note = store.read("Meta").unwrap().unwrap();
    assert_eq!(note.body, "first");
    assert_eq!(note.meta.source, Source::Claude);

    store.write("Meta", "second").unwrap();
    assert_eq!(
        fs::read_to_string(store.root().join("Meta.md")).unwrap(),
        format!("{header}second")
    );

    store.append("Meta", "third").unwrap();
    assert_eq!(
        fs::read_to_string(store.root().join("Meta.md")).unwrap(),
        format!("{header}second\n\nthird\n")
    );

    store.rename("Meta", "Renamed").unwrap();
    assert_eq!(
        fs::read_to_string(store.root().join("Renamed.md")).unwrap(),
        format!("{header}second\n\nthird\n")
    );
}

#[test]
fn frontmatter_edge_cases() {
    let (_dir, store) = store();
    // CRLF lines and a quoted value.
    fs::write(
        store.root().join("Crlf.md"),
        "---\r\nsource: \"Claude\"\r\n---\r\nbody\r\n",
    )
    .unwrap();
    let note = store.read("Crlf").unwrap().unwrap();
    assert_eq!(note.meta.source, Source::Claude);
    assert_eq!(note.body, "body\r\n");
    store.write("Crlf", "new").unwrap();
    assert_eq!(
        fs::read_to_string(store.root().join("Crlf.md")).unwrap(),
        "---\r\nsource: \"Claude\"\r\n---\r\nnew"
    );

    // A closing line at the end of the file.
    fs::write(store.root().join("Bare.md"), "---\nk: v\n---").unwrap();
    assert_eq!(store.read("Bare").unwrap().unwrap().body, "");
    store.write("Bare", "text").unwrap();
    assert_eq!(
        fs::read_to_string(store.root().join("Bare.md")).unwrap(),
        "---\nk: v\n---\ntext"
    );

    // No closing line: it is all body.
    fs::write(store.root().join("Open.md"), "---\nnot frontmatter").unwrap();
    let note = store.read("Open").unwrap().unwrap();
    assert_eq!(note.body, "---\nnot frontmatter");
    assert_eq!(note.meta.source, Source::User);

    // A rule later in the text is not frontmatter.
    fs::write(
        store.root().join("Rule.md"),
        "intro\n---\nsource: claude\n---\n",
    )
    .unwrap();
    let note = store.read("Rule").unwrap().unwrap();
    assert_eq!(note.meta.source, Source::User);
    assert_eq!(note.body, "intro\n---\nsource: claude\n---\n");
}

#[test]
fn write_replaces_the_body_or_creates_a_user_note() {
    let (_dir, store) = store();
    let meta = store.write("Draft", "one").unwrap();
    assert_eq!(meta.source, Source::User);
    assert_eq!(
        fs::read_to_string(store.root().join("Draft.md")).unwrap(),
        "one"
    );

    // Another case writes to the same note.
    let meta = store.write("draft", "two").unwrap();
    assert_eq!(meta.title, "Draft");
    assert_eq!(file_names(&store), ["Draft.md"]);
    assert_eq!(store.read("Draft").unwrap().unwrap().body, "two");
}

#[test]
fn append_adds_a_paragraph() {
    let (_dir, store) = store();
    assert!(matches!(
        store.append("Log", "x"),
        Err(StoreError::NotFound)
    ));

    store.create("Log", "first\n\n\n", Source::User).unwrap();
    store.append("log", "second").unwrap();
    store.append("Log", "third\n").unwrap();
    assert_eq!(
        store.read("Log").unwrap().unwrap().body,
        "first\n\nsecond\n\nthird\n"
    );

    store.create("Empty", "", Source::User).unwrap();
    store.append("Empty", "only").unwrap();
    assert_eq!(store.read("Empty").unwrap().unwrap().body, "only\n");
}

#[test]
fn rename_moves_the_file() {
    let (_dir, store) = store();
    store.create("Old", "text", Source::User).unwrap();
    store.create("Taken", "other", Source::User).unwrap();

    assert!(matches!(
        store.rename("Missing", "X"),
        Err(StoreError::NotFound)
    ));
    assert!(matches!(
        store.rename("Old", "taken"),
        Err(StoreError::AlreadyExists)
    ));
    assert!(matches!(
        store.rename("Old", ".x"),
        Err(StoreError::InvalidTitle)
    ));

    let meta = store.rename("old", "New: name").unwrap();
    assert_eq!(meta.title, "New- name");
    assert_eq!(file_names(&store), ["New- name.md", "Taken.md"]);
    assert_eq!(store.read("New- name").unwrap().unwrap().body, "text");

    // Changing only the case is allowed.
    let meta = store.rename("New- name", "NEW- NAME").unwrap();
    assert_eq!(meta.title, "NEW- NAME");
    assert_eq!(file_names(&store), ["NEW- NAME.md", "Taken.md"]);
}

#[test]
fn delete_removes_the_file() {
    let (_dir, store) = store();
    store.create("Gone", "", Source::User).unwrap();
    store.delete("gone").unwrap();
    assert!(file_names(&store).is_empty());
    assert!(matches!(store.delete("Gone"), Err(StoreError::NotFound)));
}

#[test]
fn list_ignores_other_files_and_sorts_newest_first() {
    let (_dir, store) = store();
    store.create("A", "a", Source::User).unwrap();
    store.create("B", "b", Source::Claude).unwrap();
    store.create("C", "c", Source::User).unwrap();
    touch(&store, "A", 200);
    touch(&store, "B", 300);
    touch(&store, "C", 100);
    fs::write(store.root().join("notes.txt"), "").unwrap();
    fs::write(store.root().join(".hidden.md"), "").unwrap();
    fs::write(store.root().join(".jot-x.tmp"), "").unwrap();
    fs::create_dir(store.root().join("Folder.md")).unwrap();

    let notes = store.list().unwrap();
    assert_eq!(titles(&notes), ["B", "A", "C"]);
    assert_eq!(notes[0].source, Source::Claude);
    assert_eq!(
        notes[1].modified,
        SystemTime::UNIX_EPOCH + Duration::from_secs(200)
    );
}

#[test]
fn previews_are_one_short_line() {
    let (_dir, store) = store();
    let body = format!("# Title\n\n  {}\nend", "word ".repeat(100));
    let meta = store.create("Long", &body, Source::User).unwrap();
    assert!(!meta.preview.contains('\n'));
    assert!(meta.preview.starts_with("# Title word word"));
    assert!(meta.preview.ends_with('…'));
    assert!(meta.preview.chars().count() <= PREVIEW_CHARS + 1);

    let meta = store
        .create("Wide", &"字".repeat(500), Source::User)
        .unwrap();
    assert_eq!(meta.preview.chars().count(), PREVIEW_CHARS + 1);
}

#[test]
fn search_matches_every_term_in_title_or_body() {
    let (_dir, store) = store();
    store
        .create("Wifi", "Password: hunter2", Source::User)
        .unwrap();
    store
        .create("Router", "The wifi password is on the box", Source::User)
        .unwrap();
    store
        .create("Wifi password", "see Wifi", Source::User)
        .unwrap();
    store
        .create("Groceries", "milk, eggs", Source::User)
        .unwrap();
    touch(&store, "Wifi", 100);
    touch(&store, "Router", 300);
    touch(&store, "Wifi password", 50);
    touch(&store, "Groceries", 400);

    let hits = store.search("WIFI  password", 10).unwrap();
    let found: Vec<(&str, bool)> = hits
        .iter()
        .map(|hit| (hit.meta.title.as_str(), hit.title_match))
        .collect();
    // The title match first, then newest first.
    assert_eq!(
        found,
        [("Wifi password", true), ("Router", false), ("Wifi", false)]
    );
    assert_eq!(hits[1].snippet, "The wifi password is on the box");

    assert_eq!(store.search("wifi", 1).unwrap().len(), 1);
    assert!(store.search("wifi", 0).unwrap().is_empty());
    assert!(store.search("nothing", 10).unwrap().is_empty());

    // An empty query lists.
    let hits = store.search("  ", 2).unwrap();
    let found: Vec<&str> = hits.iter().map(|hit| hit.meta.title.as_str()).collect();
    assert_eq!(found, ["Groceries", "Router"]);
    assert_eq!(hits[0].snippet, "milk, eggs");
}

#[test]
fn search_snippets_show_the_first_match() {
    let (_dir, store) = store();
    let body = format!(
        "{}the needle is here\nand {}",
        "lorem ipsum ".repeat(30),
        "more text ".repeat(30)
    );
    store.create("Haystack", &body, Source::User).unwrap();
    let hit = &store.search("NEEDLE", 10).unwrap()[0];
    assert!(!hit.title_match);
    assert!(hit.snippet.starts_with('…'), "{}", hit.snippet);
    assert!(
        hit.snippet.contains("the needle is here and more"),
        "{}",
        hit.snippet
    );
    assert!(!hit.snippet.contains('\n'));
    assert!(hit.snippet.chars().count() <= PREVIEW_CHARS + 2);
    // Starts at a word.
    assert!(
        hit.snippet.starts_with("…lorem") || hit.snippet.starts_with("…ipsum"),
        "{}",
        hit.snippet
    );

    // A title-only match shows the preview.
    store.create("Needle", "short body", Source::User).unwrap();
    let hit = &store.search("needle", 10).unwrap()[0];
    assert_eq!(hit.meta.title, "Needle");
    assert_eq!(hit.snippet, "short body");

    // Lowercasing that changes lengths keeps offsets on the original text.
    store
        .create("Unicode", "İİİ café ÉCOLE", Source::User)
        .unwrap();
    let hit = &store.search("école", 10).unwrap()[0];
    assert_eq!(hit.snippet, "İİİ café ÉCOLE");
}

#[test]
fn writes_are_atomic_and_leave_no_temporary_files() {
    let (_dir, store) = store();
    store.create("Note", "one", Source::Claude).unwrap();
    store.write("Note", "two").unwrap();
    store.append("Note", "three").unwrap();
    store.write("Other", "x").unwrap();
    assert_eq!(file_names(&store), ["Note.md", "Other.md"]);

    // The note is replaced by a rename, not rewritten in place: a handle to the old file still reads the old
    // text.
    let path = store.root().join("Note.md");
    let before = fs::read_to_string(&path).unwrap();
    let old = fs::File::open(&path).unwrap();
    store.write("Note", "four").unwrap();
    let mut old_text = String::new();
    std::io::Read::read_to_string(&mut &old, &mut old_text).unwrap();
    assert_eq!(old_text, before);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "---\nsource: claude\n---\nfour"
    );
}

#[cfg(unix)]
#[test]
fn writes_keep_permissions() {
    use std::os::unix::fs::PermissionsExt as _;
    let (_dir, store) = store();
    store.create("New", "", Source::User).unwrap();
    let path = store.root().join("New.md");
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o644
    );
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    store.write("New", "x").unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn errors_display() {
    assert_eq!(StoreError::NotFound.to_string(), "note not found");
    let error = StoreError::from(io::Error::other("disk"));
    assert_eq!(error.to_string(), "disk");
    assert!(std::error::Error::source(&error).is_some());
}

#[test]
fn watch_reports_note_changes() {
    let (_dir, store) = store();
    let (sender, receiver) = mpsc::channel();
    let watcher = store
        .watch(move || {
            let _ = sender.send(());
        })
        .unwrap();
    // FSEvents may report the folder's creation late; let it settle.
    std::thread::sleep(Duration::from_millis(300));
    while receiver.try_recv().is_ok() {}

    store.create("Watched", "x", Source::User).unwrap();
    receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("a change after creating a note");

    drop(watcher);
}
