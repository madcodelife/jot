//! A synced folder, on a temporary one: an older iCloud Drive's placeholders are real files here; dataless files
//! and conflict versions come from a stand-in for the system ([`FakeCloud`]).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, SystemTime};

use super::cloud::{Cloud, Version, placeholder_title};
use super::*;

/// The system's iCloud Drive, as the tests see it.
#[derive(Debug, Default)]
struct FakeCloud {
    /// Files whose text is not on this Mac (dataless): their bytes stay on disk, but no read sees them.
    remote: Mutex<HashSet<PathBuf>>,
    /// The downloads asked for, in order.
    asked: Mutex<Vec<PathBuf>>,
    /// Each file's unresolved conflict versions.
    versions: Mutex<HashMap<PathBuf, Vec<Version>>>,
}

impl FakeCloud {
    fn evict(&self, path: PathBuf) {
        self.remote.lock().unwrap().insert(path);
    }

    /// The download asked for of `path` lands.
    fn arrive(&self, path: &Path) {
        self.remote.lock().unwrap().remove(path);
    }

    fn asked(&self) -> Vec<PathBuf> {
        self.asked.lock().unwrap().clone()
    }

    /// Another device's version of the file at `path`, saved in `versions` (the service's own store).
    fn conflict(
        &self,
        path: &Path,
        versions: &Path,
        id: &str,
        device: &str,
        content: &str,
        seconds: u64,
    ) {
        fs::create_dir_all(versions).unwrap();
        let file = versions.join(id);
        fs::write(&file, content).unwrap();
        self.versions
            .lock()
            .unwrap()
            .entry(path.to_owned())
            .or_default()
            .push(Version {
                id: id.to_owned(),
                device: Some(device.to_owned()),
                modified: SystemTime::UNIX_EPOCH + Duration::from_secs(seconds),
                file,
            });
    }
}

impl Cloud for FakeCloud {
    fn is_dataless(&self, path: &Path, _metadata: &fs::Metadata) -> bool {
        self.remote.lock().unwrap().contains(path)
    }

    fn read(&self, path: &Path) -> io::Result<Option<String>> {
        if self.remote.lock().unwrap().contains(path) {
            return Ok(None);
        }
        fs::read_to_string(path).map(Some)
    }

    fn download(&self, path: &Path) {
        self.asked.lock().unwrap().push(path.to_owned());
    }

    fn conflicts(&self, path: &Path) -> io::Result<Vec<Version>> {
        let mut versions = self
            .versions
            .lock()
            .unwrap()
            .get(path)
            .cloned()
            .unwrap_or_default();
        versions.sort_by_key(|version| std::cmp::Reverse(version.modified));
        Ok(versions)
    }

    fn resolve(&self, path: &Path, id: &str) -> io::Result<()> {
        if let Some(versions) = self.versions.lock().unwrap().get_mut(path) {
            versions.retain(|version| version.id != id);
        }
        Ok(())
    }
}

fn synced() -> (tempfile::TempDir, Store, Arc<FakeCloud>) {
    let dir = tempfile::tempdir().unwrap();
    let cloud = Arc::new(FakeCloud::default());
    let store = Store::with_cloud(dir.path().join("Jot"), cloud.clone()).unwrap();
    (dir, store, cloud)
}

fn titles(notes: &[NoteMeta]) -> Vec<&str> {
    notes.iter().map(|meta| meta.title.as_str()).collect()
}

/// An older iCloud Drive's placeholder for `title` (a small property list, as it wrote them).
fn placeholder(store: &Store, title: &str) -> PathBuf {
    let path = store.root().join(format!(".{title}.md.icloud"));
    fs::write(&path, b"bplist00\xd3\x01\x02\x03").unwrap();
    path
}

