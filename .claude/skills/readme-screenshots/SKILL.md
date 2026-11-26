---
name: readme-screenshots
description: Retake Jot's README screenshots (design/screenshots/light.png and dark.png) with scripts/screenshots.sh, check them by eye, and open a PR. Use when asked to retake, update or refresh the README screenshots ("重拍 README 截图", "更新截图"), or after a change to the themes' colors, the panel's layout, the list's rows, the to-do view or scripts/demo-notes.sh that the shots show.
---

# Retake the README screenshots

`scripts/screenshots.sh` does the deterministic part; this is the judgment around it.

| Shot | Appearance, theme | Shows |
| --- | --- | --- |
| `design/screenshots/light.png` | light, `default` | the panel's recent notes (some by Claude, Claude Code, Cursor), nothing typed |
| `design/screenshots/dark.png` | dark, `tokyo` | the to-do view (`todo` typed): overdue, today, tomorrow, upcoming |

Both 1282×1077 px (2x). README.md and README.zh-CN.md show them; the website uses `light.png` as its preview
image (`scripts/build-site.sh`, `og.png`).

## When

Retake when what they show changed: theme colors (`app/ui/theme.json`, `themes.json`), the panel's size, layout or
material (`app/ui/Panel.tsx`, `tokens.ts`), the list's rows or the to-do view, the footer's keys, or the demo notes.
Not for changes they don't show.

## 1. Build Jot.app from this checkout

The shots are of this checkout, not the installed Jot. `nsh package` needs the nsh CLI `Cargo.lock` pins; don't
replace the `nsh` on the user's `PATH`, install the pinned one beside it (once; it builds from source, slow):

```sh
scripts/install-nsh.sh --which                               # the pinned commit
$HOME/.nsh-jot/bin/nsh --version                             # already there at that commit? skip the next line
NSH_INSTALL_DIR=$HOME/.nsh-jot NSH_BIN_DIR= scripts/install-nsh.sh
NSH=$HOME/.nsh-jot/bin/nsh scripts/package-macos.sh          # → .nsh/out/Jot.app
```

## 2. Preflight

- The app running the script (the terminal) needs Accessibility and Screen Recording; the script checks and names
  what is missing. If one is, stop and tell the user: never try to grant it.
- The primary display must be at 2x (a Retina display); the script fails otherwise.
- Take them between 09:00 and 17:00: the demo to-dos are due at fixed hours of today (`scripts/demo-notes.sh`), so
  later in the day "Ship the onboarding redesign" (17:00) turns overdue and the groups read differently.
- Tell the user first: it quits their Jot, covers the screen for about half a minute and relaunches Jot after. Keys
  or clicks meanwhile go to the panel. Do Not Disturb keeps notification banners out of the shots.

## 3. Run

```sh
scripts/screenshots.sh                  # both, into design/screenshots
scripts/screenshots.sh --only dark      # one; --out <dir> to try without touching the repo
```

It puts back the user's settings and Jot also on failure or Ctrl-C. A leftover
`~/Library/Application Support/com.madcodelife.jot/storage.json.screenshots-backup` means a run was killed: it is
the user's settings; ask before moving it back.

## 4. Look at both PNGs

Open each with Read and check, redoing the run if any fails:

- 1282×1077, the panel whole and centered, ~53 pt of backdrop each side, its top ~20 pt down.
- Only demo notes (This week, Design review, Homelab, …): nothing of the user's, no real names, paths or data.
- No notification banner, pointer, other window, the island or a system dialog over or around the panel.
- Light: the list of notes, nothing typed. Dark: `todo` in the field, groups Overdue, Today, Tomorrow,
  Upcoming.
- Colors match the theme as the app shows it now (selection and accents of `default` in light, Tokyo Night in
  dark), on the backdrop's gradient (light: pale blue and cyan; dark: deep blue and teal).

## 5. Finish

- If what a shot shows changed, update its `alt` in both README.md and README.zh-CN.md.
- Branch (hyphenated name, e.g. `readme-screenshots-<reason>`), commit the PNGs (and alt texts), open a PR to `main`
  saying why they were retaken.
