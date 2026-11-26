# Jot (code name): product definition

## In one sentence

A quick-notes notebook you summon with a shortcut: the input field is both the search field and the new note's title;
you share the notebook with your AI apps (Claude, Cursor, Codex, …), so they can write into it and read from it too.

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
4. Below is the editor, with a live Markdown preview and autosave as you type; there is no save button. The Markdown
   reads as it renders (large headings, bold words, a link's words, code in a monospaced font, a checkbox for a to-do)
   while its syntax hides; the syntax comes back where the caret is, so the file stays plain Markdown and there is no
   separate preview mode.
5. Notes an AI app wrote carry its name in the list (Claude, Cursor, …); while the app is open, new notes appear
   immediately.

## To-dos and reminders

Jot is still a notebook: to-dos live in notes, not in a separate task manager.

- `- [ ] text` in any note is a to-do. Click its checkbox or press ⌘↩ on its line to check it off; it becomes `- [x]`,
  with the completion date at the end of the line: `✅ 2026-11-14`. Checking one off yourself makes no sound: Jot's
  sounds are for what AI apps do (below).
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
- When it comes due: a system notification on the desktop (the to-do as the title, its note as the body, Jot's own
  soft chime as its sound, which the system's notification settings and Focus govern) with the buttons "Done", "In 10
  Minutes" and "Open"; on the Mac, the notch island also pops out "Reminder · Pay rent", and a click checks it off.
  Reminders missed while the computer slept are merged into one on waking: "You missed 2 reminders".
- The to-do view: typing "todo" (待办 in Chinese, or `/todo`) in the search field lists every open to-do, grouped as
  overdue, today, tomorrow, later and without a time; each shows the note it is in. When the panel has just been
  summoned and nothing is typed yet, the top of the list has a row "3 to-dos today" (or "1 overdue to-do") while
  something is left today or overdue, and none when nothing is due; Return on it opens the to-do view.
- AI apps: say "remind me to send the weekly report on Friday" and the app writes a to-do with a time; ask "what do I
  have to do today" and it lists them; say "move paying rent to Friday" and it changes its time.

Not doing: projects, priorities, tag-style contexts, complex recurrence rules, assigning to other people.

## Storage

- Notes are `.md` files in a folder; the file name is the title. The folder is changeable; by default it is `iCloud
  Drive/Jot` where iCloud Drive is on, so notes reach the user's other devices and outlive the Mac without a setup
  step, else `~/Documents/Jot`. A Mac that ran Jot before keeps `~/Documents/Jot`, and the folder chosen on the first
  run is remembered: turning iCloud Drive off or on later never moves Jot.
- YAML frontmatter at the top records the source: `source: claude`, `source: cursor`, `source: "agent:<name>"`. Notes
  the user writes get none, and a `source` the user wrote (a clipped page's URL) still means the user. A locked note
  also has `locked: true` (below).
- Jot does no syncing of its own; iCloud Drive, Dropbox or Syncthing handle it. Settings can move the notes into
  iCloud Drive in one step (asking first; nothing there is overwritten). A synced folder must never lose a note:
  one iCloud moved off the Mac is still listed and searchable by title, downloads when needed and is read-only till
  then; nothing waits on a download. A note changed on two devices at once shows both versions' choice: keep this
  Mac's, use the other, or keep both.

## MCP for AI apps

`jot-mcp`: a stdio MCP server (Rust) that reads and writes the notes folder directly, so it works whether or not the
app is running.

Its instructions tell the model to search the notes not only when the user asks about them, but also before guessing
at or asking for a fact about the user's own things that the conversation does not give: which machine, its address
or login, an account, an earlier decision. "Check my Ubuntu machine" should find the note with its login before the
model tries usernames.

| Tool | What it does |
|---|---|
| `search_notes(query, limit?)` | Searches titles and bodies; returns titles, snippets and modified times |
| `read_note(title)` | Reads a note's full text |
| `recent_notes(limit?)` | Lists the most recently modified notes |
| `create_note(title, body)` | Creates a note, marked with the app's name; fails if the title exists, suggesting `append_note` instead |
| `append_note(title, text)` | Appends a paragraph to the end of an existing note |
| `add_todo(text, due?, note?)` | Adds a to-do; `due` is an ISO time, and without `note` it goes to the note "待办" (To-dos) |
| `list_todos(range?)` | Lists open to-dos: `overdue` / `today` / `upcoming` / `all`, with their times and notes |
| `complete_todo(note, text)` | Checks off a to-do (only its checkbox changes; nothing is deleted) |
| `reschedule_todo(note, text, due)` | Changes the reminder time of an open to-do (only its `⏰` part); `due` is an ISO time or a phrase such as 周五 9点 ("Friday 9 o'clock"), `null` removes the reminder |
| `trash_note(title)` | Moves a note to the system Trash (not a permanent delete); needs the user's permission |
| `replace_note(title, body)` | Rewrites a note's whole body, its frontmatter kept; the note as it was goes to the Trash first, as "Title (before rewrite · 2026-11-25 14.30)" in Jot's language; needs the user's permission |

The first version offered no delete or overwrite. Now an AI app may take something away, on two conditions:

- **The user allows it.** Settings → AI Apps → "Allow AI apps to move notes to the Trash and rewrite notes", off by
  default. While off, the two tools are listed but refuse, saying where to turn them on; the change applies to every
  connected app at its next call. The MCP instructions say how the setting stands, and tell the model to use the
  tools only when asked and, before removing many notes at once ("全部清掉"), to list them and ask the user.
- **Nothing is lost.** What a tool takes away goes to the Trash, the note itself (`trash_note`) or the note as it
  was before a rewrite (`replace_note`); the user gets it back from there. No tool deletes for good.

Notes the user locked stay out of reach of every tool, whatever the setting.

## Locked notes

The user locks a note they want kept as it is (a contract, a password hint, a list they finished): ⌘K → "Lock". A
locked note:

- is read-only in Jot: its header shows a padlock and "Locked" (a click unlocks it, no confirmation, as locking asks
  none), the list shows a small padlock, ⌘K offers "Unlock" instead of "Lock" and no "Rename", ⌃X says to unlock it
  first; its reminders still come due, but the island cannot tick them ("Locked · unlock the note in Jot to check
  this off") and the to-do view says to unlock it;
- can be read, searched and listed by AI apps (marked "locked"), but every tool that changes it refuses ("the user
  unlocks it in Jot first"); there is no tool to unlock one;
- is locked for every other program too: it is macOS's own "Locked" (Finder's Get Info; the `uchg` flag), so the
  system refuses to change, rename, move or delete it, `rm -f` in an AI app's shell included.

The lock travels as `locked: true` in the note, since iCloud Drive does not sync the flag (it clears it when it
uploads the note's new text): Jot puts the flag back on a note that says so, and writes `locked: true` into a note
locked in Finder. Unlocking takes both away; unlocking in Finder alone does not last while the note still says
`locked: true`.

What a lock does not stop, said as it is: the file's owner can clear the flag (Finder, `chflags nouchg`), and so can
any program running as the user that sets out to, or one with administrator rights. The lock guards against
mistakes and against tools that respect it, not against a program determined to change the file.

Setup is one click: Settings → AI Apps lists the AI apps installed on the Mac (Claude Code, Claude, Cursor, VS Code,
Windsurf, Codex, Gemini CLI; Zed by hand) with their state, and connects or disconnects each; `jot-mcp` ships inside
Jot.app. Jot edits only its own entry in each app's configuration, keeps the file as it was before Jot beside it, and
never rewrites a file it cannot parse (it offers the entry to copy instead). Run from a temporary location (opened
from Downloads), it connects nothing and asks to be moved to Applications. Changing the notes folder updates every connected app. For
any other MCP app the page gives the command and the JSON entry to copy; by hand,
`claude mcp add --scope user jot -- <path to jot-mcp> --dir <notes folder>`.

A note an AI app creates records which app it was (`source: cursor`, from the name the app gives when it connects), and
the list and the note show that name: "By Cursor". The notch island says what an AI app does on this Mac, by name: a new
note is written and saved ("Claude · Saved to Jot"), and, more lightly, text added to a note, a to-do added, completed or
given a new time, a note rewritten (its old version in the Trash) or moved to the Trash; a click on it opens the note,
or shows the trashed one in the Trash. Two of these make a short, soft sound as the island says them, quieter than the
reminder's chime: a new note, a bright tap as the island opens on it, and a completed to-do, a softer one as its check
pops in. Everything else an AI app does is silent, and so is everything the user does. Settings › General › Sound
Effects turns them off (on by default), as does the system's "Play user interface sound effects"; the reminders' sound
is the notifications' and stays the system's to govern.

## What the first version does and doesn't do

Does: the macOS desktop (NSH's AppKit backend), resident in the tray, the floating panel summoned by double-pressing ⌥,
search-to-create, editing with autosave, watching the folder for changes, to-dos and desktop reminders, `jot-mcp`
and one-click connection to the AI apps on the Mac, light and dark themes, locked notes, and (allowed in Settings)
AI apps moving notes to the Trash and rewriting them.

Not yet: Windows, Linux and phones (the next step, from the same code; due reminders on phones wait for scheduled
notifications in NSH), syncing of its own, tags and nested folders, rich text, scratch blocks and inline calculation.

## Design tone

Modeled on Bear, Things and Raycast's floating panel: restrained, generous whitespace, careful typography; both the
light and dark palettes finely tuned. The panel is about 680×440, with rounded corners, and hides itself when it
loses focus.

## Acceptance

- From pressing the shortcut to being able to type, there is no perceptible delay.
- Saying "save this command to Jot" in Claude Code makes the note appear in the app's list at once, marked "Claude Code".
- Asking "did I save the wifi password in Jot?" in Claude Code, it finds it and reads it out.
- Settings → AI Apps → Connect on Cursor (or any listed app) makes Jot's tools available there after a restart of the
  app, and changing the notes folder moves the connection along.
