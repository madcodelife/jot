# MCP for AI apps

How AI apps connect, what `jot-mcp` (mcp/) lets them do, the setting that allows removing and rewriting notes, and the
activity log that tells the app what they wrote. Part of [the architecture](architecture.md).

## Connecting apps (src/connect.rs)

Settings › AI Apps lists the AI apps installed on this Mac, each with its state, and connects or disconnects each in
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

How Jot edits those files (only the `jot` entry, a `<file>.jot.bak` copy first, never a file it cannot parse) is
in [app.md](app.md)'s `Connections`.

`jot-mcp`'s folder is `--dir`, else the `JOT_DIR` environment variable, else `~/Documents/Jot`; it expands a leading
`~` itself, since MCP clients start it without a shell. From a checkout:

```sh
cargo build --release -p jot-mcp
claude mcp add --scope user jot -- "$PWD/target/release/jot-mcp" --dir ~/Documents/Jot
```

## AI apps removing and rewriting notes (store/src/settings.rs, mcp/)

`trash_note` and `replace_note` work only while the user allows it: Settings › AI Apps › "Allow AI apps to move
notes to the Trash and rewrite notes", off by default. `jot-mcp` runs in each AI app's process, started by the app
with the arguments written in its configuration, so the setting cannot be an argument (changing it would mean
rewriting every app's configuration and restarting the apps) nor in NSH's Storage (the app's alone). It is a file
outside the notes folder that the app writes and `jot-mcp` reads on every call of the two tools (and as it starts,
for its instructions): `~/Library/Application Support/Jot/ai.json`, `{"allowTrashAndRewrite": true, "language":
"zh-Hans"}` (`AiSettings`; missing or unreadable is off). The language is the one Jot shows, which names a
rewritten note's previous version: `Plan (before rewrite · 2026-11-25 14.30)`, `计划（改写前 · …）`, `計劃（改寫前 · …）`,
`計画（書き換え前 · …）` (no colon: Finder shows one as a slash; the title shortened to fit 255 bytes).

The tools stay listed while the setting is off and refuse with where to turn it on: a changing tool list needs the
client to follow `notifications/tools/list_changed`, which not every client does, and `jot-mcp` would have to watch
the file; a listed tool that explains itself lets the model tell the user how to allow it. Both are annotated
`destructiveHint: true`, `readOnlyHint: false`, `openWorldHint: false` and `idempotentHint: true` (`trash_note`
again finds nothing to trash; `replace_note` with the same body changes nothing and trashes nothing). The server's
instructions say how the setting stood as the app connected, to use the tools only when asked, and to list the
notes and ask before removing many at once. `replace_note` refuses an empty body and a body that starts with a `---`
frontmatter block (it would become the note's frontmatter); the note's own frontmatter is kept.

`edit_note` is not one of them: changing one passage is an ordinary write like `append_note`, works whatever the
setting and puts nothing in the Trash ([below](#mcp-tools-mcp)).

The switch is about Jot's tools: an app that runs shell commands can edit the file, or the notes, itself; locking
a note is what keeps it as it is.

## MCP tools (mcp/)

MCP tools (mcp/) never wait on a download unbounded: a tool that needs a note's text (`read_note`, `append_note`,
`edit_note`, `add_todo`, `complete_todo`, `reschedule_todo`) waits up to 20 s for a note iCloud is downloading, then
says it is still downloading (`NotDownloaded`); listings mark such a note "not downloaded to this Mac yet";
`read_note` mentions conflict versions iCloud kept.

MCP tools (mcp/) on a locked note: reading, searching, listing and `list_todos` go on (listings and `read_note` say
"locked in Jot (read-only)"); every tool that writes fails with "locked in Jot … the user unlocks it in Jot first".
No tool locks or unlocks.

MCP tools (mcp/): `create_note` and `add_todo` record the calling app as the new note's `source`
(`Source::from_client` of the `initialize` handshake's `clientInfo.name`). `add_todo(text, due?, note?)` (`due`: ISO `2026-11-14T09:00` or a phrase `when::parse` reads, in
Chinese, English or Japanese; without `due`, a phrase in `text` becomes the time),
`list_todos(range?)` (`overdue` | `today` | `upcoming` | `all`, default `today`+`overdue`), `complete_todo(note, text)`,
`reschedule_todo(note, text, due)` (`due` required: ISO or a phrase `when::parse` reads; `null` removes the reminder;
only the `⏰` part of the line changes). The last two find the open to-do the same way: the exact text, else the one
whose text holds it; several or none fail, listing the candidates.

MCP tools (mcp/): `edit_note(title, old_text, new_text)` changes one passage of a note, so an app corrects a fact (a
machine's new IP) where it is instead of appending a line that contradicts it or rewriting the whole note
(`Store::edit`). `old_text` is matched exactly, line breaks included, in the body only: the frontmatter is never
searched nor changed. It must be there once: none fails saying it was not found (read the note with `read_note`),
several fail with the count (pass more of the text around it), overlapping places counted. An empty `new_text`
removes the passage. Refused, changing nothing: an empty `old_text`, a `new_text` the same as it, and a change that
would make the body start with a `---` block (it would become the frontmatter). It is annotated like `append_note`
(not destructive, not idempotent). The server's instructions say to use it to fix or update a fact in an existing
note, `append_note` to add something, and `replace_note` only for a whole rewrite the user asked for.

## The activity log (store/src/activity.rs, mcp/)

The app learns what AI apps write from a log `jot-mcp` keeps, not from the notes folder: a note appearing there says
neither who wrote it nor on which Mac (one an AI app made on another Mac arrives through iCloud Drive like any other).
`jot-mcp` writes the log and the app reads it; nothing else is shared between them but the folder and `ai.json`.

- **Where**: beside `ai.json`, `~/Library/Application Support/Jot/activity.jsonl` (`Activity::path`, the same rule as
  `AiSettings::path`; `~/.config/jot/activity.jsonl` elsewhere).
- **What**: one JSON object a line, for every write a tool made, after it succeeded (a tool that fails or changes
  nothing writes none):

  ```json
  {"at":"2026-11-26T14:30:05","dir":"/Users/me/Documents/Jot","agent":"Claude Code","action":"replace","title":"Plan","previous":"Plan (before rewrite · 2026-11-26 14.30)","inTrash":"/Users/me/.Trash/Plan (before rewrite · 2026-11-26 14.30).md"}
  ```

  `at` is the local time; `dir` the notes folder, absolute with links resolved; `agent` the app's name as Jot shows it
  (`Source::label` of the `initialize` handshake's `clientInfo.name`: "Claude Code", "Cursor", or the name an unknown
  app gave); `title` the note's. `action`: `create` (`create_note`, and `add_todo` into a note it made), `append`
  (`append_note`), `edit` (`edit_note`), `todo` (`add_todo` into a note that was there), `complete`
  (`complete_todo`), `reschedule` (`reschedule_todo`), `replace` (`replace_note`; `previous` is the name the old
  version took in the Trash) or `trash` (`trash_note`). `inTrash` is where the trashed note (or the old version) went, when the system says.
- **Writing**: each line is one `write` to the file opened for appending (`O_APPEND`), so lines from several
  `jot-mcp` processes (one per AI app) never mix. Past about 256 KB (`ROTATE_AT`) the file is renamed
  `activity.1.jsonl`, over the one before, and a new one is started. A record that cannot be written is left out
  (a line on stderr): the tool's result is the same, the app just shows nothing of it.
- **Reading** (`ActivityTail`, `watch_activity`): the app starts at the log's end (nothing from before it started is
  shown), keeps how far it read and which file (device and inode), and reads only the lines added, on the folder
  watcher's word (debounced ~150 ms). A file that was replaced or got shorter was rotated: the rest of the old one
  (now `activity.1.jsonl`) is read, then the new one from its start. A line still being written waits for its end; one
  that is not a record is skipped. The app keeps the records whose `dir` is its notes folder, compared with links
  resolved (and case aside on the Mac); what it does with them is in [app.md](app.md).

Tests never touch the user's `~/Library/Application Support/Jot`: the server's tests give it a log and a settings file
of their own (`JotServer::with_activity_file`, `with_settings_file`); the app's tests start from the stand-ins in
`app/tests/native.ts`, which give it no log and no settings file (`ActivityLog.path`, `AiAccess`), and the island's
tests give it a log of their own.
