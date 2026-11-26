//! A note's emoji (`icon.rs`): which values are one, reading it from the frontmatter, setting and clearing it.

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

fn icon(text: &str) -> Icon {
    Icon::parse(text).unwrap_or_else(|| panic!("{text:?} is an emoji"))
}

#[test]
fn one_emoji_is_an_icon() {
    for emoji in [
        "🍕",
        "❤️",
        // No VS16: a text-style emoji character still counts.
        "❤",
        "☺",
        "👍🏽",
        "👩🏽‍💻",
        "👨‍👩‍👧‍👦",
        "🇯🇵",
        "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
        "1️⃣",
        "#️⃣",
    ] {
        assert_eq!(icon(emoji).as_str(), emoji);
    }
    // Trimmed.
    assert_eq!(icon("  🍕\n").as_str(), "🍕");
}

#[test]
fn anything_else_is_no_icon() {
    for text in [
        "",
        "   ",
        "a",
        "A",
        "1",
        "#",
        "*",
        "Jot",
        "中",
        "🍕🍔",
        "🍕 🍔",
        "🍕a",
        "a🍕",
        "\"🍕\"",
        "→",
        "·",
    ] {
        assert_eq!(Icon::parse(text), None, "{text:?}");
    }
}

#[test]
fn the_icon_is_read_from_the_frontmatter() {
    let (_dir, store) = store();
    for (content, expected) in [
        ("---\nicon: \"🍕\"\n---\nbody", Some("🍕")),
        ("---\nicon: 🍕\n---\nbody", Some("🍕")),
        ("---\nicon: '🍕'\n---\nbody", Some("🍕")),
        ("---\nicon: \"🍕\" # dinner\n---\nbody", Some("🍕")),
        (
            "---\nsource: claude\nicon: \"👩🏽‍💻\"\nlocked: false\n---\n",
            Some("👩🏽‍💻"),
        ),
        // The first `icon` line counts.
        ("---\nicon: \"🍕\"\nicon: \"🍔\"\n---\n", Some("🍕")),
        // Not one emoji: no icon.
        ("---\nicon: pizza\n---\nbody", None),
        ("---\nicon: \"🍕🍔\"\n---\nbody", None),
        ("---\nicon: \n---\nbody", None),
        ("---\nicon: 1\n---\nbody", None),
        // Only the top-level key, in a frontmatter.
        ("---\n  icon: \"🍕\"\n---\nbody", None),
        ("---\nicons: \"🍕\"\n---\nbody", None),
        ("icon: \"🍕\"\n", None),
        ("body\n---\nicon: \"🍕\"\n---\n", None),
    ] {
        write(&store, "Note", content, 100);
        let meta = &store.list().unwrap()[0];
        assert_eq!(meta.icon.as_deref(), expected, "{content:?}");
        assert_eq!(
            store.read("Note").unwrap().unwrap().meta.icon.as_deref(),
            expected,
            "{content:?}"
        );
    }
}

#[test]
fn setting_the_icon_keeps_the_note_and_its_time() {
    let (_dir, store) = store();
    write(&store, "Dinner", "Pizza on Friday\n", 100);
    write(&store, "Later", "newer\n", 200);

    let meta = store.set_icon("dinner", &icon("🍕")).unwrap();
    assert_eq!(meta.title, "Dinner");
    assert_eq!(meta.icon.as_deref(), Some("🍕"));
    assert_eq!(meta.modified, at(100));
    assert_eq!(
        file(&store, "Dinner"),
        (
            "---\nicon: \"🍕\"\n---\nPizza on Friday\n".to_owned(),
            at(100)
        )
    );
    // No change of the note: it stays below the newer one.
    let list = store.list().unwrap();
    assert_eq!(list[0].title, "Later");
    assert_eq!(list[1].icon.as_deref(), Some("🍕"));
    assert_eq!(
        store.read("Dinner").unwrap().unwrap().body,
        "Pizza on Friday\n"
    );

    // Another emoji takes the line's place; the same one changes nothing.
    store.set_icon("Dinner", &icon("🍔")).unwrap();
    store.set_icon("Dinner", &icon("🍔")).unwrap();
    assert_eq!(
        file(&store, "Dinner"),
        (
            "---\nicon: \"🍔\"\n---\nPizza on Friday\n".to_owned(),
            at(100)
        )
    );

    // Cleared: the frontmatter, left empty, goes.
    let meta = store.clear_icon("Dinner").unwrap();
    assert_eq!(meta.icon, None);
    assert_eq!(meta.modified, at(100));
    assert_eq!(
        file(&store, "Dinner"),
        ("Pizza on Friday\n".to_owned(), at(100))
    );
    // Clearing a note without one leaves it as it is.
    store.clear_icon("Dinner").unwrap();
    assert_eq!(
        file(&store, "Dinner"),
        ("Pizza on Friday\n".to_owned(), at(100))
    );

    assert!(matches!(
        store.set_icon("Nowhere", &icon("🍕")),
        Err(StoreError::NotFound)
    ));
    assert!(matches!(
        store.clear_icon("Nowhere"),
        Err(StoreError::NotFound)
    ));
}

