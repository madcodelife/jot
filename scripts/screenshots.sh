#!/bin/sh
# Takes the README's screenshots (design/screenshots/light.png and dark.png) with a Jot.app, on example notes:
#
#   light.png  light appearance, the `default` theme, the panel's list of recent notes, nothing typed;
#   dark.png   dark appearance, the `tokyo` theme, the to-do view (`todo` typed).
#
# Each is 1282×1077 px: the panel with 53.5 pt of background each side, at 2x. The background is a gradient of our
# own (the website's wall) on a window behind the panel, not the desktop.
#
# For each shot it writes Jot's settings (the notes folder, appearance, theme, English, no notifications or island,
# and not yet welcomed, so Jot shows its panel by itself as it starts), opens the app, waits for the panel, types,
# captures and quits it. The notes are scripts/demo-notes.sh's, in a folder of their own; yours are not touched.
# A Jot running before (any copy) is quit first, its settings (storage.json) put back after and it is opened again,
# also when this fails or is interrupted. The screen shows the backdrop for about half a minute: leave the Mac alone
# meanwhile, as any key or click goes to Jot's panel.
#
# Usage: scripts/screenshots.sh [--app <Jot.app>] [--out <dir>] [--only light|dark]
#   --app   the app to take them with (default: .nsh/out/Jot.app, which scripts/package-macos.sh builds)
#   --out   where the PNGs go (default: design/screenshots)
#   --only  one of the two
# Needs Xcode's command line tools (swiftc builds scripts/screenshots/helper.swift) and, for the app this runs in
# (the terminal), Accessibility (to type) and Screen Recording (to capture); it says which is missing.
set -eu

caller=$(pwd)
cd "$(dirname "$0")/.."
root=$(pwd)

die() {
  echo "screenshots.sh: $*" >&2
  exit 2
}
absolute() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$caller" "$1" ;;
  esac
}

app="$root/.nsh/out/Jot.app"
out="$root/design/screenshots"
only=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app | --out | --only) [ $# -ge 2 ] || die "$1 needs a value" ;;
    -h | --help)
      sed -n '2,/^set -eu/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown option '$1' (--app, --out, --only)" ;;
  esac
  case "$1" in
    --app) app=$(absolute "$2") ;;
    --out) out=$(absolute "$2") ;;
    --only)
      case "$2" in
        light | dark) only=$2 ;;
        *) die "--only is light or dark, not '$2'" ;;
      esac
      ;;
  esac
  shift 2
done

plist="$app/Contents/Info.plist"
[ -f "$plist" ] || die "$app is not an app: build one with scripts/package-macos.sh, or pass --app"
[ "$(plutil -extract CFBundleIdentifier raw -o - "$plist")" = com.madcodelife.jot ] ||
  die "$app is not Jot (com.madcodelife.jot)"
command -v swiftc >/dev/null || die "swiftc is missing: install Xcode's command line tools (xcode-select --install)"

support="$HOME/Library/Application Support/com.madcodelife.jot"
settings="$support/storage.json"
# Your settings while the shots are taken; a copy left from a run that was killed stops the next one.
backup="$support/storage.json.screenshots-backup"
if [ -e "$backup" ]; then
  die "$backup is left from a run that did not finish: it holds your settings from before it. Quit Jot, move it
back over storage.json (or delete it if storage.json is fine), and run this again."
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/jot-shots.XXXXXX")
helper="$work/jot-shots-helper"
notes="$work/Jot Demo"
running=""
pointer=""
backdrop=""
saved=0
had_settings=0

# Opens the app at $1. LaunchServices turns down an app whose last copy is still going away (-600): a few tries.
launch() {
  tries=0
  until open "$1" 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -lt 10 ] || return 1
    sleep 1
  done
}

# Everything back as it was: the backdrop gone, the Jot used here quit, your settings in place, the Jot that ran
# before running again, the pointer where it was.
restore() {
  status=$?
  trap - EXIT INT TERM HUP
  set +e
  if [ -n "$backdrop" ]; then
    kill "$backdrop" 2>/dev/null
    wait "$backdrop" 2>/dev/null
  fi
  if [ "$saved" = 1 ]; then
    "$helper" quit
    if [ "$had_settings" = 1 ]; then
      mv -f "$backup" "$settings"
    else
      rm -f "$settings" "$backup"
    fi
  fi
  if [ -n "$running" ]; then
    printf '%s\n' "$running" | while IFS= read -r copy; do
      [ -z "$copy" ] || launch "$copy" || echo "screenshots.sh: could not open $copy again: open it yourself" >&2
    done
  fi
  [ -z "$pointer" ] || "$helper" warp "${pointer% *}" "${pointer#* }"
  chflags -R nouchg "$work" 2>/dev/null
  rm -rf "$work"
  exit "$status"
}
trap restore EXIT
trap 'exit 130' INT TERM HUP

echo "Building the helper"
swiftc -swift-version 5 -O -module-cache-path "$work/cache" scripts/screenshots/helper.swift -o "$helper" ||
  die "cannot build scripts/screenshots/helper.swift"
"$helper" check

scripts/demo-notes.sh "$notes" >/dev/null
mkdir -p "$out"

# Jot reads its settings once as it starts and writes the whole file on every change: they are changed while no Jot
# runs only.
running=$("$helper" running)
pointer=$("$helper" pointer)
"$helper" quit
mkdir -p "$support"
if [ -e "$settings" ]; then
  had_settings=1
  cp -p "$settings" "$backup"
else
  : >"$backup"
fi
saved=1

# attempt <name> <appearance> <theme> [typed]: one try at a shot; Jot and the backdrop are gone after it either way.
attempt() {
  "$helper" settings "$backup" "$settings" "jot.dir=$notes" "jot.appearance=$2" "jot.theme=$3" jot.language=en \
    jot.notifications=0 jot.island=0 -jot.welcomed || return 1
  "$helper" backdrop "$2" &
  backdrop=$!
  ok=0
  "$helper" park &&
    sleep 0.5 &&
    launch "$app" &&
    "$helper" wait-panel 30 &&
    sleep 2 && # the panel's spring and the rows dropping in
    { [ -z "${4:-}" ] || { "$helper" type "$4" && sleep 2; }; } &&
    "$helper" shoot "$out/$1.png" &&
    ok=1
  "$helper" quit
  kill "$backdrop"
  wait "$backdrop" 2>/dev/null
  backdrop=""
  [ "$ok" = 1 ]
}

# shot <name> <appearance> <theme> [typed]: a few tries, as a window taking the focus hides the panel.
shot() {
  echo "Taking $1.png ($2, $3${4:+, \"$4\" typed})"
  for try in 1 2 3; do
    attempt "$@" && return 0
    [ "$try" = 3 ] || echo "Trying $1.png again"
  done
  die "could not take $1.png: see above"
}

[ "$only" = dark ] || shot light light default
[ "$only" = light ] || shot dark dark tokyo todo
echo "Done: check the PNGs in $out before you commit them"
