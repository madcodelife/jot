//! `NativeBuild`: the fingerprint of what this installed app was built from
//! that an OTA package cannot change: the Rust (this crate, jot-store,
//! jot-mcp), the locked crates and NSH runtime, `nsh.json` but its version
//! and build, the icon. `scripts/native-fingerprint.sh` computes it,
//! `scripts/package-macos.sh` passes it to the build as
//! `JOT_NATIVE_FINGERPRINT`, and a release publishes its package for it
//! (the package's version, `<version>+native.<fingerprint>`). The app takes
//! a package only when the two are the same (`app/updates.ts`); otherwise
//! the release's TSX could call Rust this app does not have, and only the
//! whole app updates it (docs/app.md, Updates).

use nsh_core::prelude::*;

/// What a build without one has (`nsh run`, `cargo build`): it matches no
/// package.
pub const DEV: &str = "dev";

/// This build's fingerprint, or [`DEV`].
pub const FINGERPRINT: &str = match option_env!("JOT_NATIVE_FINGERPRINT") {
    Some(fingerprint) => fingerprint,
    None => DEV,
};

/// Whether `value` is a fingerprint the script makes: 16 lowercase hex
/// digits (the start of a SHA-256), or [`DEV`].
pub const fn is_fingerprint(value: &str) -> bool {
    let bytes = value.as_bytes();
    if matches!(bytes, b"dev") {
        return true;
    }
    if bytes.len() != 16 {
        return false;
    }
    let mut i = 0;
    while i < bytes.len() {
        if !matches!(bytes[i], b'0'..=b'9' | b'a'..=b'f') {
            return false;
        }
        i += 1;
    }
    true
}

// A fingerprint the app's code cannot compare (a typo in the environment) is
// a build error, not an app that silently takes no packages.
const _: () = assert!(
    is_fingerprint(FINGERPRINT),
    "JOT_NATIVE_FINGERPRINT is 16 lowercase hex digits (scripts/native-fingerprint.sh)"
);

/// What the installed app was built from.
#[module]
pub struct NativeBuild;

#[module]
impl NativeBuild {
    /// The fingerprint of this app's native code (`"dev"` for a
    /// development build): a package runs here only when it was published
    /// for the same one.
    pub fn fingerprint() -> String {
        FINGERPRINT.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_build_has_a_fingerprint_the_app_can_compare() {
        assert!(is_fingerprint(FINGERPRINT), "{FINGERPRINT:?}");
        assert_eq!(NativeBuild::fingerprint(), FINGERPRINT);
    }

    #[test]
    fn fingerprints_are_sixteen_lowercase_hex_digits_or_dev() {
        assert!(is_fingerprint("dev"));
        assert!(is_fingerprint("0123456789abcdef"));
        assert!(!is_fingerprint(""));
        assert!(!is_fingerprint("0123456789ABCDEF"));
        assert!(!is_fingerprint("0123456789abcde"));
        assert!(!is_fingerprint("0123456789abcdefa"));
        assert!(!is_fingerprint("0123456789abcdeg"));
    }
}
