# Locked notes

A lock in the store (jot-store) and in the app. Part of [the architecture](architecture.md).

## Locked notes (store/src/lock.rs)

A lock is two marks, either of which makes the note locked (`NoteMeta::locked`):

- **The file's `UF_IMMUTABLE` flag** (`chflags uchg`, Finder's Get Info › Locked), so that no other program changes it.
- **`locked: true` in the frontmatter** (a top-level line, `true` in any case, quoted or not, a `# comment` after
  it allowed), so the lock travels with the text to other devices.

Every write of the store (`write`, `append`, `set_todo_done`, `set_todo_due`, `add_todo` into the note, `rename`,
`delete`, `trash`, `replace`, `resolve` with `UseOther`, `set_icon`, `clear_icon`) checks both before it touches the file and fails with
`StoreError::Locked`, the file left as it was. `lock` writes the frontmatter (mtime kept: locking is no change of
the note; the write sets the time on the temporary file before the rename) and then the flag; `unlock` clears the
flag, then takes the line out (a frontmatter left empty goes), and sets the flag back if that write fails.
`settle_locks` (the app calls it when it opens a folder and on every change the watcher reports) puts back the flag
on a note whose frontmatter says locked, and writes the frontmatter of a note with the flag alone (clearing the
flag for the write and setting it again after, also when the write fails). Notes not downloaded wait. Its own
changes come back through the watcher with nothing left to do. A note unlocked in Finder alone is locked again by
it while the frontmatter says so: unlocking is Jot's. `move_into` moves a locked note locked: a flag-only one gets
the frontmatter first; the flag is cleared for the rename (or, across volumes, the copy and the removal) and set
on the file that is left; on a failure, on the one still here (and on a copy already made).

What the system does with the flag, checked on macOS 27 (APFS):

- On a file with it, `rm`, `rm -f`, `mv`, a write (`>`, `>>`), a rename over it (an atomic save), renaming it,
  `touch`, `chmod` and `xattr -w` all fail with `EPERM`; `rm -rf` of its folder leaves the folder ("Directory not
  empty"), though the folder itself can be renamed. `NSFileManager trashItemAtURL:` refuses it
  (`NSCocoaErrorDomain` 513); nothing reaches the trash. Reading is unaffected.
- The file's owner clears it without `sudo` (`chflags nouchg`, Finder): the flag stops mistakes and programs that
  respect it, not one that sets out to change the file.
- FSEvents reports setting and clearing it (`kFSEventStreamEventFlagItemInodeMetaMod`), and `notify`'s debouncer
  passes it on: the folder's watcher fires (`the_watcher_sees_the_flag_change`).

What iCloud Drive does with it, checked on macOS 27 with one Mac signed in, in a test folder in iCloud Drive:

- Measured: when it uploads a file's new contents (a new file, changed text, a file moved in), it clears the flag
  within about a second, on the same inode. A flag set on a file already uploaded, with no change to its text,
  stays (watched for 30 s), as it does through an eviction (`brctl evict`: dataless and flagged) and the download
  back. No extended attribute carries it.
- Not measurable with one Mac, inferred: the flag does not reach other devices (it is cleared at upload, and no
  attribute holds it). So the frontmatter carries the lock, and `settle_locks` sets the flag on each Mac: a note
  locked in Jot on iCloud Drive is unflagged for about a second after its upload, until the watcher's report brings
  the flag back. `lock_on_icloud_drive` (ignored) runs this on a real folder: `JOT_ICLOUD_DIR=<a test folder in
  iCloud Drive> cargo test -p jot-store lock_on_icloud_drive -- --ignored --nocapture` (measured: cleared ~1.1 s
  after the lock; set again, it stayed).

## The app and locked notes

`isLocked(title)` (app/store.ts) reads `NoteMeta.locked` from the listing, so a lock set or cleared anywhere (another
Mac through the frontmatter, Finder, `chflags`) shows at the watcher's next report, after `settleLocks`. The open
note (app/ui/Paper.tsx) is read-only while locked (`readOnly`: the editor, ticks, time chips, the time phrases' rewrite,
list continuation, dictation all stop; the microphone hides) and its header shows a padlock and "Locked", a
`Button` that unlocks it (`setLocked`, which saves the open note's edits before locking). Rows show a padlock
(`note-locked`). The to-do view's tick and the island's checkbox catch `ERR_JOT_LOCKED`: the footer says to unlock the
note, the island shows "Locked" with a padlock for its checkbox and closes; the reminder still comes due.
