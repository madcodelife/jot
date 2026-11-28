//! A note's version history (`history.rs`): when a version is saved, how long it is kept, a rename, one history per
//! notes folder, `replace` and `restore_version`. The clock is the test's own.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::*;

const MINUTE: Duration = Duration::from_secs(60);
const DAY: Duration = Duration::from_secs(24 * 60 * 60);

/// A notes folder, its history in a folder of the test's, and a clock the test moves.
struct Fixture {
    dir: tempfile::TempDir,
    store: Store,
    clock: Arc<Mutex<SystemTime>>,
}

impl Fixture {
    fn new() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let clock = Arc::new(Mutex::new(UNIX_EPOCH + Duration::from_secs(1_800_000_000)));
        let store = Fixture::open(dir.path(), "Jot", &clock);
        Fixture { dir, store, clock }
    }

    fn open(dir: &Path, folder: &str, clock: &Arc<Mutex<SystemTime>>) -> Store {
        let clock = clock.clone();
        Store::open(dir.join(folder))
            .unwrap()
            .with_trash_folder(dir.join("Trash"))
            .with_history_folder(dir.join("History"))
            .with_history_clock(move || *clock.lock().unwrap())
    }

    fn history(&self) -> PathBuf {
        self.dir.path().join("History")
    }

    fn advance(&self, by: Duration) {
        *self.clock.lock().unwrap() += by;
    }

    /// The bodies of the note's versions, newest first.
    fn bodies(&self, title: &str) -> Vec<String> {
        self.store
            .versions(title)
            .unwrap()
            .into_iter()
            .map(|version| version.body)
            .collect()
    }

    fn body(&self, title: &str) -> String {
        self.store.read(title).unwrap().unwrap().body
    }
}

#[test]
fn a_session_of_typing_keeps_the_text_from_before_it() {
    let f = Fixture::new();
    f.store.create("Plan", "one\n", Source::User).unwrap();
    // A new note has nothing before it.
    assert!(f.bodies("Plan").is_empty());

    // Typing: the text before the first save is kept, the saves a moment after it are not.
    f.store.write("Plan", "one two\n").unwrap();
    f.advance(MINUTE);
    f.store.write("Plan", "one two three\n").unwrap();
    f.advance(8 * MINUTE);
    f.store.write("Plan", "one two three four\n").unwrap();
    assert_eq!(f.bodies("Plan"), ["one\n"]);

    // Ten minutes after the last version: the next change keeps the text as it is.
    f.advance(2 * MINUTE);
    f.store.write("Plan", "five\n").unwrap();
    assert_eq!(f.bodies("Plan"), ["one two three four\n", "one\n"]);

    // A save that changes nothing keeps nothing.
    f.advance(20 * MINUTE);
    f.store.write("Plan", "five\n").unwrap();
    assert_eq!(f.bodies("Plan").len(), 2);
}

/// A write of the store, run on the fixture's.
type Edit = Box<dyn Fn(&Store)>;

#[test]
fn every_write_that_changes_a_note_keeps_its_text() {
    let f = Fixture::new();
    f.store
        .create("Plan", "- [ ] call\n", Source::agent("claude"))
        .unwrap();
    let today = jiff::civil::date(2026, 11, 28);
    let edits: Vec<(&str, Edit)> = vec![
        (
            "append",
            Box::new(|s| drop(s.append("Plan", "more").unwrap())),
        ),
        (
            "add_todo",
            Box::new(|s| drop(s.add_todo(Some("Plan"), "pay", None, Source::User).unwrap())),
        ),
        (
            "set_todo_due",
            Box::new(|s| {
                let due = jiff::civil::date(2026, 12, 1).at(9, 0, 0, 0);
                drop(s.set_todo_due("Plan", 0, "call", Some(due)).unwrap())
            }),
        ),
        (
            "set_todo_done",
            Box::new(move |s| drop(s.set_todo_done("Plan", 0, "call", true, today).unwrap())),
        ),
    ];
    for (what, edit) in edits {
        f.advance(QUIET);
        let before = f.body("Plan");
        edit(&f.store);
        assert_eq!(f.bodies("Plan")[0], before, "{what}");
    }
    // The whole file is kept: a version's body is the text after the frontmatter.
    let version = &f.store.versions("Plan").unwrap()[0];
    assert!(!version.body.contains("source:"));
}