#[test]
fn placeholder_names() {
    assert_eq!(
        placeholder_title(Path::new("/n/.Shopping.md.icloud")),
        Some("Shopping")
    );
    assert_eq!(
        placeholder_title(Path::new("/n/.a.b.MD.icloud")),
        Some("a.b")
    );
    for not in [
        "/n/Shopping.md.icloud",
        "/n/.Shopping.txt.icloud",
        "/n/.Shopping.md",
        "/n/.md.icloud",
        "/n/..hidden.md.icloud",
        "/n/.Shopping.md.icloud.tmp",
    ] {
        assert_eq!(placeholder_title(Path::new(not)), None, "{not}");
    }
}

#[test]
fn placeholders_are_listed_as_notes_downloading_and_asked_for() {
    let (_dir, store, cloud) = synced();
    store.create("Here", "text", Source::User).unwrap();
    placeholder(&store, "Away");

    let notes = store.list().unwrap();
    let mut listed = titles(&notes);
    listed.sort();
    assert_eq!(listed, ["Away", "Here"]);
    let away = notes.iter().find(|meta| meta.title == "Away").unwrap();
    assert!(away.downloading);
    assert_eq!(away.preview, "");
    assert_eq!(away.source, Source::User);
    assert!(
        !notes
            .iter()
            .find(|meta| meta.title == "Here")
            .unwrap()
            .downloading
    );
    assert!(cloud.asked().contains(&store.root().join("Away.md")));

    // Read: there, empty, downloading; never mistaken for a missing note.
    let note = store.read("away").unwrap().unwrap();
    assert!(note.meta.downloading);
    assert_eq!(note.body, "");
    // The title is taken.
    assert!(matches!(
        store.create("Away", "x", Source::User),
        Err(StoreError::AlreadyExists)
    ));
    // Search finds it by its title; its body cannot be searched yet.
    assert_eq!(
        titles(
            &store
                .search("away", 10)
                .unwrap()
                .into_iter()
                .map(|h| h.meta)
                .collect::<Vec<_>>()
        ),
        ["Away"]
    );
}

#[test]
fn notes_not_downloaded_are_never_written() {
    let (_dir, store, cloud) = synced();
    let stub = placeholder(&store, "Away");
    store
        .create("Evicted", "- [ ] pay rent\n", Source::User)
        .unwrap();
    let evicted = store.root().join("Evicted.md");
    cloud.evict(evicted.clone());

    for title in ["Away", "Evicted"] {
        assert!(
            matches!(store.write(title, "new"), Err(StoreError::NotDownloaded)),
            "{title}"
        );
        assert!(
            matches!(store.append(title, "more"), Err(StoreError::NotDownloaded)),
            "{title}"
        );
        assert!(
            matches!(store.trash(title), Err(StoreError::NotDownloaded)),
            "{title}"
        );
        assert!(
            matches!(
                store.add_todo(Some(title), "x", None, Source::User),
                Err(StoreError::NotDownloaded)
            ),
            "{title}"
        );
    }
    assert!(matches!(
        store.rename("Away", "Elsewhere"),
        Err(StoreError::NotDownloaded)
    ));
    assert_eq!(
        fs::read_to_string(&evicted).unwrap(),
        "- [ ] pay rent\n",
        "the evicted file is untouched"
    );
    assert!(stub.exists());
    // Its to-dos are not seen until it is here.
    assert!(store.todos().unwrap().is_empty());

    // It lands: the note is whole again, and writable.
    cloud.arrive(&evicted);
    let note = store.read("Evicted").unwrap().unwrap();
    assert!(!note.meta.downloading);
    assert_eq!(note.body, "- [ ] pay rent\n");
    assert_eq!(store.todos().unwrap().len(), 1);
    store.append("Evicted", "more").unwrap();

    // A dataless file renames as it is (nothing to download for a rename).
    cloud.evict(evicted.clone());
    store.rename("Evicted", "Moved").unwrap();
    assert!(store.root().join("Moved.md").exists());
}

