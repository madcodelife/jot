//! Notes kept by a sync service (iCloud Drive): notes whose text is not on this Mac yet, and the versions the
//! service kept when a note changed on two devices at once.
//!
//! - **Not downloaded.** iCloud Drive on macOS 14 and later (a File Provider) leaves a note it moved off the Mac
//!   in place under its own name as a *dataless* file (`SF_DATALESS`): its size and dates are there, its text is
//!   fetched when something reads it, which blocks the reader for as long as the download takes. Older systems
//!   left a hidden placeholder, `.<name>.md.icloud`, instead of the file. Jot never reads a dataless file in a
//!   way that downloads it ([`Cloud::read`] fails fast instead) and lists both forms as notes still downloading,
//!   asking the system for them ([`Cloud::download`]); the folder's watcher reports them when they arrive.
//! - **Conflicts.** When a note changed on two devices before either synced, iCloud keeps one as the file and
//!   the other as an unresolved conflict version (`NSFileVersion`); [`Cloud::conflicts`] lists them and
//!   [`Cloud::resolve`] marks one resolved. Two devices creating the same name each keep theirs, the second as
//!   `<name> 2.md`: two notes, nothing lost, nothing to do.
//!
//! [`Cloud`] is the seam: the system's ([`system`]) on macOS, none elsewhere, and a stand-in in the tests.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

/// A version of a note the sync service kept beside the file.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Version {
    /// What [`Cloud::resolve`] takes to find it again.
    pub id: String,
    /// The device it was saved on ("Floyd’s iPhone"), when the service says.
    pub device: Option<String>,
    /// When it was saved.
    pub modified: SystemTime,
    /// A file with its contents.
    pub file: PathBuf,
}

/// How the notes folder is synced.
pub(crate) trait Cloud: Send + Sync + fmt::Debug {
    /// Whether the file's text is not on this Mac (a dataless file).
    fn is_dataless(&self, path: &Path, metadata: &fs::Metadata) -> bool;

    /// The file's text, or `None` when it is not on this Mac: never waits for a download.
    fn read(&self, path: &Path) -> io::Result<Option<String>> {
        read_local(path)
    }

    /// Asks for the note at `path` (where its file is, or will be for a placeholder) to be downloaded. Returns at
    /// once; asking again while it downloads does no harm.
    fn download(&self, path: &Path);

    /// The unresolved conflict versions of the file.
    fn conflicts(&self, path: &Path) -> io::Result<Vec<Version>>;

    /// Marks the conflict version `id` of the file resolved (the service then lets it go).
    fn resolve(&self, path: &Path, id: &str) -> io::Result<()>;
}

/// The cloud the platform has: iCloud Drive's on macOS, none elsewhere.
pub(crate) fn system() -> Arc<dyn Cloud> {
    #[cfg(target_os = "macos")]
    {
        Arc::new(mac::ICloud)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Arc::new(NoCloud)
    }
}

/// No sync service: every file is here, and nothing conflicts.
#[cfg(not(target_os = "macos"))]
#[derive(Debug)]
pub(crate) struct NoCloud;

#[cfg(not(target_os = "macos"))]
impl Cloud for NoCloud {
    fn is_dataless(&self, _path: &Path, _metadata: &fs::Metadata) -> bool {
        false
    }

    fn download(&self, _path: &Path) {}

    fn conflicts(&self, _path: &Path) -> io::Result<Vec<Version>> {
        Ok(Vec::new())
    }

    fn resolve(&self, _path: &Path, _id: &str) -> io::Result<()> {
        Ok(())
    }
}

/// The note a hidden placeholder of an older iCloud Drive stands for: `.Title.md.icloud` is `Title`.
pub(crate) fn placeholder_title(path: &Path) -> Option<&str> {
    let name = path.file_name()?.to_str()?;
    let inner = name.strip_prefix('.')?;
    let inner = inner.strip_suffix(".icloud")?;
    let (stem, extension) = inner.rsplit_once('.')?;
    (extension.eq_ignore_ascii_case(crate::EXTENSION) && !stem.is_empty() && !stem.starts_with('.'))
        .then_some(stem)
}