#[test]
fn a_version_keeps_the_time_its_text_is_from() {
    let f = Fixture::new();
    f.store.create("Plan", "old\n", Source::User).unwrap();
    let file = f.store.root().join("Plan.md");
    let then = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    fs::File::options()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(then)
        .unwrap();
    f.store.write("Plan", "new\n").unwrap();
    let version = &f.store.versions("plan").unwrap()[0];
    assert_eq!(version.modified, then);
    assert_eq!(version.saved, *f.clock.lock().unwrap());
    assert_eq!(version.id, "1800000000000");
}

#[test]
fn old_versions_go_and_a_note_keeps_fifty() {
    let f = Fixture::new();
    f.store.create("Plan", "0\n", Source::User).unwrap();
    for n in 1..=60 {
        f.advance(QUIET);
        f.store.write("Plan", &format!("{n}\n")).unwrap();
    }
    let bodies = f.bodies("Plan");
    assert_eq!(bodies.len(), KEPT);
    // The oldest went first.
    assert_eq!(bodies[0], "59\n");
    assert_eq!(bodies[KEPT - 1], "10\n");

    // A month later, the next version is the only one left.
    f.advance(KEPT_FOR + MINUTE);
    f.store.write("Plan", "later\n").unwrap();
    assert_eq!(f.bodies("Plan"), ["60\n"]);
}

#[test]
fn a_trashed_notes_history_stays_until_it_ages_out() {
    let f = Fixture::new();
    f.store.create("Gone", "a\n", Source::User).unwrap();
    f.store.write("Gone", "b\n").unwrap();
    f.store.trash("Gone").unwrap();
    assert_eq!(f.bodies("Gone"), ["a\n"]);

    // Another note's writes sweep the folder's history once a day: the trashed note's goes once it is a month old.
    f.store.create("Other", "1\n", Source::User).unwrap();
    f.advance(KEPT_FOR - DAY);
    f.store.write("Other", "2\n").unwrap();
    assert_eq!(f.bodies("Gone"), ["a\n"]);
    f.advance(2 * DAY);
    f.store.write("Other", "3\n").unwrap();
    assert!(f.bodies("Gone").is_empty());
    assert_eq!(f.bodies("Other"), ["2\n", "1\n"]);
}

#[test]
fn a_renamed_note_takes_its_history_along() {
    let f = Fixture::new();
    f.store.create("Plan", "one\n", Source::User).unwrap();
    f.store.write("Plan", "two\n").unwrap();
    f.store.rename("Plan", "Trip").unwrap();
    assert!(f.bodies("Plan").is_empty());
    assert_eq!(f.bodies("Trip"), ["one\n"]);

    // Only its case: the same history.
    f.store.rename("Trip", "TRIP").unwrap();
    assert_eq!(f.bodies("trip"), ["one\n"]);

    // Onto a title whose note was trashed: the two histories are one.
    f.advance(MINUTE);
    f.store.create("Old", "x\n", Source::User).unwrap();
    f.store.write("Old", "y\n").unwrap();
    f.store.trash("Old").unwrap();
    f.store.rename("TRIP", "Old").unwrap();
    assert_eq!(f.bodies("Old"), ["x\n", "one\n"]);
}

#[test]
fn each_notes_folder_has_a_history_of_its_own() {
    let f = Fixture::new();
    let other = Fixture::open(f.dir.path(), "Elsewhere", &f.clock);
    f.store.create("Plan", "here\n", Source::User).unwrap();
    f.store.write("Plan", "here 2\n").unwrap();
    other.create("Plan", "there\n", Source::User).unwrap();
    other.write("Plan", "there 2\n").unwrap();
    assert_eq!(f.bodies("Plan"), ["here\n"]);
    assert_eq!(
        other
            .versions("Plan")
            .unwrap()
            .into_iter()
            .map(|v| v.body)
            .collect::<Vec<_>>(),
        ["there\n"]
    );
    // The same folder opened again, by another path to it, is the same history.
    #[cfg(unix)]
    {
        let link = f.dir.path().join("Link");
        std::os::unix::fs::symlink(f.store.root(), &link).unwrap();
        let again = Store::open(&link).unwrap().with_history_folder(f.history());
        assert_eq!(again.versions("Plan").unwrap().len(), 1);
    }
    // Two folders in the history, nothing in the notes folders.
    let folders = fs::read_dir(f.history()).unwrap().count();
    assert_eq!(folders, 2);
    assert_eq!(fs::read_dir(f.store.root()).unwrap().count(), 1);
}