#[test]
fn the_rest_of_the_frontmatter_stays() {
    let (_dir, store) = store();
    let before = "---\r\nsource: claude\r\ntags: [food]\r\nicon: pizza # mine\r\nnested:\r\n  icon: x\r\n---\r\nPizza\r\n";
    write(&store, "Dinner", before, 100);
    // Not an emoji, so no icon; setting one writes over that line, in its place.
    assert_eq!(store.list().unwrap()[0].icon, None);
    let meta = store.set_icon("Dinner", &icon("🍕")).unwrap();
    assert_eq!(meta.source, Source::agent("claude"));
    assert_eq!(
        file(&store, "Dinner").0,
        "---\r\nsource: claude\r\ntags: [food]\r\nicon: \"🍕\"\r\nnested:\r\n  icon: x\r\n---\r\nPizza\r\n"
    );
    store.clear_icon("Dinner").unwrap();
    assert_eq!(
        file(&store, "Dinner").0,
        "---\r\nsource: claude\r\ntags: [food]\r\nnested:\r\n  icon: x\r\n---\r\nPizza\r\n"
    );

    // Added after the keys there, the body's own `---` lines untouched.
    write(
        &store,
        "Rule",
        "---\nsource: cursor\n---\nabove\n---\nbelow\n",
        100,
    );
    store.set_icon("Rule", &icon("📏")).unwrap();
    assert_eq!(
        file(&store, "Rule").0,
        "---\nsource: cursor\nicon: \"📏\"\n---\nabove\n---\nbelow\n"
    );

    // A body editing keeps it.
    store.write("Rule", "rewritten\n").unwrap();
    assert_eq!(
        file(&store, "Rule").0,
        "---\nsource: cursor\nicon: \"📏\"\n---\nrewritten\n"
    );
    assert_eq!(store.list().unwrap()[0].icon.as_deref(), Some("📏"));
}

#[test]
fn a_locked_note_keeps_its_icon() {
    let (dir, store) = store();
    // Locked by its frontmatter alone.
    let content = "---\nlocked: true\nicon: \"🔒\"\n---\nSecret\n";
    write(&store, "Secret", content, 100);
    assert!(matches!(
        store.set_icon("Secret", &icon("🍕")),
        Err(StoreError::Locked)
    ));
    assert!(matches!(
        store.clear_icon("Secret"),
        Err(StoreError::Locked)
    ));
    assert_eq!(file(&store, "Secret"), (content.to_owned(), at(100)));
    assert_eq!(store.list().unwrap()[0].icon.as_deref(), Some("🔒"));

    // Locked in Jot (the flag too); unlocked, it takes one again.
    write(&store, "Passport", "Expires in May\n", 50);
    store.lock("Passport").unwrap();
    let locked = file(&store, "Passport");
    let refused = store.set_icon("Passport", &icon("🛂"));
    assert_eq!(file(&store, "Passport"), locked);
    store.unlock("Passport").unwrap();
    assert!(matches!(refused, Err(StoreError::Locked)));
    assert_eq!(
        store
            .set_icon("Passport", &icon("🛂"))
            .unwrap()
            .icon
            .as_deref(),
        Some("🛂")
    );
    // The flag must not outlive the test: the folder could not be deleted.
    let _ = set_flag(&dir.path().join("Jot/Passport.md"), false);
}

#[test]
fn locking_keeps_the_icon() {
    let (dir, store) = store();
    write(&store, "Dinner", "Pizza\n", 100);
    store.set_icon("Dinner", &icon("🍕")).unwrap();
    let meta = store.lock("Dinner").unwrap();
    assert!(meta.locked);
    assert_eq!(meta.icon.as_deref(), Some("🍕"));
    let meta = store.unlock("Dinner").unwrap();
    assert_eq!(meta.icon.as_deref(), Some("🍕"));
    assert_eq!(
        file(&store, "Dinner"),
        ("---\nicon: \"🍕\"\n---\nPizza\n".to_owned(), at(100))
    );
    let _ = set_flag(&dir.path().join("Jot/Dinner.md"), false);
}