/// Reads a file without downloading it: `None` for a dataless one.
#[cfg(target_os = "macos")]
pub(crate) fn read_local(path: &Path) -> io::Result<Option<String>> {
    let _guard = mac::NoDownload::new();
    match fs::read_to_string(path) {
        // The kernel's answer to reading a dataless file while this thread may not download.
        Err(error) if error.raw_os_error() == Some(mac::EDEADLK) => Ok(None),
        result => result.map(Some),
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn read_local(path: &Path) -> io::Result<Option<String>> {
    fs::read_to_string(path).map(Some)
}

#[cfg(target_os = "macos")]
mod mac {
    use std::collections::HashSet;
    use std::fs;
    use std::io;
    use std::os::darwin::fs::MetadataExt as _;
    use std::os::raw::c_int;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::{Duration, UNIX_EPOCH};

    use objc2_foundation::{
        NSFileManager, NSFileVersion, NSNumber, NSURL, NSURLUbiquitousItemHasUnresolvedConflictsKey,
    };

    use super::{Cloud, Version};

    /// `<sys/stat.h>`: the file is a dataless object, its contents elsewhere.
    const SF_DATALESS: u32 = 0x4000_0000;
    /// `<sys/errno.h>`: what reading a dataless file fails with while downloads are off.
    pub(super) const EDEADLK: i32 = 11;
    /// `<sys/resource.h>`: whether reading a dataless file downloads it, for this thread.
    const IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES: c_int = 3;
    const IOPOL_SCOPE_THREAD: c_int = 1;
    const IOPOL_MATERIALIZE_DATALESS_FILES_OFF: c_int = 1;

    unsafe extern "C" {
        fn setiopolicy_np(iotype: c_int, scope: c_int, policy: c_int) -> c_int;
        fn getiopolicy_np(iotype: c_int, scope: c_int) -> c_int;
    }

    /// While it lives, reading a dataless file on this thread fails (`EDEADLK`) rather than download it.
    pub(super) struct NoDownload {
        before: c_int,
    }

    impl NoDownload {
        pub(super) fn new() -> NoDownload {
            // SAFETY: plain system calls on this thread's I/O policy.
            let before = unsafe {
                getiopolicy_np(
                    IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES,
                    IOPOL_SCOPE_THREAD,
                )
            };
            unsafe {
                setiopolicy_np(
                    IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES,
                    IOPOL_SCOPE_THREAD,
                    IOPOL_MATERIALIZE_DATALESS_FILES_OFF,
                );
            }
            NoDownload { before }
        }
    }

    impl Drop for NoDownload {
        fn drop(&mut self) {
            if self.before >= 0 {
                // SAFETY: as in `new`.
                unsafe {
                    setiopolicy_np(
                        IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES,
                        IOPOL_SCOPE_THREAD,
                        self.before,
                    );
                }
            }
        }
    }

    /// The files a reader thread is downloading: one thread per file.
    static FETCHING: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

    /// iCloud Drive, through Foundation. `NSFileManager`'s shared instance and `NSFileVersion`'s class methods
    /// may be called from any thread.
    #[derive(Debug)]
    pub(crate) struct ICloud;

    impl Cloud for ICloud {
        fn is_dataless(&self, _path: &Path, metadata: &fs::Metadata) -> bool {
            metadata.st_flags() & SF_DATALESS != 0
        }

        fn download(&self, path: &Path) {
            let Some(url) = NSURL::from_file_path(path) else {
                return;
            };
            if NSFileManager::defaultManager()
                .startDownloadingUbiquitousItemAtURL_error(&url)
                .is_ok()
            {
                return;
            }
            // Not iCloud's (another File Provider: Dropbox, OneDrive…): a thread of its own reads the file, which
            // makes the system download it, however long that takes.
            let dataless = fs::metadata(path).is_ok_and(|m| self.is_dataless(path, &m));
            if !dataless {
                return;
            }
            let path = path.to_owned();
            {
                let mut fetching = FETCHING.lock().unwrap_or_else(|e| e.into_inner());
                if !fetching
                    .get_or_insert_with(HashSet::new)
                    .insert(path.clone())
                {
                    return;
                }
            }
            let spawned = std::thread::Builder::new()
                .name("jot-download".into())
                .spawn({
                    let path = path.clone();
                    move || {
                        let _ = fs::File::open(&path)
                            .and_then(|mut file| io::Read::read(&mut file, &mut [0; 1]));
                        let mut fetching = FETCHING.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(set) = fetching.as_mut() {
                            set.remove(&path);
                        }
                    }
                });
            if spawned.is_err() {
                let mut fetching = FETCHING.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(set) = fetching.as_mut() {
                    set.remove(&path);
                }
            }
        }

        fn conflicts(&self, path: &Path) -> io::Result<Vec<Version>> {
            let Some(url) = NSURL::from_file_path(path) else {
                return Ok(Vec::new());
            };
            // The URL's flag is a cheap look (well under a millisecond); listing the versions is not.
            let mut flag = None;
            // SAFETY: the key's value is an NSNumber (a boolean), and `flag` takes any object.
            let looked = unsafe {
                url.getResourceValue_forKey_error(
                    &mut flag,
                    NSURLUbiquitousItemHasUnresolvedConflictsKey,
                )
            };
            let conflicted = looked.is_ok()
                && flag
                    .and_then(|value| value.downcast::<NSNumber>().ok())
                    .is_some_and(|number| number.boolValue());
            if !conflicted {
                return Ok(Vec::new());
            }
            let Some(versions) = NSFileVersion::unresolvedConflictVersionsOfItemAtURL(&url) else {
                return Ok(Vec::new());
            };
            let mut out = Vec::new();
            for version in versions.iter() {
                let Some(file) = version.URL().to_file_path() else {
                    continue;
                };
                let modified = version.modificationDate().map_or(UNIX_EPOCH, |date| {
                    let seconds = date.timeIntervalSince1970();
                    if seconds >= 0.0 {
                        UNIX_EPOCH + Duration::from_secs_f64(seconds)
                    } else {
                        UNIX_EPOCH
                    }
                });
                out.push(Version {
                    id: file.to_string_lossy().into_owned(),
                    device: version
                        .localizedNameOfSavingComputer()
                        .map(|name| name.to_string())
                        .filter(|name| !name.trim().is_empty()),
                    modified,
                    file,
                });
            }
            out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.id.cmp(&b.id)));
            Ok(out)
        }

        fn resolve(&self, path: &Path, id: &str) -> io::Result<()> {
            let url = NSURL::from_file_path(path)
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "not a file path"))?;
            let versions = NSFileVersion::unresolvedConflictVersionsOfItemAtURL(&url);
            for version in versions.iter().flat_map(|versions| versions.iter()) {
                if version
                    .URL()
                    .to_file_path()
                    .is_some_and(|file| file.to_string_lossy() == id)
                {
                    version.setResolved(true);
                    return Ok(());
                }
            }
            // Resolved already, here or on another device.
            Ok(())
        }
    }
}
