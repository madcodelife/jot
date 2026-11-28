//! Locked notes (`lock.rs`), the trash as a folder, and `replace`. The flag is the real one (`chflags`) on macOS;
//! each test clears it again before its temporary folder goes, which the system would refuse to delete otherwise.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

use crate::lock::{frontmatter_locked, has_flag, set_flag, with_locked};
use crate::*;

/// A notes folder and a folder standing in for the trash, in a temporary folder whose files are unlocked before it
/// is deleted.
struct Fixture {
    dir: tempfile::TempDir,
    store: Store,
}

impl Fixture {
    fn new() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("Jot"))
            .unwrap()
            .with_trash_folder(dir.path().join("Trash"));
        Fixture { dir, store }
    }

    fn trash(&self) -> PathBuf {
        self.dir.path().join("Trash")
    }

    fn path(&self, title: &str) -> PathBuf {
        self.store.root().join(format!("{title}.md"))
    }

    fn write(&self, title: &str, content: &str, seconds: u64) {
        let path = self.path(title);
        fs::write(&path, content).unwrap();
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(at(seconds))
            .unwrap();
    }

    /// The file's bytes and modification time.
    fn snapshot(&self, title: &str) -> (String, SystemTime) {
        let path = self.path(title);
        (
            fs::read_to_string(&path).unwrap(),
            fs::metadata(&path).unwrap().modified().unwrap(),
        )
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        unlock_all(self.dir.path());
    }
}

fn unlock_all(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            unlock_all(&path);
        } else {
            let _ = set_flag(&path, false);
        }
    }
}

fn at(seconds: u64) -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(seconds)
}

#[test]
fn frontmatter_says_locked() {
    for (content, locked) in [
        ("---\nlocked: true\n---\nbody", true),
        ("---\nsource: claude\nlocked: TRUE # by me\n---\n", true),
        ("---\nlocked: \"true\"\n---\n", true),
        ("---\nlocked: false\n---\nbody", false),
        ("---\n  locked: true\n---\nbody", false),
        ("---\nunlocked: true\n---\nbody", false),
        ("locked: true\n", false),
        ("body\n---\nlocked: true\n---\n", false),
    ] {
        assert_eq!(frontmatter_locked(content), locked, "{content:?}");
    }
}

#[test]
fn locking_writes_the_frontmatter_and_unlocking_takes_it_out() {
    for (before, locked) in [
        ("body\n", "---\nlocked: true\n---\nbody\n"),
        ("", "---\nlocked: true\n---\n"),
        (
            "---\nsource: claude\n---\nbody",
            "---\nsource: claude\nlocked: true\n---\nbody",
        ),
        (
            "---\nsource: claude\nlocked: false\n---\nbody",
            "---\nsource: claude\nlocked: true\n---\nbody",
        ),
        (
            "---\r\nsource: x\r\n---\r\nbody\r\n",
            "---\r\nsource: x\r\nlocked: true\r\n---\r\nbody\r\n",
        ),
        // A closing line at the very end of the file.
        ("---\nsource: x\n---", "---\nsource: x\nlocked: true\n---"),
    ] {
        assert_eq!(with_locked(before, true), locked, "{before:?}");
        assert!(frontmatter_locked(&with_locked(before, true)));
        assert!(!frontmatter_locked(&with_locked(locked, false)));
    }
    // A frontmatter left with nothing goes; the rest of one stays.
    assert_eq!(
        with_locked("---\nlocked: true\n---\nbody\n", false),
        "body\n"
    );
    assert_eq!(
        with_locked("---\nsource: claude\nlocked: true\n---\nbody", false),
        "---\nsource: claude\n---\nbody"
    );
    assert_eq!(with_locked("body", false), "body");
}

#[test]
fn lock_and_unlock() {
    let f = Fixture::new();
    f.write(
        "Passport",
        "---\nsource: claude\n---\nExpires in May\n",
        100,
    );
    assert!(!f.store.list().unwrap()[0].locked);

    let meta = f.store.lock("passport").unwrap();
    assert!(meta.locked);
    assert_eq!(meta.modified, at(100), "locking is no change of the note");
    assert_eq!(meta.source, Source::agent("claude"));
    assert_eq!(
        fs::read_to_string(f.path("Passport")).unwrap(),
        "---\nsource: claude\nlocked: true\n---\nExpires in May\n"
    );
    assert_eq!(
        has_flag(&f.path("Passport")).unwrap(),
        cfg!(target_os = "macos")
    );
    assert!(f.store.list().unwrap()[0].locked);
    assert!(f.store.read("Passport").unwrap().unwrap().meta.locked);
    // Again: nothing changes.
    let before = f.snapshot("Passport");
    f.store.lock("Passport").unwrap();
    assert_eq!(f.snapshot("Passport"), before);

    let meta = f.store.unlock("Passport").unwrap();
    assert!(!meta.locked);
    assert_eq!(meta.modified, at(100));
    assert!(!has_flag(&f.path("Passport")).unwrap());
    assert_eq!(
        fs::read_to_string(f.path("Passport")).unwrap(),
        "---\nsource: claude\n---\nExpires in May\n"
    );
    f.store.write("Passport", "Renewed").unwrap();

    assert!(matches!(f.store.lock("Nothing"), Err(StoreError::NotFound)));
    assert!(matches!(
        f.store.unlock("Nothing"),
        Err(StoreError::NotFound)
    ));
}