#[test]
fn a_placeholder_beside_its_file_is_the_file() {
    let (_dir, store, _cloud) = synced();
    store.create("Both", "text", Source::User).unwrap();
    placeholder(&store, "Both");
    let notes = store.list().unwrap();
    assert_eq!(titles(&notes), ["Both"]);
    assert!(!notes[0].downloading);
    assert_eq!(store.read("Both").unwrap().unwrap().body, "text");
}

#[test]
fn deleting_a_placeholder_removes_it() {
    let (_dir, store, _cloud) = synced();
    let stub = placeholder(&store, "Away");
    assert_eq!(store.path("Away").unwrap(), Some(stub.clone()));
    store.delete("Away").unwrap();
    assert!(!stub.exists());
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn the_watcher_reports_placeholders_coming_and_going() {
    let (_dir, store, _cloud) = synced();
    let (sender, receiver) = mpsc::channel();
    let watcher = store
        .watch(move || {
            let _ = sender.send(());
        })
        .unwrap();
    std::thread::sleep(Duration::from_millis(300));
    while receiver.try_recv().is_ok() {}

    let stub = placeholder(&store, "Away");
    receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("a placeholder appearing");
    while receiver.try_recv().is_ok() {}
    // Downloaded: the file comes, the placeholder goes.
    fs::write(store.root().join("Away.md"), "text").unwrap();
    fs::remove_file(stub).unwrap();
    receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("the download landing");
    drop(watcher);
}

#[test]
fn conflicts_are_listed_newest_first_with_their_text() {
    let (dir, store, cloud) = synced();
    store.create("Plan", "mine", Source::User).unwrap();
    let path = store.root().join("Plan.md");
    let versions = dir.path().join("versions");
    cloud.conflict(&path, &versions, "v1", "iPad", "older", 100);
    cloud.conflict(
        &path,
        &versions,
        "v2",
        "iPhone",
        "---\nsource: claude\n---\ntheirs",
        200,
    );

    let conflicts = store.conflicts("plan").unwrap();
    assert_eq!(conflicts.len(), 2);
    assert_eq!(conflicts[0].id, "v2");
    assert_eq!(conflicts[0].device.as_deref(), Some("iPhone"));
    assert_eq!(
        conflicts[0].body, "theirs",
        "the body, without the frontmatter"
    );
    assert_eq!(conflicts[1].body, "older");
    assert!(store.conflicts("Other").is_err());

    // A version whose text is gone is left out, not an error.
    fs::remove_file(versions.join("v1")).unwrap();
    assert_eq!(store.conflicts("Plan").unwrap().len(), 1);
}

#[test]
fn keeping_this_version() {
    let (dir, store, cloud) = synced();
    store.create("Plan", "mine", Source::User).unwrap();
    let path = store.root().join("Plan.md");
    cloud.conflict(&path, &dir.path().join("v"), "v1", "iPhone", "theirs", 100);

    let resolved = store
        .resolve("Plan", "v1", Resolution::KeepCurrent)
        .unwrap();
    assert_eq!(resolved.note.title, "Plan");
    assert_eq!(resolved.copy, None);
    assert_eq!(fs::read_to_string(&path).unwrap(), "mine");
    assert!(store.conflicts("Plan").unwrap().is_empty());
    // Settled already: `Changed`.
    assert!(matches!(
        store.resolve("Plan", "v1", Resolution::KeepCurrent),
        Err(StoreError::Changed)
    ));
}

#[test]
fn using_the_other_version_takes_its_whole_file() {
    let (dir, store, cloud) = synced();
    store.create("Plan", "mine", Source::User).unwrap();
    let path = store.root().join("Plan.md");
    cloud.conflict(
        &path,
        &dir.path().join("v"),
        "v1",
        "iPhone",
        "---\nsource: cursor\n---\ntheirs",
        100,
    );

    let resolved = store.resolve("Plan", "v1", Resolution::UseOther).unwrap();
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "---\nsource: cursor\n---\ntheirs"
    );
    assert_eq!(resolved.note.source, Source::agent("cursor"));
    assert!(store.conflicts("Plan").unwrap().is_empty());
    assert_eq!(store.read("Plan").unwrap().unwrap().body, "theirs");
}

