# Jot logo: the loop

## Idea

One quick loop, then a full stop: jot a line down, and you're done. The stroke leans 10° to the right like handwriting;
the loop, the dot and the wordmark share one round-capped monoline.

## Files

| File | Use |
|---|---|
| `jot-symbol.svg` | Main symbol (indigo), 33 px and up |
| `jot-symbol-small.svg` / `-small-black.svg` | Small cut: heavier stroke, rounder loop, wider gap before the dot; 32 px and below |
| `jot-symbol-black.svg` / `jot-symbol-white.svg` | One colour / reversed |
| `jot-wordmark.svg` (`-black` / `-white`) | The wordmark `jot`, same monoline and slant |
| `jot-horizontal.svg` / `jot-horizontal-white.svg` | Horizontal lockup |
| `jot-stacked.svg` | Stacked lockup |
| `jot-app-icon.svg` / `jot-app-icon-small.svg` | Full-bleed app icon on a 256 grid |
| `jot-macos-icon.svg` / `-small` / `-dark` | macOS icon on the 824/1024 grid; `-dark` for the dark appearance |
| `macos/Jot.icns`, `macos/Jot.iconset/` | 16 and 32 px use the small cut, the rest the main one |
| `tray/jotTemplate.png`, `@2x`, `jot-tray-template.svg` | Menu bar template image, 18 pt, black on clear; macOS tints it |
| `web/` | favicon.ico, favicon.svg, apple-touch-icon, PWA icons, `site.webmanifest`, `head-snippet.html` |
| `png/` | Common PNG exports on clear |

## Colour

| Name | HEX | RGB | Use |
|---|---|---|---|
| Indigo | `#2B2F8F` | 43 47 143 | Primary: icon ground, symbol |
| Night | `#15162B` | 21 22 43 | Wordmark, dark icon ground |
| Lilac | `#9EA2FF` | 158 162 255 | Symbol on dark grounds |
| White | `#FFFFFF` | 255 255 255 | Symbol on indigo (about 11:1) |

Approved pairs: white on indigo (preferred), lilac on night, indigo on white, night on white, white on dark grounds.

## Clear space and minimum size

- Clear space: at least one dot's diameter on every side (about 31 units on the 256 grid).
- Symbol: 16 px minimum; use the small cut at 32 px and below.
- Horizontal lockup: 24 px tall minimum. Wordmark: 16 px tall minimum.

## Don't

Stretch or squash it, change the slant, separate or move the loop and the dot, use colours outside the palette, add
gradients or shadows, outline it, or place it on busy backgrounds.

## Motion

On summon, the loop draws itself from the lower left along its path (about 420 ms, ease-out), then the dot drops in
(120 ms). With Reduce Motion on, show the final state.

## Notes

- Everything is geometric paths and monoline strokes; no font is involved, so there is no font licence to clear.
- The masters still use strokes (`stroke`). That is fine on screen and for PNG export; outline the strokes in Figma or
  Illustrator before print, engraving or handing the files to a designer.
- Run a trademark search (trademark databases and reverse image search) before relying on the mark.
- `build.py` writes the SVG masters; after changing it, export the PNGs, the `.icns` and the web icons again.