/// Every write fails with `Locked` and leaves the file as it is: its bytes, its time, its name.
#[test]
fn a_locked_note_refuses_every_write() {
    let f = Fixture::new();
    f.write(
        "Plan",
        "---\nsource: user-clip\n---\n- [ ] call ⏰ 2026-11-20 09:00\n",
        100,
    );
    f.store.lock("Plan").unwrap();
    let before = f.snapshot("Plan");
    let today = jiff::civil::date(2026, 11, 25);
    let due = Some(jiff::civil::date(2026, 11, 26).at(9, 0, 0, 0));

    let refused: Vec<(&str, Result<(), StoreError>)> = vec![
        ("write", f.store.write("plan", "gone").map(drop)),
        ("append", f.store.append("Plan", "more").map(drop)),
        ("edit", f.store.edit("Plan", "call", "ring").map(drop)),
        (
            "set_todo_done",
            f.store
                .set_todo_done("Plan", 0, "call", true, today)
                .map(drop),
        ),
        (
            "set_todo_due",
            f.store.set_todo_due("Plan", 0, "call", due).map(drop),
        ),
        (
            "add_todo",
            f.store
                .add_todo(Some("Plan"), "more", None, Source::User)
                .map(drop),
        ),
        ("rename", f.store.rename("Plan", "Other").map(drop)),
        ("trash", f.store.trash("Plan").map(drop)),
        ("delete", f.store.delete("Plan")),
        (
            "replace",
            f.store
                .replace("Plan", "new", |t| format!("{t} (before)"))
                .map(drop),
        ),
    ];
    for (what, result) in refused {
        assert!(
            matches!(result, Err(StoreError::Locked)),
            "{what}: {result:?}"
        );
        assert_eq!(f.snapshot("Plan"), before, "{what} changed the file");
    }
    assert_eq!(titles(&f.store.list().unwrap()), ["Plan"]);
    assert!(!f.trash().exists(), "nothing went to the trash");
    assert!(f.store.todos().unwrap()[0].due.is_some());
    // Reading goes on.
    assert!(f.store.read("Plan").unwrap().unwrap().body.contains("call"));
    assert_eq!(f.store.search("call", 5).unwrap().len(), 1);
}

/// The frontmatter alone locks the note: a sync service dropped the flag, or the system has none.
#[test]
fn the_frontmatter_alone_locks_and_the_flag_comes_back() {
    let f = Fixture::new();
    f.write(
        "Synced",
        "---\nlocked: true\n---\nfrom the other Mac\n",
        100,
    );
    assert!(f.store.list().unwrap()[0].locked);
    assert!(matches!(
        f.store.append("Synced", "x"),
        Err(StoreError::Locked)
    ));
    assert!(matches!(f.store.trash("Synced"), Err(StoreError::Locked)));

    let before = f.snapshot("Synced");
    assert_eq!(f.store.settle_locks().unwrap(), ["Synced"]);
    assert_eq!(f.snapshot("Synced"), before, "only the flag changes");
    assert_eq!(
        has_flag(&f.path("Synced")).unwrap(),
        cfg!(target_os = "macos")
    );
    // Settled: nothing more to do.
    let again = f.store.settle_locks().unwrap();
    assert!(
        again.is_empty() || cfg!(not(target_os = "macos")),
        "{again:?}"
    );
}