#[test]
fn keeping_both_makes_the_other_version_a_note() {
    let (dir, store, cloud) = synced();
    store.create("Plan", "mine", Source::User).unwrap();
    store
        .create("Plan (iPhone)", "taken", Source::User)
        .unwrap();
    let path = store.root().join("Plan.md");
    cloud.conflict(
        &path,
        &dir.path().join("v"),
        "v1",
        "iPhone",
        "theirs",
        1_000,
    );

    let resolved = store
        .resolve(
            "Plan",
            "v1",
            Resolution::KeepBoth {
                title: "Plan (iPhone)".into(),
            },
        )
        .unwrap();
    let copy = resolved.copy.unwrap();
    assert_eq!(copy.title, "Plan (iPhone) 2", "a free title");
    assert_eq!(
        copy.modified,
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_000),
        "when it was saved"
    );
    assert_eq!(
        store.read("Plan (iPhone) 2").unwrap().unwrap().body,
        "theirs"
    );
    assert_eq!(store.read("Plan").unwrap().unwrap().body, "mine");
    assert_eq!(store.read("Plan (iPhone)").unwrap().unwrap().body, "taken");
    assert!(store.conflicts("Plan").unwrap().is_empty());
}

#[test]
fn moving_notes_never_replaces_one() {
    let dir = tempfile::tempdir().unwrap();
    let from = Store::open(dir.path().join("Documents/Jot")).unwrap();
    let to = Store::open(dir.path().join("iCloud/Jot")).unwrap();
    from.create("Alone", "a", Source::User).unwrap();
    from.create("Same", "same text", Source::agent("claude"))
        .unwrap();
    from.create("Clash", "mine", Source::User).unwrap();
    fs::write(from.root().join("notes.txt"), "not a note").unwrap();
    let when = SystemTime::UNIX_EPOCH + Duration::from_secs(5_000);
    fs::File::options()
        .write(true)
        .open(from.root().join("Alone.md"))
        .unwrap()
        .set_modified(when)
        .unwrap();
    // The very same file, under another case of its title.
    fs::write(
        to.root().join("same.md"),
        fs::read_to_string(from.root().join("Same.md")).unwrap(),
    )
    .unwrap();
    to.create("Clash", "theirs", Source::User).unwrap();
    to.create("Clash 2", "theirs too", Source::User).unwrap();

    let moved = from.move_into(&to).unwrap();
    assert_eq!(moved.moved, ["Alone"]);
    assert_eq!(moved.renamed, [("Clash".to_owned(), "Clash 3".to_owned())]);
    assert_eq!(moved.same, ["Same"]);
    assert!(moved.failed.is_empty());

    assert_eq!(
        to.read("Alone").unwrap().unwrap().meta.modified,
        when,
        "the file's dates kept"
    );
    assert_eq!(to.read("Clash").unwrap().unwrap().body, "theirs");
    assert_eq!(to.read("Clash 3").unwrap().unwrap().body, "mine");
    // Left behind: the same note, and what is not a note.
    assert_eq!(titles(&from.list().unwrap()), ["Same"]);
    assert!(from.root().join("notes.txt").exists());
    // Again: nothing more to move, nothing duplicated.
    let again = from.move_into(&to).unwrap();
    assert_eq!(again.same, ["Same"]);
    assert!(again.moved.is_empty() && again.renamed.is_empty());
    assert_eq!(to.list().unwrap().len(), 5);
}

