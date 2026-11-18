<p align="center">
  <img src="design/logo/loop/png/jot-horizontal.png" alt="Jot" width="240">
</p>

<p align="center"><a href="README.zh-CN.md">中文</a></p>

# Jot

Jot is a quick-notes app for macOS that you share with Claude. Double-press ⌥ anywhere and a floating panel appears;
its one field is both the search box and the title of a new note, so you type, and either find what you wrote before
or press Return to start a new note. Notes are plain Markdown files in a folder you choose. To-dos and reminders live
inside those notes, and `jot-mcp`, a small MCP server, lets Claude search, read and add to the same notes, so you and
Claude keep one notebook between you.

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
- **Actions**: ⌘K on a row to open, rename, copy, show in Finder or move to the Trash (with undo).
- **Claude**: notes Claude writes are marked as Claude's, and appear in the list the moment they land.
- Light and dark appearance, several panel themes, English, Simplified and Traditional Chinese and Japanese.

## How notes are stored

- One note is one `.md` file directly in the notes folder (`~/Documents/Jot` by default, changeable in Settings). The
  file name is the title.
- Notes Claude creates start with YAML frontmatter, `source: claude`; your own notes have none. Other frontmatter is
  kept as it is.
- A reminder is written into the file as an absolute time, `- [ ] pay rent ⏰ 2026-11-14 09:00` (the same form as
  Obsidian's Reminder plugin); a checked to-do gets its completion date, `- [x] pay rent ✅ 2026-11-14`.
- Jot does no syncing itself: put the folder in iCloud Drive, Dropbox or Syncthing.

## Claude and MCP

`jot-mcp` is a stdio MCP server that reads and writes the notes folder directly, whether or not the app is running.
It never deletes or overwrites a note.

```sh
cargo build --release -p jot-mcp
claude mcp add jot -- <path to jot-mcp> --dir <notes folder>
# for example:
claude mcp add jot -- "$PWD/target/release/jot-mcp" --dir ~/Documents/Jot
```

The folder is `--dir`, else the `JOT_DIR` environment variable, else `~/Documents/Jot`; `jot-mcp` expands a leading `~`
itself, since MCP clients start it without a shell. Add `--scope user` to `claude mcp add` to use Jot in every
project.

For Claude Desktop, add the server to `~/Library/Application Support/Claude/claude_desktop_config.json` (Settings →
Developer → Edit Config) with the binary's absolute path, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "jot": {
      "command": "/absolute/path/to/jot-mcp",
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
| `create_note(title, body)` | Create a note, marked `source: claude` |
| `append_note(title, text)` | Append to an existing note |
| `add_todo(text, due?, note?)` | Add a to-do; `due` is an ISO local time or a phrase such as `tomorrow 3pm` or `明天 9点` |
| `list_todos(range?)` | Open to-dos: `overdue`, `today`, `upcoming` or `all` (default: today's and overdue) |
| `complete_todo(note, text)` | Check off a to-do; a unique part of its text is enough |
| `reschedule_todo(note, text, due)` | Change a to-do's reminder time; `null` removes it |

Then ask Claude things like "jot this command down", "remind me to send the weekly report on Friday" or "what's on my
list today?".

## Building

Jot is built with [NSH](https://github.com/longbridge/nsh): the UI is TSX, and the notes store, the reminders and the
platform code are Rust.

Jot builds against the NSH 0.6.0 crates from crates.io. Install the `nsh` CLI of the same version, 0.6.0 (see
[NSH's installation guide](https://github.com/longbridge/nsh)), then:

```sh
nsh run                       # build and run the app
nsh check                     # cargo check, then type-check the TSX
nsh test                      # Rust tests, then the TSX tests, headless
nsh package --target macos    # build Jot.app
```

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
design/    the interactive design draft and the logo
```

[ARCHITECTURE.md](ARCHITECTURE.md) describes the crates and their APIs; [PRODUCT.md](PRODUCT.md) is the product
definition.

## License

[MIT](LICENSE)