/// Locked in Finder (the flag alone): Jot sees it locked and writes the frontmatter, keeping the flag and the time.
#[cfg(target_os = "macos")]
#[test]
fn a_note_locked_in_finder_is_locked_and_gets_the_frontmatter() {
    let f = Fixture::new();
    f.write("Finder", "---\nsource: cursor\n---\nlocked by hand\n", 100);
    f.write("Open", "free\n", 200);
    set_flag(&f.path("Finder"), true).unwrap();

    let list = f.store.list().unwrap();
    assert_eq!(
        list.iter()
            .map(|m| (m.title.as_str(), m.locked))
            .collect::<Vec<_>>(),
        [("Open", false), ("Finder", true)]
    );
    assert!(matches!(
        f.store.write("Finder", "x"),
        Err(StoreError::Locked)
    ));

    assert_eq!(f.store.settle_locks().unwrap(), ["Finder"]);
    let (content, modified) = f.snapshot("Finder");
    assert_eq!(
        content,
        "---\nsource: cursor\nlocked: true\n---\nlocked by hand\n"
    );
    assert_eq!(modified, at(100));
    assert!(has_flag(&f.path("Finder")).unwrap());
    assert!(f.store.settle_locks().unwrap().is_empty());

    // The system refuses whoever asks.
    assert!(fs::remove_file(f.path("Finder")).is_err());
    assert!(fs::rename(f.path("Finder"), f.path("Moved")).is_err());
    assert!(fs::write(f.path("Finder"), "x").is_err());
}

/// The flag set or cleared outside Jot (Finder, `chflags`) reaches the folder's watcher.
#[cfg(target_os = "macos")]
#[test]
fn the_watcher_sees_the_flag_change() {
    let f = Fixture::new();
    f.write("Watched", "text\n", 100);
    let (tx, rx) = mpsc::channel();
    let _watcher = f.store.watch(move || tx.send(()).unwrap()).unwrap();
    // The watcher starts listening a moment after it is made.
    std::thread::sleep(Duration::from_millis(300));
    while rx.try_recv().is_ok() {}
    set_flag(&f.path("Watched"), true).unwrap();
    rx.recv_timeout(Duration::from_secs(5))
        .expect("locking reported");
    std::thread::sleep(Duration::from_millis(300));
    while rx.try_recv().is_ok() {}
    set_flag(&f.path("Watched"), false).unwrap();
    rx.recv_timeout(Duration::from_secs(5))
        .expect("unlocking reported");
}

#[test]
fn a_locked_note_moves_locked() {
    let f = Fixture::new();
    let to = Store::open(f.dir.path().join("iCloud")).unwrap();
    f.write("Kept", "---\nsource: claude\n---\nsecret\n", 100);
    f.write("Free", "open\n", 200);
    f.store.lock("Kept").unwrap();
    // Locked in Finder only: moved with the frontmatter written, so a service that drops the flag keeps the lock.
    f.write("Finder", "by hand\n", 300);
    set_flag(&f.path("Finder"), true).unwrap();

    let moved = f.store.move_into(&to).unwrap();
    let mut titles = moved.moved.clone();
    titles.sort();
    assert_eq!(titles, ["Finder", "Free", "Kept"], "{moved:?}");
    assert!(moved.failed.is_empty(), "{moved:?}");
    assert!(f.store.list().unwrap().is_empty());

    let kept = to.root().join("Kept.md");
    assert_eq!(
        fs::read_to_string(&kept).unwrap(),
        "---\nsource: claude\nlocked: true\n---\nsecret\n"
    );
    assert_eq!(fs::metadata(&kept).unwrap().modified().unwrap(), at(100));
    assert_eq!(has_flag(&kept).unwrap(), cfg!(target_os = "macos"));
    let finder = to.root().join("Finder.md");
    if cfg!(target_os = "macos") {
        assert!(has_flag(&finder).unwrap());
        assert_eq!(
            fs::read_to_string(&finder).unwrap(),
            "---\nlocked: true\n---\nby hand\n"
        );
    }
    assert!(!has_flag(&to.root().join("Free.md")).unwrap());
    let locked: Vec<bool> = to.list().unwrap().iter().map(|m| m.locked).collect();
    assert_eq!(
        locked,
        [cfg!(target_os = "macos"), false, true],
        "Finder, Free, Kept"
    );
}

#[test]
fn trash_to_a_folder_and_back() {
    let f = Fixture::new();
    f.write("Passport", "---\nsource: claude\n---\nExpires in May", 100);
    let trashed = f.store.trash("passport").unwrap();
    let in_trash = trashed.in_trash.clone().unwrap();
    assert_eq!(in_trash, f.trash().join("Passport.md"));
    assert!(f.store.list().unwrap().is_empty());
    // A second note of the title gets a number in the trash, as the system's does.
    f.write("Passport", "again", 200);
    let second = f.store.trash("Passport").unwrap();
    assert_eq!(second.in_trash.unwrap(), f.trash().join("Passport 2.md"));

    let meta = f.store.restore(&trashed).unwrap();
    assert_eq!(meta.title, "Passport");
    assert_eq!(meta.modified, at(100));
    assert!(!in_trash.exists());
    assert_eq!(
        fs::read_to_string(f.path("Passport")).unwrap(),
        "---\nsource: claude\n---\nExpires in May"
    );
}

