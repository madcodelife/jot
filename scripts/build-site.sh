#!/bin/sh
# Builds the site GitHub Pages serves at https://madcodelife.github.io/jot/ into one folder (default `_site`):
# the page in site/, install.sh (the address README gives) and the icons and screenshot it uses from design/.
#
#   scripts/build-site.sh            # then open _site/index.html, or serve it: python3 -m http.server -d _site
set -eu
cd "$(dirname "$0")/.."
out=${1:-_site}

rm -rf "$out"
mkdir -p "$out"
cp -R site/. "$out/"
cp install.sh "$out/"
web=design/logo/loop/web
cp "$web/favicon.ico" "$web/favicon.svg" "$web/apple-touch-icon.png" "$out/"
cp design/logo/loop/png/jot-macos-icon.png "$out/icon.png"
cp design/logo/loop/png/jot-macos-icon-dark.png "$out/icon-dark.png"
cp design/screenshots/light.png "$out/og.png"
