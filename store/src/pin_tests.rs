//! Pinned notes (`pin.rs`): reading `pinned` from the frontmatter, pinning and unpinning.

use std::fs;
use std::time::{Duration, SystemTime};

use crate::lock::set_flag;
use crate::*;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("Jot")).unwrap();
    (dir, store)
}

fn at(seconds: u64) -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(seconds)
}

/// Writes a note's file as given, dated `seconds` after the epoch.
fn write(store: &Store, title: &str, content: &str, seconds: u64) {
    let path = store.root().join(format!("{title}.md"));
    fs::write(&path, content).unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(at(seconds))
        .unwrap();
}

fn file(store: &Store, title: &str) -> (String, SystemTime) {
    let path = store.root().join(format!("{title}.md"));
    (
        fs::read_to_string(&path).unwrap(),
        fs::metadata(&path).unwrap().modified().unwrap(),
    )
}

#[test]
fn pinned_is_read_from_the_frontmatter() {
    let (_dir, store) = store();
    for (content, expected) in [
        ("---\npinned: true\n---\nbody", true),
        ("---\npinned: True\n---\nbody", true),
        ("---\npinned: \"true\"\n---\nbody", true),
        ("---\npinned: true # top\n---\nbody", true),
        (
            "---\nsource: claude\nicon: \"🍕\"\npinned: true\n---\n",
            true,
        ),
        ("---\npinned: false\n---\nbody", false),
        ("---\npinned: yes\n---\nbody", false),
        ("---\npinned:\n---\nbody", false),
        // Only the top-level key, in a frontmatter.
        ("---\n  pinned: true\n---\nbody", false),
        ("---\npinned_at: true\n---\nbody", false),
        ("pinned: true\n", false),
        ("body\n---\npinned: true\n---\n", false),
    ] {
        write(&store, "Note", content, 100);
        assert_eq!(store.list().unwrap()[0].pinned, expected, "{content:?}");
        assert_eq!(
            store.read("Note").unwrap().unwrap().meta.pinned,
            expected,
            "{content:?}"
        );
    }
}

#[test]
fn pinning_keeps_the_note_and_its_time() {
    let (_dir, store) = store();
    write(&store, "Wifi", "Password on the router\n", 100);
    write(&store, "Later", "newer\n", 200);

    let meta = store.pin("wifi").unwrap();
    assert_eq!(meta.title, "Wifi");
    assert!(meta.pinned);
    assert_eq!(meta.modified, at(100));
    assert_eq!(
        file(&store, "Wifi"),
        (
            "---\npinned: true\n---\nPassword on the router\n".to_owned(),
            at(100)
        )
    );
    // The store's listing stays by time: the app puts pinned notes first.
    let list = store.list().unwrap();
    assert_eq!(list[0].title, "Later");
    assert!(!list[0].pinned);
    assert!(list[1].pinned);
    assert_eq!(
        store.read("Wifi").unwrap().unwrap().body,
        "Password on the router\n"
    );

    // Pinned again: nothing changes.
    store.pin("Wifi").unwrap();
    assert_eq!(
        file(&store, "Wifi").0,
        "---\npinned: true\n---\nPassword on the router\n"
    );

    // Unpinned: the frontmatter, left empty, goes.
    let meta = store.unpin("Wifi").unwrap();
    assert!(!meta.pinned);
    assert_eq!(meta.modified, at(100));
    assert_eq!(
        file(&store, "Wifi"),
        ("Password on the router\n".to_owned(), at(100))
    );
    // Unpinning a note not pinned leaves it as it is.
    store.unpin("Wifi").unwrap();
    assert_eq!(
        file(&store, "Wifi"),
        ("Password on the router\n".to_owned(), at(100))
    );

    assert!(matches!(store.pin("Nowhere"), Err(StoreError::NotFound)));
    assert!(matches!(store.unpin("Nowhere"), Err(StoreError::NotFound)));
}

#[test]
fn the_rest_of_the_frontmatter_stays() {
    let (_dir, store) = store();
    let before =
        "---\r\nsource: claude\r\npinned: false # not yet\r\nicon: \"📶\"\r\n---\r\nWifi\r\n";
    write(&store, "Wifi", before, 100);
    assert!(!store.list().unwrap()[0].pinned);
    let meta = store.pin("Wifi").unwrap();
    assert_eq!(meta.source, Source::agent("claude"));
    assert_eq!(meta.icon.as_deref(), Some("📶"));
    // In the place of the line there.
    assert_eq!(
        file(&store, "Wifi").0,
        "---\r\nsource: claude\r\npinned: true\r\nicon: \"📶\"\r\n---\r\nWifi\r\n"
    );
    // A body editing keeps it, and so does an emoji.
    store.write("Wifi", "rewritten\r\n").unwrap();
    store.clear_icon("Wifi").unwrap();
    assert_eq!(
        file(&store, "Wifi").0,
        "---\r\nsource: claude\r\npinned: true\r\n---\r\nrewritten\r\n"
    );
    assert!(store.list().unwrap()[0].pinned);
    store.unpin("Wifi").unwrap();
    assert_eq!(
        file(&store, "Wifi").0,
        "---\r\nsource: claude\r\n---\r\nrewritten\r\n"
    );
}

#[test]
fn a_locked_note_cannot_be_pinned_or_unpinned() {
    let (dir, store) = store();
    // Locked by its frontmatter alone.
    let content = "---\nlocked: true\n---\nContract\n";
    write(&store, "Contract", content, 100);
    assert!(matches!(store.pin("Contract"), Err(StoreError::Locked)));
    assert_eq!(file(&store, "Contract"), (content.to_owned(), at(100)));

    // Pinned, then locked in Jot (the flag too): it stays pinned, and unpinning waits for an unlock.
    write(&store, "Passport", "Expires in May\n", 50);
    store.pin("Passport").unwrap();
    let meta = store.lock("Passport").unwrap();
    assert!(meta.locked);
    assert!(meta.pinned);
    let locked = file(&store, "Passport");
    let refused = store.unpin("Passport");
    assert_eq!(file(&store, "Passport"), locked);
    let meta = store.unlock("Passport").unwrap();
    assert!(matches!(refused, Err(StoreError::Locked)));
    assert!(meta.pinned);
    assert_eq!(
        file(&store, "Passport"),
        (
            "---\npinned: true\n---\nExpires in May\n".to_owned(),
            at(50)
        )
    );
    assert!(!store.unpin("Passport").unwrap().pinned);
    // The flag must not outlive the test: the folder could not be deleted.
    let _ = set_flag(&dir.path().join("Jot/Passport.md"), false);
}
