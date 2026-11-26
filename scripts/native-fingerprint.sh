#!/bin/sh
# Prints the native fingerprint of this checkout: 16 hex digits that change whenever something an OTA package cannot
# carry changes, so an installed Jot takes a package only when it was built from the same (docs/app.md, Updates):
#
#   - the Rust: the app's crate (src/, build.rs), jot-store (store/), jot-mcp (mcp/), their manifests and Cargo.lock,
#     which also pins the NSH runtime;
#   - nsh.lock (the nsh packages, which may bring native code with them);
#   - nsh.json without "version" and "build" (its capabilities, "updater", Info.plist keys, …: the installed app's);
#   - assets/ (the app icon) and how the bundle is made (scripts/package-macos.sh, this script).
#
# A package carries the TSX, the theme and locales/ (NSH bundles them into the app's code), so they are not in it.
#
# Usage: scripts/native-fingerprint.sh          (from any folder; it reads this checkout's files as they are)
# Needs git, jq and shasum. The list is of the files git knows (tracked, and untracked ones it does not ignore).
set -eu

cd "$(dirname "$0")/.."

command -v jq > /dev/null || {
  echo "native-fingerprint.sh: needs jq" >&2
  exit 2
}

{
  # Each file's path and content, in a stable order.
  git ls-files --cached --others --exclude-standard -- \
    Cargo.toml Cargo.lock build.rs src store mcp nsh.lock assets \
    scripts/package-macos.sh scripts/native-fingerprint.sh |
    LC_ALL=C sort -u |
    while IFS= read -r file; do
      # A tracked file deleted in the working tree is not part of it.
      [ -f "$file" ] || continue
      printf '%s %s\n' "$(shasum -a 256 < "$file" | cut -c1-64)" "$file"
    done
  # The configuration, its keys sorted and the release's own two left out.
  printf 'nsh.json '
  jq -cS 'del(.version, .build)' nsh.json
} | shasum -a 256 | cut -c1-16
