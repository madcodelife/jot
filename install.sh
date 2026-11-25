#!/bin/sh
# Installs Jot.app from a GitHub release of madcodelife/jot:
#
#   curl -fsSL https://raw.githubusercontent.com/madcodelife/jot/main/install.sh | sh
#
#   1. picks the package for this Mac (arm64 or x86_64; Apple silicon under Rosetta gets arm64);
#   2. downloads it from the latest release (or --version), unpacks it and checks its signature;
#   3. quits a running Jot, puts the new Jot.app in place of the old one, and opens it.
#
# Usage: install.sh [options]          (or `curl ... | sh -s -- [options]`)
#   --version vX.Y.Z   a release other than the latest (also JOT_VERSION)
#   --dir DIR          where Jot.app goes (also JOT_INSTALL_DIR; default: /Applications, or ~/Applications when
#                      /Applications is not writable)
#   --zip FILE         install this package (a release's or CI's Jot-*-macos-<arch>.zip) instead of downloading
#   --no-open          do not open Jot afterwards (a Jot it quit for the update stays quit)
# Notes stay where they are: they are in the notes folder, not in the app.
set -eu

repo="madcodelife/jot"

die() {
  echo "install.sh: $*" >&2
  exit 1
}

version=${JOT_VERSION:-}
dir=${JOT_INSTALL_DIR:-}
zip=""
open_after=1
while [ $# -gt 0 ]; do
  case "$1" in
    --version | --dir | --zip)
      [ $# -gt 1 ] || die "$1 needs a value"
      case "$1" in
        --version) version=$2 ;;
        --dir) dir=$2 ;;
        --zip) zip=$2 ;;
      esac
      shift 2
      ;;
    --version=*) version=${1#*=} && shift ;;
    --dir=*) dir=${1#*=} && shift ;;
    --zip=*) zip=${1#*=} && shift ;;
    --no-open) open_after=0 && shift ;;
    -h | --help)
      echo "usage: install.sh [--version vX.Y.Z] [--dir DIR] [--zip FILE] [--no-open]"
      echo "  installs Jot.app from https://github.com/$repo/releases (see the top of install.sh)"
      exit 0
      ;;
    *) die "unknown option '$1' (see --help)" ;;
  esac
done

[ "$(uname -s)" = Darwin ] || die "Jot is for macOS only"

case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64)
    # A shell under Rosetta says x86_64 on Apple silicon: the native package is the one to install.
    if [ "$(sysctl -in sysctl.proc_translated)" = 1 ]; then arch=arm64; else arch=x86_64; fi
    ;;
  *) die "no package for $(uname -m)" ;;
esac

if [ -z "$dir" ]; then
  if [ -w /Applications ]; then dir=/Applications; else dir="$HOME/Applications"; fi
fi
case "$dir" in /*) ;; *) dir="$PWD/$dir" ;; esac
app="$dir/Jot.app"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/jot-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT TERM

# 1-2. The package.
if [ -n "$zip" ]; then
  [ -f "$zip" ] || die "no file $zip"
  echo "Installing Jot from $zip"
else
  if [ -z "$version" ]; then
    # The latest release redirects to its tag's page (no API call, so no rate limit).
    latest=$(curl -fsSL --retry 2 --connect-timeout 15 --max-time 60 -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest") ||
      die "cannot reach GitHub"
    case "$latest" in
      */releases/tag/*) version=${latest##*/} ;;
      *) die "$repo has no release yet" ;;
    esac
  fi
  case "$version" in v*) ;; *) version="v$version" ;; esac
  name="Jot-$version-macos-$arch.zip"
  echo "Downloading Jot ${version#v} ($arch)"
  zip="$tmp/$name"
  curl -fL --retry 2 --connect-timeout 15 --progress-bar -o "$zip" "https://github.com/$repo/releases/download/$version/$name" ||
    die "cannot download $name from release $version"
fi

ditto -x -k "$zip" "$tmp/unpacked" || die "cannot unpack $zip"
new="$tmp/unpacked/Jot.app"
[ -d "$new" ] || die "$zip has no Jot.app"
codesign --verify --deep --strict "$new" 2>/dev/null || die "Jot.app in $zip is not validly signed"
archs=$(lipo -archs "$new/Contents/MacOS/jot-mcp" 2>/dev/null || true)
case " $archs " in
  *" $arch "*) ;;
  *) die "Jot.app in $zip is for ${archs:-an unknown architecture}, not $arch" ;;
esac
# A package downloaded by a browser comes in quarantined: Jot is signed ad hoc, which Gatekeeper would refuse.
xattr -dr com.apple.quarantine "$new" 2>/dev/null || true

mkdir -p "$dir" 2>/dev/null || die "cannot make $dir (choose another with --dir)"
[ -w "$dir" ] || die "$dir is not writable (choose another with --dir)"

# 3. Quit the Jot running from $app (it would keep the old bundle's code; notes are saved as typed), then swap
# the bundles. Another copy, a development build say, is left alone.
running() {
  ps -axo pid=,comm= | awk -v exe="$app/Contents/MacOS/Jot" '{ pid = $1; sub(/^ *[0-9]+ /, ""); if ($0 == exe) print pid }'
}
was_running=0
pids=$(running)
if [ -n "$pids" ]; then
  was_running=1
  echo "Quitting Jot"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  i=0
  while [ -n "$(running)" ] && [ $i -lt 50 ]; do
    sleep 0.1
    i=$((i + 1))
  done
  pids=$(running)
  # shellcheck disable=SC2086
  [ -z "$pids" ] || kill -9 $pids 2>/dev/null || true
fi

if [ -e "$app" ]; then
  mv "$app" "$tmp/old.app" || die "cannot replace $app"
fi
if ! mv "$new" "$app"; then
  [ ! -e "$tmp/old.app" ] || mv "$tmp/old.app" "$app"
  die "cannot move Jot.app to $dir"
fi
echo "Installed $app ($(defaults read "$app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "?"))"

if [ "$open_after" = 1 ]; then
  open "$app"
  echo "Jot is running: double-press ⌥ to open it; Settings → AI Apps connects your AI apps."
elif [ "$was_running" = 1 ]; then
  echo "Jot was quit for the update: open $app to start it again."
fi