#[test]
fn moving_leaves_a_placeholder_and_moves_a_dataless_file() {
    let dir = tempfile::tempdir().unwrap();
    let cloud = Arc::new(FakeCloud::default());
    let from = Store::with_cloud(dir.path().join("a"), cloud.clone()).unwrap();
    let to = Store::with_cloud(dir.path().join("b"), cloud.clone()).unwrap();
    placeholder(&from, "Away");
    from.create("Evicted", "text", Source::User).unwrap();
    cloud.evict(from.root().join("Evicted.md"));

    let moved = from.move_into(&to).unwrap();
    assert_eq!(moved.moved, ["Evicted"], "a rename needs no download");
    assert_eq!(moved.failed.len(), 1);
    assert_eq!(moved.failed[0].0, "Away");
    assert!(to.root().join("Evicted.md").exists());
}

/// On a real iCloud Drive folder of its own (`JOT_ICLOUD_DIR`): notes are written, listed and read as anywhere,
/// none shows as downloading, the conflict check is cheap, and the watcher hears changes. Run by hand on a Mac
/// signed in to iCloud: `JOT_ICLOUD_DIR=… cargo test -p jot-store on_icloud_drive -- --ignored --nocapture`.
#[test]
#[ignore = "needs iCloud Drive: JOT_ICLOUD_DIR=<a test folder in iCloud Drive>"]
fn on_icloud_drive() {
    let Some(dir) = std::env::var_os("JOT_ICLOUD_DIR") else {
        return;
    };
    let store = Store::open(PathBuf::from(dir)).unwrap();
    let (sender, receiver) = mpsc::channel();
    let watcher = store
        .watch(move || {
            let _ = sender.send(());
        })
        .unwrap();
    std::thread::sleep(Duration::from_millis(500));
    while receiver.try_recv().is_ok() {}

    store.write("Probe", "- [ ] probe tomorrow 9am\n").unwrap();
    receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("the watcher hears a write in iCloud Drive");
    store.append("Probe", "more").unwrap();
    assert_eq!(
        store.read("Probe").unwrap().unwrap().body,
        "- [ ] probe tomorrow 9am\n\nmore\n"
    );

    for _ in 0..3 {
        let started = std::time::Instant::now();
        let count = store.list().unwrap().len();
        println!("list: {count} notes in {:?}", started.elapsed());
        let started = std::time::Instant::now();
        store.conflicts("Probe").unwrap();
        println!("conflicts: {:?}", started.elapsed());
    }
    let notes = store.list().unwrap();
    for meta in &notes {
        println!("  {} downloading={}", meta.title, meta.downloading);
        assert!(!meta.downloading, "{} is on this Mac", meta.title);
    }
    let started = std::time::Instant::now();
    assert!(store.conflicts("Probe").unwrap().is_empty());
    println!("conflicts: {:?}", started.elapsed());
    assert!(started.elapsed() < Duration::from_millis(100));

    store.delete("Probe").unwrap();
    drop(watcher);
}

#[test]
fn an_import_never_numbers_past_a_note_not_downloaded() {
    let (_dir, store, cloud) = synced();
    // An earlier import of "Plan", moved off this Mac: it may be the very note.
    store.create("Plan", "mine\n", Source::User).unwrap();
    let evicted = store.root().join("Plan.md");
    cloud.evict(evicted.clone());
    placeholder(&store, "Old");
    let note = |id: &str, title: &str| ImportNote {
        id: id.to_owned(),
        title: title.to_owned(),
        body: "from Notes".to_owned(),
        folder: None,
        modified: SystemTime::UNIX_EPOCH + Duration::from_secs(1),
    };
    let imported = store
        .import(&[note("a", "Plan"), note("b", "Old"), note("c", "New")])
        .unwrap();
    assert_eq!(imported.waiting, ["Plan", "Old"]);
    assert_eq!(imported.imported, ["New"]);
    assert!(cloud.asked().contains(&evicted));
    assert!(!store.root().join("Plan 2.md").exists());

    // Once here, and not that note: numbered.
    cloud.arrive(&evicted);
    let imported = store.import(&[note("a", "Plan")]).unwrap();
    assert_eq!(imported.renamed, [("Plan".to_owned(), "Plan 2".to_owned())]);
}
