<p align="center">
  <img src="design/logo/loop/png/jot-horizontal.png" alt="Jot" width="240">
</p>

<p align="center"><a href="README.zh-CN.md">中文</a></p>

# Jot

Jot is a quick-notes app for macOS that you share with your AI apps. Double-press ⌥ anywhere and a floating panel
appears; its one field is both the search box and the title of a new note, so you type, and either find what you wrote
before or press Return to start a new note. Notes are plain Markdown files in a folder you choose. To-dos and reminders
live inside those notes, and `jot-mcp`, a small MCP server, lets your AI apps (Claude, Cursor, Codex, …) search, read
and add to the same notes, so you and they keep one notebook between you.

## Features

- **Summon from anywhere**: double-press ⌥ (needs Accessibility access; a fallback shortcut works without it). The
  panel hides again on Esc or when it loses focus.
- **Search is create**: results filter by title and body as you type, most recent first; when nothing matches, Return
  creates a note with that title.
- **Write in Markdown**: highlighted as you type, saved as you type. No save button, no preview mode.
- **To-dos in your notes**: `- [ ] text` is a to-do. Write a time, `- [ ] pay rent tomorrow 9am`, and it becomes a
  reminder with a desktop notification (and the notch island on Macs that have one). Times are read in English,
  Chinese and Japanese (`明天 9:00`, `明日 9時`). Type `todo` (or `/todo`) for every open to-do, grouped by when it is
  due; ⇧⌘D changes a reminder's time without typing.
- **Dictation**: hold ⌥ to talk into the search field or a note; double-press and hold ⌥ in any app for a quick note.
- **Actions**: ⌘K on a row to open, rename, copy, show in Finder, lock or move to the Trash (with undo).
- **Locked notes**: ⌘K → Lock makes a note read-only, for Jot, for your AI apps and for any other program: it is
  Finder's "Locked" (Get Info). A padlock marks it in the list; click "Locked" in its header to unlock it.
- **AI apps**: connect Claude Code, Claude, Cursor, VS Code, Windsurf, Codex or Gemini CLI from Settings in one
  click. A note an AI app writes carries its name (Claude, Cursor, …) and appears in the list the moment it lands.
  If you allow it in Settings, they can also move notes to the Trash and rewrite them; what they take away goes to
  the Trash, where you can get it back.
- Light and dark appearance; panel themes: Jot's own Indigo, GitHub, One, Dracula, Tokyo Night, Catppuccin, Gruvbox and
  High Contrast, each with a light and a dark version. English, Simplified and Traditional Chinese and Japanese.

## How notes are stored

- One note is one `.md` file directly in the notes folder (`~/Documents/Jot` by default, changeable in Settings). The
  file name is the title.
- Notes an AI app creates start with YAML frontmatter that names it, `source: claude`, `source: cursor`, or
  `source: "agent:<name>"` for an app Jot doesn't know (the name the app gives itself when it connects); your own
  notes have none. Only these values mark a note as an app's: a `source` of your own (a web clipper's URL, a book) is
  yours. A locked note has `locked: true` in its frontmatter as well as the file's "Locked" flag. Other frontmatter
  is kept as it is.
- A reminder is written into the file as an absolute time, `- [ ] pay rent ⏰ 2026-11-14 09:00` (the same form as
  Obsidian's Reminder plugin); a checked to-do gets its completion date, `- [x] pay rent ✅ 2026-11-14`.
- Jot does no syncing itself: put the folder in iCloud Drive, Dropbox or Syncthing. Settings → General → "Move to
  iCloud Drive…" moves the notes to `iCloud Drive/Jot` (never over a note there: one of the same title is kept with
  a number) and switches to it; connected AI apps follow. A note iCloud moved off the Mac stays in the list,
  marked "Downloading…", and fills in when it is back; a note changed on two devices at once offers to keep this
  Mac's version, the other, or both.

## AI apps and MCP

