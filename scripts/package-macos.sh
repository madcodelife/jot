#!/bin/sh
# Packages Jot.app for macOS with its MCP server inside:
#
#   1. builds jot-mcp in release (both architectures, merged with lipo, for --arch universal);
#   2. runs `nsh package --target macos` with the options given (--arch, --out, --name, --app-version, ...);
#   3. copies jot-mcp to <name>.app/Contents/MacOS/jot-mcp, where the app looks for it;
#   4. signs jot-mcp, then the bundle again, and verifies;
#   5. with "updater" in nsh.json, archives that bundle again under the update archives' names nsh gave
#      (<name>-<version>-macos-<arch>.tar.gz): nsh made them before jot-mcp was in.
#
# NSH's packaging puts its own runner and the app's assets in the bundle only, so the helper goes in afterwards.
# The app's Rust is built with JOT_NATIVE_FINGERPRINT (scripts/native-fingerprint.sh, unless it is set), which the
# app compares an OTA package's with (docs/app.md, Updates).
#
# Usage: scripts/package-macos.sh [nsh package options]   (from any folder; it packages this checkout)
#   NSH=/path/to/nsh     the nsh CLI to use (default: `nsh` on PATH); the NSH Cargo.toml's nsh-core names (CONTRIBUTING)
#   SIGN_IDENTITY=...    a code signing identity for both (default: `-`, ad hoc). Any other identity signs with a
#                        secure timestamp and the hardened runtime (`--timestamp --options runtime`), as
#                        notarization asks.
# Paths given (--out, --icon, ...) are taken from the folder it is run in. No ENTRY: the app is this checkout.
set -eu

caller=$(pwd)
cd "$(dirname "$0")/.."

NSH=${NSH:-nsh}
SIGN_IDENTITY=${SIGN_IDENTITY:--}

die() {
  echo "package-macos.sh: $*" >&2
  exit 2
}
# `$1` from the folder the script was run in.
absolute() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$caller" "$1" ;;
  esac
}

arch=""
out=".nsh/out"
name=""
app_version=""
run=0
# The options are passed on to nsh as given (paths made absolute), without --run: the app opens once jot-mcp is
# in. Each is taken off the front of "$@" and what is kept goes on its end.
count=$#
while [ "$count" -gt 0 ]; do
  option=$1
  shift
  count=$((count - 1))
  value=""
  case "$option" in
    --run)
      run=1
      continue
      ;;
    -v | --verbose | -h | --help)
      set -- "$@" "$option"
      continue
      ;;
    --target | --target=*) die "the target is always macos" ;;
    --*=*)
      value=${option#*=}
      option=${option%%=*}
      ;;
    -*)
      [ "$count" -gt 0 ] || die "$option needs a value"
      value=$1
      shift
      count=$((count - 1))
      ;;
    *) die "unexpected argument '$option': the app packaged is this checkout, so there is no ENTRY" ;;
  esac
  case "$option" in
    --arch)
      case "$value" in
        arm64 | x86_64 | universal) arch=$value ;;
        *) die "--arch is arm64, x86_64 or universal, not '$value'" ;;
      esac
      ;;
    -o | --out)
      value=$(absolute "$value")
      out=$value
      ;;
    --name) name=$value ;;
    --app-version) app_version=$value ;;
    --icon | --profile | --keystore) value=$(absolute "$value") ;;
  esac
  set -- "$@" "$option" "$value"
done

[ -n "$name" ] || name=$(plutil -extract name raw -o - nsh.json 2>/dev/null || echo Jot)
case "$name" in
  "" | */*) die "the app's name '$name' is not a file name" ;;
esac
app="$out/$name.app"

# The CLI must be the NSH the crate builds with: Cargo.toml's nsh-core, a commit of NSH's repository (`rev`, which a
# nightly CLI names in its version: "nsh 0.6.0 (2964346 nightly 2026-11-24)") or a release from crates.io.
version=$("$NSH" --version 2>/dev/null || true)
core=$(grep -E '^nsh-core *=' Cargo.toml || true)
rev=$(printf '%s' "$core" | sed -n 's/.*rev *= *"\([0-9a-f]\{7\}\)[0-9a-f]*".*/\1/p')
if [ -n "$rev" ]; then
  wanted="NSH at commit $rev"
  case "$version" in "nsh "*"($rev "*) wanted="" ;; esac
