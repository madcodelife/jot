//! Importing notes (`Store::import`) into a temporary folder.

use std::fs;
use std::time::{Duration, SystemTime};

use super::*;

fn store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("Jot")).unwrap();
    (dir, store)
}

fn at(seconds: u64) -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(seconds)
}

fn note(id: &str, title: &str, body: &str) -> ImportNote {
    ImportNote {
        id: id.to_owned(),
        title: title.to_owned(),
        body: body.to_owned(),
        folder: Some("Notes".to_owned()),
        modified: at(1_700_000_000),
    }
}

fn file(store: &Store, title: &str) -> String {
    fs::read_to_string(store.root().join(format!("{title}.md"))).unwrap()
}

#[test]
fn notes_are_written_with_their_id_folder_and_date() {
    let (_dir, store) = store();
    let mut first = note("x-coredata://A/ICNote/p1", "Groceries", "- Milk\n- Eggs");
    first.modified = at(1_600_000_000);
    let mut second = note("x-coredata://A/ICNote/p2", "Trip", "Flights\n");
    second.folder = Some("Travel: 2026 #plans".to_owned());
    second.modified = at(1_650_000_000);

    let report = store.import(&[first, second]).unwrap();
    assert_eq!(report.imported, ["Groceries", "Trip"]);
    assert!(report.renamed.is_empty() && report.already.is_empty() && report.failed.is_empty());

    assert_eq!(
        file(&store, "Groceries"),
        "---\napple-notes-id: \"x-coredata://A/ICNote/p1\"\nfolder: Notes\n---\n- Milk\n- Eggs\n"
    );
    assert_eq!(
        file(&store, "Trip"),
        "---\napple-notes-id: \"x-coredata://A/ICNote/p2\"\nfolder: \"Travel: 2026 #plans\"\n---\nFlights\n"
    );
    // The list orders them by Apple Notes' dates, and reads them as the user's.
    let notes = store.list().unwrap();
    assert_eq!(
        notes.iter().map(|n| n.title.as_str()).collect::<Vec<_>>(),
        ["Trip", "Groceries"]
    );
    assert_eq!(notes[0].modified, at(1_650_000_000));
    assert_eq!(notes[1].modified, at(1_600_000_000));
    assert!(notes.iter().all(|n| n.source == Source::User));
    assert_eq!(
        store.read("Groceries").unwrap().unwrap().body,
        "- Milk\n- Eggs\n"
    );
}

#[test]
fn importing_again_adds_only_new_notes_and_changes_nothing() {
    let (_dir, store) = store();
    store.import(&[note("id-1", "One", "first")]).unwrap();
    // Edited in Jot since, and renamed.
    store.write("One", "edited in Jot\n").unwrap();
    store.rename("One", "One, renamed").unwrap();
    let before = file(&store, "One, renamed");

    let report = store
        .import(&[
            note("id-1", "One", "first, changed in Notes"),
            note("id-2", "Two", "second"),
        ])
        .unwrap();
    assert_eq!(report.already, ["One"]);
    assert_eq!(report.imported, ["Two"]);
    assert_eq!(file(&store, "One, renamed"), before);
    assert!(!store.root().join("One.md").exists());

    // A third time: nothing to do.
    let report = store
        .import(&[note("id-1", "One", "x"), note("id-2", "Two", "y")])
        .unwrap();
    assert_eq!(report.already, ["One", "Two"]);
    assert!(report.imported.is_empty() && report.renamed.is_empty());
}

#[test]
fn importing_says_how_many_notes_are_done_after_each() {
    let (_dir, store) = store();
    store.import(&[note("id-1", "One", "first")]).unwrap();
    let mut done = Vec::new();
    let report = store
        .import_with_progress(
            &[
                note("id-1", "One", "again"),
                note("id-2", "Two", "second"),
                note("id-3", "Three", "third"),
            ],
            |n| done.push(n),
        )
        .unwrap();
    // A note left out counts as done too.
    assert_eq!(done, [1, 2, 3]);
    assert_eq!(report.already, ["One"]);
    assert_eq!(report.imported, ["Two", "Three"]);
}