`jot-mcp` is a stdio MCP server that reads and writes the notes folder directly, whether or not the app is running.
Jot.app carries it inside (`Jot.app/Contents/MacOS/jot-mcp`). It searches, reads, creates and adds to notes and keeps
to-dos; it moves a note to the Trash or rewrites one only while you allow it (below), and never touches a locked
note. It deletes nothing for good.

### Connecting from Settings

Settings → AI Apps lists the AI apps installed on this Mac, each with its state, and connects or disconnects each in
one click:

| App | How Jot registers itself |
|---|---|
| Claude Code | `claude mcp add --scope user jot -- …` (Jot finds `claude` in `~/.local/bin`, Homebrew, npm's and Bun's folders) |
| Claude (desktop) | `mcpServers.jot` in `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `mcpServers.jot` in `~/.cursor/mcp.json` |
| VS Code | `servers.jot` (`"type": "stdio"`) in `~/Library/Application Support/Code/User/mcp.json` |
| Windsurf | `mcpServers.jot` in `~/.codeium/windsurf/mcp_config.json` |
| Codex | `[mcp_servers.jot]` in `~/.codex/config.toml` |
| Gemini CLI | `mcpServers.jot` in `~/.gemini/settings.json` |
| Zed | by hand: copy the entry into `context_servers` of `~/.config/zed/settings.json` |

Jot changes the `jot` entry only. The rest of the file keeps its settings; a TOML file keeps its layout and comments,
a JSON file its key order, indentation and line endings (it is written out again, so other formatting, such as a
one-line array, may change). Before its first change Jot copies the file beside it (`<file>.jot.bak`) and keeps that
copy. A file it cannot parse (JSON with comments, say) it never rewrites: the page offers the entry to copy instead, as
it does for Claude Code when `claude` is not found. When you change the notes folder, every connected app follows.
Restart an app that was open for it to load Jot. Jot connects nothing while macOS runs it from a temporary location
(opened straight from Downloads): move it to Applications first.

### By hand

For any other MCP app, the page shows the command and the JSON to copy. Or, from a checkout:

```sh
cargo build --release -p jot-mcp
claude mcp add --scope user jot -- "$PWD/target/release/jot-mcp" --dir ~/Documents/Jot
```

The folder is `--dir`, else the `JOT_DIR` environment variable, else `~/Documents/Jot`; `jot-mcp` expands a leading `~`
itself, since MCP clients start it without a shell. Most apps take the same JSON entry, with the binary's absolute
path:

```json
{
  "mcpServers": {
    "jot": {
      "command": "/Applications/Jot.app/Contents/MacOS/jot-mcp",
      "args": ["--dir", "~/Documents/Jot"]
    }
  }
}
```

Tools:

| Tool | What it does |
|---|---|
| `search_notes(query, limit?)` | Search titles and bodies |
| `read_note(title)` | Read a note in full |
| `recent_notes(limit?)` | The most recently modified notes |
| `create_note(title, body)` | Create a note, marked with the app's name (`source: cursor`) |
| `append_note(title, text)` | Append to an existing note |
| `add_todo(text, due?, note?)` | Add a to-do; `due` is an ISO local time or a phrase such as `tomorrow 3pm` or `明天 9点` |
| `list_todos(range?)` | Open to-dos: `overdue`, `today`, `upcoming` or `all` (default: today's and overdue) |
| `complete_todo(note, text)` | Check off a to-do; a unique part of its text is enough |
| `reschedule_todo(note, text, due)` | Change a to-do's reminder time; `null` removes it |

| `trash_note(title)` | Move a note to the Trash (needs your permission) |
| `replace_note(title, body)` | Rewrite a whole note; its previous version goes to the Trash first (needs your permission) |

Then ask the app things like "jot this command down", "remind me to send the weekly report on Friday" or "what's on my
list today?".

### Removing and rewriting notes

Settings → AI Apps → "Allow AI apps to move notes to the Trash and rewrite notes" is off at first. While it is off,
`trash_note` and `replace_note` are still listed but refuse, telling the app where you can turn them on. Turned on,
it applies to every connected app at once, with no reconnecting (`jot-mcp` reads it on each call, from
`~/Library/Application Support/Jot/ai.json`):

- `trash_note` moves the note to the Trash, not away for good: drag it from the Trash back into the notes folder.
- `replace_note` puts the note as it was (frontmatter included) in the Trash first, named like `Plan (before rewrite ·
  2026-11-25 14.30).md` in Jot's language, then writes the new text under the note's frontmatter, which it keeps.
- The apps are told to do either only when you ask, and to list the notes and ask you before removing many at once.

The switch keeps apps from doing it through Jot's tools. An app that can run shell commands could edit that file, or
the notes, itself; locking is what stops it from changing a note.

### Locked notes

A locked note can be read, searched and its to-dos listed by AI apps, but no tool changes it, and none unlocks it.
The lock is macOS's own (the file's `uchg` flag, Finder's "Locked"): the system refuses to change, rename, move or
delete the file, whoever asks, `rm` and `rm -f` from an AI app's shell included, and the Trash refuses it too. Jot
also writes `locked: true` into the note, since iCloud Drive does not carry the flag to your other Macs (it even
clears it when it uploads a note's new text); Jot puts the flag back from it, and a note you lock in Finder gets it
too. What a lock cannot stop: the file's owner can clear the flag (`chflags nouchg`, or Finder), and so can any
program that runs as you and sets out to; so can a program with administrator rights. A lock guards a note against
mistakes, not against a program determined to change it.

## Building

Jot is built with [NSH](https://github.com/longbridge/nsh): the UI is TSX, and the notes store, the reminders and the
platform code are Rust.

Jot builds against the NSH 0.6.0 crates from crates.io. Install the `nsh` CLI of the same version, 0.6.0 (see
[NSH's installation guide](https://github.com/longbridge/nsh)), then:

```sh
nsh run                       # build and run the app
nsh check                     # cargo check, then type-check the TSX
nsh test                      # Rust tests, then the TSX tests, headless
scripts/package-macos.sh      # build Jot.app, with jot-mcp inside
```

`scripts/package-macos.sh` builds `jot-mcp`, runs `nsh package --target macos` (it passes on its options: `--arch
universal`, `--out`, `--name`, …), puts `jot-mcp` in `Jot.app/Contents/MacOS` and signs both again (ad hoc;
`SIGN_IDENTITY` for another identity, then with a secure timestamp and the hardened runtime). It runs the `nsh` on your
`PATH`, or `NSH=/path/to/nsh`. While developing, `nsh run` (a debug build) finds `jot-mcp` in cargo's target folder:
build it once with `cargo build -p jot-mcp` to connect apps from Settings.

Only macOS is supported for now.

## Project layout

```
App.tsx    the app (TSX)
app/       app logic: actions, settings, to-dos, reminders, dictation
ui/        components and design tokens
locales/   translations
src/       the app's Rust crate (`jot/native`)
store/     jot-store: the notes folder, to-dos and time phrases, in plain Rust
mcp/       jot-mcp, the MCP server
tests/     the app's TSX tests (`nsh test`, headless)
scripts/   packaging
assets/    the app icon
docs/      architecture and product definition
design/    the interactive design draft and the logo
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes the crates and their APIs; [docs/PRODUCT.md](docs/PRODUCT.md) is the product
definition.

## Credits

The theme colors are adapted from these VS Code themes, all under the MIT license:
[GitHub Theme](https://github.com/primer/github-vscode-theme),
[One Dark Pro](https://github.com/Binaryify/OneDark-Pro) and [Atom One Light](https://github.com/akamud/vscode-theme-onelight),
[Dracula](https://github.com/dracula/visual-studio-code) (its light version Alucard from the
[Dracula specification](https://github.com/dracula/dracula-theme)),
[Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme),
[Catppuccin](https://github.com/catppuccin/vscode) and [Gruvbox](https://github.com/jdinhify/vscode-theme-gruvbox).
Jot picks their colors for a notes panel rather than a code editor and adjusts some to meet WCAG AA contrast.

## License

[MIT](LICENSE)