#[test]
fn replace_puts_the_old_version_in_the_trash() {
    let f = Fixture::new();
    f.write(
        "Plan",
        "---\nsource: \"https://example.com\"\nkeep: me\n---\nold text\n",
        100,
    );
    let replaced = f
        .store
        .replace("plan", "new text\n", |title| {
            format!("{title} (before rewrite · 2026-11-25 14.30)")
        })
        .unwrap();
    assert_eq!(
        fs::read_to_string(f.path("Plan")).unwrap(),
        "---\nsource: \"https://example.com\"\nkeep: me\n---\nnew text\n",
        "the frontmatter stays as it was"
    );
    assert_eq!(replaced.note.title, "Plan");
    assert_eq!(replaced.note.preview, "new text");
    let previous = replaced.previous.unwrap();
    assert_eq!(previous.title, "Plan (before rewrite · 2026-11-25 14.30)");
    let in_trash = previous.in_trash.unwrap();
    assert_eq!(
        in_trash,
        f.trash()
            .join("Plan (before rewrite · 2026-11-25 14.30).md")
    );
    assert_eq!(
        fs::read_to_string(&in_trash).unwrap(),
        "---\nsource: \"https://example.com\"\nkeep: me\n---\nold text\n",
        "the whole file as it was"
    );
    assert_eq!(
        fs::metadata(&in_trash).unwrap().modified().unwrap(),
        at(100)
    );
    // Nothing else showed up in the notes folder.
    assert_eq!(titles(&f.store.list().unwrap()), ["Plan"]);

    // The same body again: nothing changes, nothing goes to the trash.
    let before = f.snapshot("Plan");
    let same = f
        .store
        .replace("Plan", "new text\n", |t| format!("{t} (again)"))
        .unwrap();
    assert!(same.previous.is_none());
    assert_eq!(f.snapshot("Plan"), before);
    assert_eq!(fs::read_dir(f.trash()).unwrap().count(), 1);

    assert!(matches!(
        f.store.replace("Nothing", "x", |t| t.to_owned()),
        Err(StoreError::NotFound)
    ));
    // A name the folder could not take: the note stays.
    assert!(matches!(
        f.store.replace("Plan", "x", |_| ".hidden".to_owned()),
        Err(StoreError::InvalidTitle)
    ));
    assert_eq!(f.snapshot("Plan"), before);
}

#[test]
fn errors_say_locked() {
    assert_eq!(StoreError::Locked.to_string(), "the note is locked");
}

fn titles(notes: &[NoteMeta]) -> Vec<&str> {
    notes.iter().map(|meta| meta.title.as_str()).collect()
}

/// On a real iCloud Drive folder: iCloud Drive clears the flag when it uploads the note's new text (the frontmatter
/// Jot wrote), and `settle_locks` puts it back for good. Run it on a Mac signed in to iCloud, in a test folder:
/// `JOT_ICLOUD_DIR=<a test folder in iCloud Drive> cargo test -p jot-store lock_on_icloud_drive -- --ignored --nocapture`.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "needs iCloud Drive: JOT_ICLOUD_DIR=<a test folder in iCloud Drive>"]
fn lock_on_icloud_drive() {
    let dir = PathBuf::from(std::env::var("JOT_ICLOUD_DIR").expect("JOT_ICLOUD_DIR"));
    let store = Store::open(&dir).unwrap();
    let title = format!("lock-{}", std::process::id());
    store.create(&title, "keep me\n", Source::User).unwrap();
    let path = store.root().join(format!("{title}.md"));
    // Uploaded first, as a note is long before it is locked.
    std::thread::sleep(Duration::from_secs(8));

    store.lock(&title).unwrap();
    assert!(has_flag(&path).unwrap());
    let mut cleared_after = None;
    for tenth in 0..150 {
        std::thread::sleep(Duration::from_millis(100));
        if !has_flag(&path).unwrap() {
            cleared_after = Some(tenth);
            break;
        }
    }
    println!(
        "iCloud Drive cleared the flag after the upload: {}",
        cleared_after.map_or("no (within 15 s)".to_owned(), |t| format!(
            "after ~{} ms",
            t * 100
        ))
    );
    // Locked all the same, by its frontmatter; settling puts the flag back.
    assert!(store.read(&title).unwrap().unwrap().meta.locked);
    assert!(matches!(store.append(&title, "x"), Err(StoreError::Locked)));
    store.settle_locks().unwrap();
    assert!(has_flag(&path).unwrap());
    // A flag alone (no new text) stays.
    std::thread::sleep(Duration::from_secs(15));
    assert!(has_flag(&path).unwrap(), "the flag set again stays");
    println!("the flag set again stayed for 15 s");

    store.unlock(&title).unwrap();
    store.delete(&title).unwrap();
}
