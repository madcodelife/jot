# Jot (code name): product definition

## In one sentence

A quick-notes notebook you summon with a shortcut: the input field is both the search field and the new note's title;
you and Claude share the notebook, so Claude can write into it and read from it too.

## Why

- Notational Velocity / nvALT's interaction (searching is creating) still has users, and its author shipped a new
  release in 2026-10, but it is Mac-only; there is nothing comparable on Windows, Linux or phones.
- Scratchpads such as Heynote are Electron apps, criticized for their size and memory use, and have no phone version.
- AI assistants start from zero in every session. A small local notebook they can write, search and read gives you
  and them a shared memory.

## Core interaction

1. Double-press ⌥ to summon a centered floating panel; press it again or Esc to hide it (⌥Space is often taken by
   launchers). Double-pressing ⌥ needs Accessibility access; without it, Jot falls back to a fallback shortcut you can
   change.
2. The input field sits at the top of the panel. Typing filters notes by title and body as you type, most recently
   modified first.
3. ↑↓ select, Return opens; when nothing matches, Return creates a note with what you typed as its title.
4. Below is the editor, with Markdown highlighting and autosave as you type; there is no save button.
5. Notes Claude wrote carry a small mark in the list; while the app is open, new notes appear immediately.

## To-dos and reminders

Jot is still a notebook: to-dos live in notes, not in a separate task manager.

- `- [ ] text` in any note is a to-do. Click its checkbox or press ⌘↩ on its line to check it off; it becomes `- [x]`,
  with the completion date at the end of the line: `✅ 2026-11-14`.
- Writing a time makes it a reminder: `- [ ] 交房租 明天 9:00` ("pay rent tomorrow 9:00"). On save, the relative time
  is replaced by an absolute one in the file: `- [ ] 交房租 ⏰ 2026-11-14 09:00`
  ("tomorrow" stops being true the next day, so the file only stores absolute times; `⏰ YYYY-MM-DD HH:mm` is the same
  form as Obsidian's Reminder plugin). The interface draws it as a time chip.
  Phrases understood: 今天 / 明天 / 后天 (today / tomorrow / the day after tomorrow), 周一 to 周日 (Monday to Sunday),
  下周五 (next Friday), 11月20日 (Nov 20), 20号 (the 20th), 9点 / 9:30 / 下午3点 (9 o'clock / 9:30 / 3 pm),
  半小时后 / 2小时后 (in half an hour / in 2 hours); a date without a time means 9:00. English and Japanese phrases
  work too (`tomorrow 9am`, `next friday`, `明日 9時`).
- Changing a time needs no typing: click the time chip in a note or the time in the to-do view, or press ⇧⌘D on a
  to-do ("Reminder Time…" in ⌘K), and a time picker opens: first "In an hour / This evening / Tomorrow morning / Next
  Monday" (past ones are left out), then a calendar and a time, set with ⌘↩; when there is a time, "Remove Reminder".
  A change in a note is one edit that ⌘Z takes back; a reminder whose time changed fires at the new time, and an
  earlier "in 10 minutes" snooze is dropped.
- When it comes due: a system notification on the desktop (the to-do as the title, its note as the body) with the
  buttons "Done", "In 10 Minutes" and "Open"; on the Mac, the notch island also pops out "Reminder · Pay rent", and a
  click checks it off. Reminders missed while the computer slept are merged into one on waking: "You missed 2
  reminders".
- The to-do view: typing "todo" (待办 in Chinese, or `/todo`) in the search field lists every open to-do, grouped as
  overdue, today, tomorrow, later and without a time; each shows the note it is in. When the panel has just been
  summoned and nothing is typed yet, the top of the list has a row "3 to-dos today"; Return opens the to-do view.
- Claude: say "remind me to send the weekly report on Friday" and Claude writes a to-do with a time; ask "what do I
  have to do today" and Claude lists them; say "move paying rent to Friday" and Claude changes its time.

Not doing: projects, priorities, tag-style contexts, complex recurrence rules, assigning to other people.

## Storage

- Notes are `.md` files in a folder (`~/Documents/Jot` by default, changeable); the file name is the title.
- YAML frontmatter at the top records the source: `source: claude`. Notes the user writes get none.
- Jot does no syncing of its own; iCloud Drive, Dropbox or Syncthing handle it.

## MCP for Claude

`jot-mcp`: a stdio MCP server (Rust) that reads and writes the notes folder directly, so it works whether or not the
app is running.

| Tool | What it does |
|---|---|
| `search_notes(query, limit?)` | Searches titles and bodies; returns titles, snippets and modified times |
| `read_note(title)` | Reads a note's full text |
| `recent_notes(limit?)` | Lists the most recently modified notes |
| `create_note(title, body)` | Creates a note; fails if the title exists, suggesting `append_note` instead |
| `append_note(title, text)` | Appends a paragraph to the end of an existing note |
| `add_todo(text, due?, note?)` | Adds a to-do; `due` is an ISO time, and without `note` it goes to the note "待办" (To-dos) |
| `list_todos(range?)` | Lists open to-dos: `overdue` / `today` / `upcoming` / `all`, with their times and notes |
| `complete_todo(note, text)` | Checks off a to-do (only its checkbox changes; nothing is deleted) |
| `reschedule_todo(note, text, due)` | Changes the reminder time of an open to-do (only its `⏰` part); `due` is an ISO time or a phrase such as 周五 9点 ("Friday 9 o'clock"), `null` removes the reminder |

The first version offers no delete or overwrite, so Claude cannot damage what the user wrote. Setup:
`claude mcp add jot -- <path to jot-mcp> --dir <notes folder>`; a one-click "Connect Claude" will come to the app's
settings later.

## What the first version does and doesn't do

Does: the macOS desktop (NSH's AppKit backend), resident in the tray, the floating panel summoned by double-pressing ⌥,
search-to-create, editing with autosave, watching the folder for changes, to-dos and desktop reminders, `jot-mcp`,
light and dark themes.

Not yet: Windows, Linux and phones (the next step, from the same code; due reminders on phones wait for scheduled
notifications in NSH), syncing of its own, tags and nested folders, rich text, scratch blocks and inline calculation,
one-click Claude connection in the app.

## Design tone

Modeled on Bear, Things and Raycast's floating panel: restrained, generous whitespace, careful typography; both the
light and dark palettes finely tuned. The panel is about 680×440, with rounded corners, and hides itself when it
loses focus.

## Acceptance

- From pressing the shortcut to being able to type, there is no perceptible delay.
- Saying "save this command to Jot" in Claude Code makes the note appear in the app's list at once, with Claude's mark.
- Asking "did I save the wifi password in Jot?" in Claude Code, Claude finds it and reads it out.
