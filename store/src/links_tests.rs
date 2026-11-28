//! Links between notes (`links.rs`): reading them on a line, and pointing them at a note's new title.

use std::fs;
use std::time::{Duration, SystemTime};

use crate::links::{link_titles, relinked};
use crate::*;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("Jot")).unwrap();
    (dir, store)
}

/// Writes a note's file as given, dated `seconds` after the epoch.
fn write(store: &Store, title: &str, content: &str, seconds: u64) {
    let path = store.root().join(format!("{title}.md"));
    fs::write(&path, content).unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(seconds))
        .unwrap();
}

fn file(store: &Store, title: &str) -> (String, SystemTime) {
    let path = store.root().join(format!("{title}.md"));
    (
        fs::read_to_string(&path).unwrap(),
        fs::metadata(&path).unwrap().modified().unwrap(),
    )
}

fn titles(line: &str) -> Vec<&str> {
    link_titles(line)
        .into_iter()
        .map(|range| &line[range])
        .collect()
}

#[test]
fn links_are_read_on_a_line() {
    assert_eq!(
        titles("see [[Project X]] and [[ 周报 |this week]]"),
        ["Project X", "周报"]
    );
    // Inside an extra bracket, the inner pair is the link.
    assert_eq!(titles("[[[a]]]"), ["a"]);
    // No title, no words after the pipe, a bracket inside, a line break: no link.
    for line in [
        "[[]]",
        "[[  ]]",
        "[[a|]]",
        "[[a]b]]",
        "[[a",
        "[a]",
        "[[|words]]",
    ] {
        assert!(titles(line).is_empty(), "{line:?}");
    }
    // In a code span it is code; a lone backtick is text.
    assert_eq!(titles("`[[code]]` ``[[x]]`` [[real]]"), ["real"]);
    assert_eq!(titles("a ` b [[real]]"), ["real"]);
}

#[test]
fn links_follow_a_new_title() {
    let body = "[[Old]] and [[old|the plan]], [[ OLD ]]\n[[Older]] [[Old note]] `[[Old]]`\n```\n[[Old]]\n```\n- [ ] ask [[Old]]\n";
    let (out, count) = relinked(body, "Old", "New name");
    assert_eq!(count, 4);
    assert_eq!(
        out,
        "[[New name]] and [[New name|the plan]], [[ New name ]]\n[[Older]] [[Old note]] `[[Old]]`\n```\n[[Old]]\n```\n- [ ] ask [[New name]]\n",
    );
    // A title as the store reads it: `/` is `-` in a file name.
    assert_eq!(relinked("[[a/b]]", "a-b", "c").0, "[[c]]");
    // Line breaks stay as they were.
    assert_eq!(
        relinked("[[a]]\r\nx", "a", "b"),
        ("[[b]]\r\nx".to_owned(), 1)
    );
}

#[test]
fn renaming_points_every_link_at_the_new_title() {
    let (_dir, store) = store();
    write(&store, "Plan", "the plan", 100);
    write(
        &store,
        "Diary",
        "---\nsource: claude\n---\nSee [[plan]] and [[Plan|it]].\n",
        200,
    );
    write(&store, "Other", "nothing here", 300);
    write(
        &store,
        "Locked",
        "---\nlocked: true\n---\n[[Plan]] [[Plan]]\n",
        400,
    );
    store.rename("Plan", "Roadmap").unwrap();
    let done = store.rename_links("Plan", "Roadmap").unwrap();
    assert_eq!(
        done,
        Relinked {
            notes: 1,
            links: 2,
            locked_notes: 1,
            locked_links: 2,
        }
    );
    // The frontmatter and the modification time stay: the note keeps its place in the list.
    let (text, modified) = file(&store, "Diary");
    assert_eq!(
        text,
        "---\nsource: claude\n---\nSee [[Roadmap]] and [[Roadmap|it]].\n"
    );
    assert_eq!(modified, SystemTime::UNIX_EPOCH + Duration::from_secs(200));
    assert_eq!(file(&store, "Other").0, "nothing here");
    // The locked note keeps the old title.
    assert_eq!(
        file(&store, "Locked").0,
        "---\nlocked: true\n---\n[[Plan]] [[Plan]]\n"
    );
}

#[test]
fn the_renamed_note_links_to_itself_by_its_new_title() {
    let (_dir, store) = store();
    write(&store, "A", "me: [[A]]", 100);
    store.rename("A", "B").unwrap();
    assert_eq!(store.rename_links("A", "B").unwrap().links, 1);
    assert_eq!(file(&store, "B").0, "me: [[B]]");
}

#[test]
fn a_title_that_cannot_be_linked_changes_nothing() {
    let (_dir, store) = store();
    write(&store, "Note", "[[A]]", 100);
    assert!(!linkable("a|b"));
    assert_eq!(store.rename_links("A", "a|b").unwrap(), Relinked::default());
    assert_eq!(file(&store, "Note").0, "[[A]]");
}