else
  release=$(printf '%s' "$core" | sed -n 's/^nsh-core *= *"\([^"]*\)".*/\1/p')
  wanted="NSH $release"
  # A nightly carries the version of the release before it: it is not that release.
  case "$version" in *nightly*) ;; "nsh $release" | "nsh $release "*) wanted="" ;; esac
fi
[ -z "$wanted" ] || echo "package-macos.sh: warning: Jot builds with $wanted (Cargo.toml), $NSH is ${version:-missing} (set NSH=...)" >&2

# 1. jot-mcp, for the architectures the app is built for, from where cargo puts it (CARGO_TARGET_DIR,
# build.target-dir).
target=$(cargo metadata --format-version 1 --no-deps | plutil -extract target_directory raw -o - -)
case "$arch" in
  "")
    cargo build --release -p jot-mcp
    server="$target/release/jot-mcp"
    ;;
  arm64)
    cargo build --release -p jot-mcp --target aarch64-apple-darwin
    server="$target/aarch64-apple-darwin/release/jot-mcp"
    ;;
  x86_64)
    cargo build --release -p jot-mcp --target x86_64-apple-darwin
    server="$target/x86_64-apple-darwin/release/jot-mcp"
    ;;
  universal)
    cargo build --release -p jot-mcp --target aarch64-apple-darwin
    cargo build --release -p jot-mcp --target x86_64-apple-darwin
    mkdir -p "$target/universal-apple-darwin/release"
    server="$target/universal-apple-darwin/release/jot-mcp"
    lipo -create -output "$server" \
      "$target/aarch64-apple-darwin/release/jot-mcp" \
      "$target/x86_64-apple-darwin/release/jot-mcp"
    ;;
esac

# 2. The app, in place of an older one: the bundle checked below is the one just made. Its Rust gets the native
# fingerprint of this checkout.
if [ -z "${JOT_NATIVE_FINGERPRINT:-}" ]; then
  JOT_NATIVE_FINGERPRINT=$(scripts/native-fingerprint.sh) || die "cannot compute the native fingerprint"
fi
export JOT_NATIVE_FINGERPRINT
echo "native fingerprint $JOT_NATIVE_FINGERPRINT"

# With an update source, nsh also writes the update archives, which step 5 makes again.
updater=0
if grep -q '"updater"' nsh.json; then
  updater=1
fi

rm -rf "$app"
"$NSH" package --target macos "$@"
if [ ! -d "$app" ]; then
  die "$app was not made"
fi

# 3. jot-mcp beside the app's executable.
cp "$server" "$app/Contents/MacOS/jot-mcp"
chmod 755 "$app/Contents/MacOS/jot-mcp"

# 4. The helper first, then the bundle that seals it.
if [ "$SIGN_IDENTITY" = "-" ]; then
  set -- --timestamp=none
else
  set -- --timestamp --options runtime
fi
codesign --force --sign "$SIGN_IDENTITY" "$@" "$app/Contents/MacOS/jot-mcp"
codesign --force --sign "$SIGN_IDENTITY" "$@" \
  --preserve-metadata=entitlements,requirements,flags "$app"
codesign --verify --deep --strict "$app"
echo "packaged $app with jot-mcp ($(lipo -archs "$app/Contents/MacOS/jot-mcp"))"

# 5. The update archives, of the bundle as signed now. nsh names them for the processors the app is built for
# (`macos-aarch64`, `macos-x86_64`; both for a universal app) and the version; `tar` as nsh does, keeping the links and
# modes the signature covers and leaving out AppleDouble files.
if [ "$updater" = 1 ]; then
  [ -n "$app_version" ] || app_version=$(jq -r .version nsh.json)
  safe=$(printf '%s' "$name" | LC_ALL=C tr -c 'A-Za-z0-9' '-')
  archived=0
  for archive in "$out/$safe-$app_version-macos-aarch64.tar.gz" "$out/$safe-$app_version-macos-x86_64.tar.gz"; do
    [ -f "$archive" ] || continue
    rm -f "$archive"
    COPYFILE_DISABLE=1 tar -czf "$archive" -C "$out" "$name.app"
    echo "update archive $archive"
    archived=1
  done
  [ "$archived" = 1 ] || die "nsh made no update archive $out/$safe-$app_version-macos-*.tar.gz to make again"
fi

if [ "$run" = 1 ]; then
  open "$app"
fi