#[test]
fn a_taken_title_is_numbered_and_the_note_there_kept() {
    let (_dir, store) = store();
    store.create("Plan", "mine\n", Source::User).unwrap();
    store.create("plan 2", "mine too\n", Source::User).unwrap();

    let report = store
        .import(&[
            note("a", "Plan", "from Notes"),
            note("b", "Plan", "another"),
        ])
        .unwrap();
    assert_eq!(
        report.renamed,
        [
            ("Plan".to_owned(), "Plan 3".to_owned()),
            ("Plan".to_owned(), "Plan 4".to_owned())
        ]
    );
    assert_eq!(store.read("Plan").unwrap().unwrap().body, "mine\n");
    assert_eq!(store.read("plan 2").unwrap().unwrap().body, "mine too\n");
    assert_eq!(store.read("Plan 3").unwrap().unwrap().body, "from Notes\n");
    assert_eq!(store.read("Plan 4").unwrap().unwrap().body, "another\n");
}

#[test]
fn titles_are_made_file_names() {
    let (_dir, store) = store();
    let long = "x".repeat(400);
    let report = store
        .import(&[
            note("1", "  a/b:c  ", "slashes"),
            note("2", "", "no title"),
            note("3", "...hidden", "dots"),
            note("4", &long, "long"),
            note("5", "   ", "blank"),
        ])
        .unwrap();
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    assert_eq!(report.imported[..3], ["a-b-c", "Untitled", "hidden"]);
    let cut = &report.imported[3];
    assert!(cut.chars().all(|c| c == 'x') && cut.len() + ".md".len() + 5 <= 255);
    assert_eq!(
        report.renamed,
        [("   ".to_owned(), "Untitled 2".to_owned())]
    );
    assert_eq!(store.read("Untitled 2").unwrap().unwrap().body, "blank\n");
}

#[test]
fn an_empty_body_and_no_folder_leave_only_the_id() {
    let (_dir, store) = store();
    let mut empty = note("id", "Empty", "\n\n");
    empty.folder = None;
    store.import(&[empty]).unwrap();
    assert_eq!(file(&store, "Empty"), "---\napple-notes-id: id\n---\n");
    assert_eq!(store.read("Empty").unwrap().unwrap().body, "");
}

#[test]
fn ids_are_read_from_any_frontmatter_written_for_them() {
    let (_dir, store) = store();
    // Written by hand, or by an earlier Jot, with other keys and quoting.
    fs::write(
        store.root().join("Kept.md"),
        "---\ntags: [a]\napple-notes-id: 'x-coredata://A/ICNote/p9' # from Notes\n---\nbody\n",
    )
    .unwrap();
    // Indented: not the note's own key.
    fs::write(
        store.root().join("Nested.md"),
        "---\nmeta:\n  apple-notes-id: p10\n---\nbody\n",
    )
    .unwrap();
    let report = store
        .import(&[
            note("x-coredata://A/ICNote/p9", "Kept", "x"),
            note("p10", "Ten", "y"),
        ])
        .unwrap();
    assert_eq!(report.already, ["Kept"]);
    assert_eq!(report.imported, ["Ten"]);
}

#[test]
fn a_locked_note_with_the_title_is_left_alone() {
    let (_dir, store) = store();
    store.create("Secret", "mine\n", Source::User).unwrap();
    store.lock("Secret").unwrap();
    let report = store.import(&[note("s", "Secret", "imported")]).unwrap();
    assert_eq!(
        report.renamed,
        [("Secret".to_owned(), "Secret 2".to_owned())]
    );
    assert!(store.read("Secret").unwrap().unwrap().meta.locked);
    assert_eq!(store.read("Secret").unwrap().unwrap().body, "mine\n");
    store.unlock("Secret").unwrap();
}
