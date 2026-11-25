#!/bin/sh
# Installs the `nsh` CLI that matches the NSH crates Cargo.lock pins, as Jot needs the two to be the same:
#
#   - `nsh-core` from crates.io (version X): NSH's release vX, through its install script;
#   - `nsh-core` from NSH's repository (a commit): that commit built from source, laid out as NSH's
#     `install.sh --source` does (the checkout stays, as the CLI builds hosts and runtimes from it).
#
# Usage: scripts/install-nsh.sh           (from any folder)
#        scripts/install-nsh.sh --which   only print the commit or the release (`v0.6.0`) it would install
#   NSH_INSTALL_DIR   where NSH goes (default: ~/.nsh); `nsh` is linked into ~/.local/bin
set -eu

cd "$(dirname "$0")/.."

dir=${NSH_INSTALL_DIR:-$HOME/.nsh}
bin="$HOME/.local/bin"

# The `version` and `source` lines of nsh-core's [[package]] in Cargo.lock.
field() {
  awk -v key="$1" '
    /^\[\[package\]\]/ { inside = 0 }
    /^name = "nsh-core"$/ { inside = 1 }
    inside && $1 == key { gsub(/"/, "", $3); print $3; exit }
  ' Cargo.lock
}
version=$(field version)
source=$(field source)

case "$source" in
  git+https://github.com/longbridge/nsh*) label=${source##*#} ;;
  registry+*) label="v$version" ;;
  *)
    echo "install-nsh.sh: nsh-core comes from '$source', which this script does not know" >&2
    exit 2
    ;;
esac
if [ "${1:-}" = --which ]; then
  echo "$label"
  exit 0
fi

case "$source" in
  git+*)
    rev=$label
    if [ -x "$dir/bin/nsh" ] && [ "$(git -C "$dir/source" rev-parse HEAD 2>/dev/null)" = "$rev" ]; then
      echo "NSH $rev is checked out"
    else
      echo "Building NSH $rev from source"
      rm -rf "$dir/source"
      mkdir -p "$dir/source"
      git -C "$dir/source" init -q
      git -C "$dir/source" remote add origin https://github.com/longbridge/nsh.git
      git -C "$dir/source" fetch -q --depth 1 origin "$rev"
      git -C "$dir/source" checkout -q --detach FETCH_HEAD
    fi
    # Cargo's own target folder, whatever the caller's CARGO_TARGET_DIR: the CLI's runtimes are built there.
    (cd "$dir/source" && env -u CARGO_TARGET_DIR cargo build --release --locked -p nsh-cli)
    mkdir -p "$dir/bin" "$bin"
    ln -sf "$dir/source/target/release/nsh" "$dir/bin/nsh"
    ln -sf "$dir/bin/nsh" "$bin/nsh"
    ;;
  registry+*)
    curl -fsSL "https://github.com/longbridge/nsh/releases/download/$label/install.sh" |
      NSH_VERSION="$label" NSH_INSTALL_DIR="$dir" sh
    ;;
esac

"$bin/nsh" --version