#[test]
fn replace_keeps_the_previous_version_in_the_history() {
    let f = Fixture::new();
    fs::write(
        f.store.root().join("Plan.md"),
        "---\nsource: \"https://example.com\"\nkeep: me\n---\nold text\n",
    )
    .unwrap();
    // Right after another version: a rewrite keeps the text all the same.
    f.store.write("Plan", "edited\n").unwrap();
    let replaced = f.store.replace("plan", "new text\n").unwrap();
    assert_eq!(
        fs::read_to_string(f.store.root().join("Plan.md")).unwrap(),
        "---\nsource: \"https://example.com\"\nkeep: me\n---\nnew text\n",
        "the frontmatter stays as it was"
    );
    assert_eq!(replaced.note.title, "Plan");
    let previous = replaced.previous.unwrap();
    assert_eq!(previous.body, "edited\n");
    assert_eq!(f.bodies("Plan"), ["edited\n", "old text\n"]);
    // Nothing went to the trash, nothing else showed up in the folder.
    assert!(!f.dir.path().join("Trash").exists());
    assert_eq!(f.store.list().unwrap().len(), 1);

    // The same body again: nothing changes, nothing is kept.
    let same = f.store.replace("Plan", "new text\n").unwrap();
    assert!(same.previous.is_none());
    assert_eq!(f.bodies("Plan").len(), 2);
    assert!(matches!(
        f.store.replace("Nothing", "x"),
        Err(StoreError::NotFound)
    ));
}

#[test]
fn replace_without_a_history_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("Jot")).unwrap();
    store.create("Plan", "old\n", Source::User).unwrap();
    assert!(matches!(
        store.replace("Plan", "new\n"),
        Err(StoreError::Io(_))
    ));
    assert_eq!(store.read("Plan").unwrap().unwrap().body, "old\n");
    // Other writes go on without one.
    store.write("Plan", "typed\n").unwrap();
    assert!(store.versions("Plan").unwrap().is_empty());
}

#[test]
fn a_history_that_cannot_be_written_never_stops_a_write() {
    let dir = tempfile::tempdir().unwrap();
    // A file where the history's folder would be.
    fs::write(dir.path().join("History"), "").unwrap();
    let store = Store::open(dir.path().join("Jot"))
        .unwrap()
        .with_history_folder(dir.path().join("History"));
    store.create("Plan", "old\n", Source::User).unwrap();
    store.write("Plan", "new\n").unwrap();
    store.append("Plan", "more").unwrap();
    assert_eq!(store.read("Plan").unwrap().unwrap().body, "new\n\nmore\n");
    // A rewrite stops instead, the note as it was.
    assert!(store.replace("Plan", "all new\n").is_err());
    assert_eq!(store.read("Plan").unwrap().unwrap().body, "new\n\nmore\n");
}

#[test]
fn restoring_a_version_keeps_the_text_it_replaces() {
    let f = Fixture::new();
    fs::write(
        f.store.root().join("Plan.md"),
        "---\nicon: \"🍕\"\n---\ngood\n",
    )
    .unwrap();
    f.store.write("Plan", "bad\n").unwrap();
    let good = f.store.versions("Plan").unwrap().remove(0);
    assert_eq!(good.body, "good\n");

    // Right after the last version: the text it replaces is kept all the same.
    let meta = f.store.restore_version("plan", &good.id).unwrap();
    assert_eq!(meta.title, "Plan");
    assert_eq!(
        fs::read_to_string(f.store.root().join("Plan.md")).unwrap(),
        "---\nicon: \"🍕\"\n---\ngood\n",
        "the body comes back, the frontmatter stays"
    );
    assert_eq!(f.bodies("Plan"), ["bad\n", "good\n"]);

    // The text it has already: nothing changes.
    f.store.restore_version("Plan", &good.id).unwrap();
    assert_eq!(f.bodies("Plan").len(), 2);

    assert!(matches!(
        f.store.restore_version("Plan", "12345"),
        Err(StoreError::NotFound)
    ));
    assert!(matches!(
        f.store.restore_version("Nothing", &good.id),
        Err(StoreError::NotFound)
    ));
}

#[test]
fn saving_a_version_whenever() {
    let f = Fixture::new();
    f.store.create("Plan", "one\n", Source::User).unwrap();
    f.store.save_version("Plan").unwrap();
    f.advance(Duration::from_millis(1));
    f.store.save_version("Plan").unwrap();
    assert_eq!(f.bodies("Plan"), ["one\n", "one\n"]);
    assert!(matches!(
        f.store.save_version("Nothing"),
        Err(StoreError::NotFound)
    ));
}
