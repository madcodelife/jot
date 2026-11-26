// Jot's state: the notes folder, the panel's stage (hidden, the capsule, the
// list, a note open), the query and the selection, and what the user does
// with them. Components read these signals; only the functions below write
// them, so every change goes through one place.
import { batch, computed, platform, signal, Storage, untracked } from "nsh";
import { t } from "nsh/i18n";
import { ActivityLog, Folder, Notes, Reminders, Summon, type AgentActivity, type DueEvent, type ICloudDrive, type MovedNotes, type NoteMeta, type Todo, type TrashedNote } from "jot/native";
import { morphNext } from "./ui/motion";
import { T } from "./ui/tokens";
import { syncClients } from "./connections";
import { todoKeyword, todoKeywords } from "./i18n";
import { groupOf, parseDue, todaySummary, type TodoGroup } from "./time";

/** Where the panel is: hidden, the summoned capsule, the list, or a note open beside the list. */
export type Stage = "hidden" | "capsule" | "list" | "editor";

/** A row of the list. */
export type Row =
  | { kind: "summary" }
  | { kind: "note"; meta: NoteMeta; snippet: string; terms: string[] }
  | { kind: "create"; title: string };

/** An item of the to-do view: a group's header, or a to-do. */
export type TodoItem =
  | { kind: "header"; group: TodoGroup; count: number }
  | { kind: "todo"; todo: Todo; group: TodoGroup; key: string; index: number };

/** How many notes a search shows. */
const LIMIT = 6;

/** Storage keys: the notes folder (the user may move it), and whether Jot was shown once. */
const DIR_KEY = "jot.dir";
const WELCOMED_KEY = "jot.welcomed";

/** The notes folder, once it is open. */
export const notes = signal<Notes | null>(null);
/** The folder's absolute path, and as people read it (`~/Documents/Jot`): the footer and the settings show it. */
export const folderPath = signal<string | null>(null);
export const folderShown = signal<string>(T.folder.shown);
/** Why the folder could not be opened. */
export const folderError = signal<string | null>(null);
/** Bumped whenever the folder changes (on disk, or by Jot): what reads the notes reads it. */
export const revision = signal(0);
/** The time, a tick a minute: relative times and due groups follow it. */
export const now = signal(Date.now());

/** Whether the double press works (macOS asks for the Accessibility permission); without it the fallback shortcut summons Jot. */
export const trusted = signal(Summon.isTrusted());

export const stage = signal<Stage>("hidden");
export const query = signal("");
export const selected = signal(0);
/** The note open in the editor; `token` changes on each opening (the editor reloads), `line` is where its caret goes. */
export const opened = signal<{ title: string; line: number | null; focus: boolean; token: number } | null>(null);
/** A row that just arrived from an AI app (a new note whose `source` is an app's, from this Mac or synced from another): it drops in once. */
export const arriving = signal<string | null>(null);
/** A short message in the footer (a title the folder cannot take). */
export const notice = signal<string | null>(null);
/** Asks the panel to focus the search field or the editor (a new object each time). */
export const focusRequest = signal<{ target: "field" | "editor" }>({ target: "field" }, { equals: false });
/** Bumped as the list opens: rows made then drop in one after another. */
export const listEntrance = signal(0);
/** True for the rest of the turn that started the list's entrance: rows made for it drop in too, rows a search adds later do not. */
let entranceTurn = false;
export const entering = () => entranceTurn;
/** Starts the list's entrance (the panel summoned, the to-do view opened): every row drops in. */
function startEntrance() {
  listEntrance.update((n) => n + 1);
  entranceTurn = true;
  setTimeout(() => {
    entranceTurn = false;
  }, 0);
}
/** To-dos being ticked in the to-do view: they stay, checked, until their row folds away. */
export const checking = signal<ReadonlySet<string>>(new Set());
/** The notes moved to the trash while "Moved to the trash" shows, the last one on top: the undo key takes them back one by one. */
export const trashed = signal<readonly TrashedNote[]>([]);
/** Bumped as a note goes to the trash or one comes back: the footer's countdown starts over. */
export const trashCountdown = signal(0);
/** A short confirmation in the footer ("Copied"), gone after a moment. */
export const flash = signal<string | null>(null);
/** The note whose title is being edited in its row (the action panel's "Rename"). */
export const renaming = signal<string | null>(null);

/** Notes Jot itself created this run: not an AI app's arrivals. */
const createdHere = new Set<string>();
/** What Jot last wrote per note: the folder's echo of its own saves is not an outside change. */
export const lastWritten = new Map<string, string>();
/** The notes as last seen, to tell new ones apart. */
let known = new Set<string>();
let openings = 0;
/** The query Escape goes back to from a note opened out of the to-do view. */
let backQuery: string | null = null;
/** Notes moved to the trash (lowercase titles): a late autosave of the editor never brings one back. */
const gone = new Set<string>();
/** Saves the open note's pending edits now (the editor sets it while a note is open). */
let flushEditor: (() => void) | null = null;
let trashTimer: ReturnType<typeof setTimeout> | undefined;

let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows `text` in the footer for a moment. */
export function showFlash(text: string) {
  flash.set(text);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => flash.set(null), T.timing.savedFor);
}

/** The editor's way to save its pending edits at once, before its note goes to the trash; `null` as it closes. */
export function setEditorFlush(flush: (() => void) | null) {
  flushEditor = flush;
}

/** The platform's own words (the trash's name, the file manager's) come in one form per desktop. */
export const desktopOs = platform.os === "windows" ? "windows" : platform.os === "linux" ? "linux" : "macos";
/** The system trash as this platform names it (废纸篓, 回收站). */
export const binName = () => t(`trash.bin.${desktopOs}`);

/** The `code` of an error `jot/native` threw (`ERR_JOT_*`, or Node's errno codes for I/O). */
export const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;

/** An error's message, for a notice. */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The to-do view's word in the language shown ("待办", "todo", "やること"), or "/todo". */
export const isTodoQuery = (q: string) => todoKeywords().includes(q.trim().toLowerCase());
export const todoMode = computed(() => isTodoQuery(query()));

/** Whether the note titled `title` is locked (in Jot, in Finder or on another Mac): read-only until it is unlocked. Tracked. */
export const isLocked = (title: string) => allNotes().some((m) => m.title === title && m.locked);

/** Every note, newest first. */
export const allNotes = computed<NoteMeta[]>(() => {
  revision();
  const list = notes()?.list() ?? [];
  if (list.some((m) => m.downloading)) checkDownloads();
  return list;
});

let downloadTimer: ReturnType<typeof setTimeout> | undefined;

/** Notes are downloading (iCloud Drive moved them off the Mac, and Jot asked for them): the folder is read again in a
 * moment, and again while one still is. The watcher reports most of them landing; a file filled in place may slip by. */
function checkDownloads() {
  if (downloadTimer !== undefined) return;
  downloadTimer = setTimeout(() => {
    downloadTimer = undefined;
    refresh();
  }, T.timing.downloadPoll);
}

/** Every to-do of every note. */
export const allTodos = computed<Todo[]>(() => {
  revision();
  return notes()?.todos() ?? [];
});

/**
 * The list's rows for the query: while it is empty, today's row first when something is left today or overdue (none
 * when nothing is due: the to-do view is a "todo" away); a "new note" row last while no note has that title.
 */
export const rows = computed<Row[]>(() => {
  const n = notes();
  const q = query().trim();
  revision();
  if (!n || isTodoQuery(q)) return [];
  if (!q) {
    const recent = allNotes().slice(0, LIMIT);
    const due = todaySummary(allTodos(), new Date(now()));
    const head: Row[] = due.left || due.late ? [{ kind: "summary" }] : [];
    return [...head, ...recent.map((meta): Row => ({ kind: "note", meta, snippet: meta.preview, terms: [] }))];
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = n.search(q, LIMIT);
  const out: Row[] = hits.map((h) => ({ kind: "note", meta: h.meta, snippet: h.snippet, terms }));
  if (!hits.some((h) => h.meta.title.toLowerCase() === q.toLowerCase())) out.push({ kind: "create", title: q });
  return out;
});

const stamp = (t: Todo) => `${t.note}\u0000${t.line}`;

/** The to-do view: open to-dos by group (overdue, today, tomorrow, later, no time), each group by due time. */
export const todoItems = computed<TodoItem[]>(() => {
  const at = new Date(now());
  const ticking = checking();
  const groups = new Map<TodoGroup, Todo[]>();
  for (const t of allTodos()) {
    if (t.done && !ticking.has(stamp(t))) continue;
    const g = groupOf(parseDue(t.due), at);
    groups.set(g, [...(groups.get(g) ?? []), t]);
  }
  const out: TodoItem[] = [];
  let index = 0;
  for (const g of ["late", "today", "tomorrow", "later", "none"] as const) {
    const list = groups.get(g);
    if (!list) continue;
    list.sort((a, b) => (parseDue(a.due)?.getTime() ?? 0) - (parseDue(b.due)?.getTime() ?? 0));
    out.push({ kind: "header", group: g, count: list.length });
    for (const todo of list) out.push({ kind: "todo", todo, group: g, key: stamp(todo), index: index++ });
  }
  return out;
});

/** How many rows the arrow keys move through. */
const selectable = () => (todoMode() ? todoItems().filter((i) => i.kind === "todo").length : rows().length);

/**
 * The notes folder of a Mac with none chosen yet: Jot's folder in iCloud Drive when iCloud Drive is on here, so the
 * notes reach the user's other devices and outlive this Mac from the start; else ~/Documents/Jot. A Mac that ran
 * Jot before (welcomed) keeps ~/Documents/Jot, the folder its notes are in.
 */
export function defaultFolder(welcomed: boolean, drive: ICloudDrive): string {
  // `Notes` expands a leading "~/" itself.
  const local = `~/${T.folder.path}`;
  if (welcomed) return local;
  return drive.available && drive.path ? drive.path : local;
}

/** Opens the notes folder (Storage's `jot.dir`, else the default one, then remembered) and watches it. */
export async function openFolder(): Promise<Notes | null> {
  const stored = await Storage.getItem(DIR_KEY);
  const dir = stored ?? defaultFolder(!!(await Storage.getItem(WELCOMED_KEY)), Folder.icloud());
  try {
    const n = useFolder(new Notes(dir));
    // Remembered, so the folder stays put when iCloud Drive is turned off or on later.
    if (stored == null) void Storage.setItem(DIR_KEY, dir);
    return n;
  } catch (error) {
    folderError.set(errorMessage(error));
    return null;
  }
}

/** Makes `n` the notes folder: watched, its reminders running; the folder before it lets go of its watchers. */
function useFolder(n: Notes): Notes {
  const before = untracked(notes);
  settleLocks(n);
  known = new Set(n.list().map((m) => m.title));
  createdHere.clear();
  lastWritten.clear();
  gone.clear();
  clearTimeout(trashTimer);
  n.watch(folderChanged);
  watchActivity(n);
  batch(() => {
    notes.set(n);
    folderPath.set(n.dir);
    folderShown.set(Folder.shown(n.dir));
    folderError.set(null);
    opened.set(null);
    if (untracked(stage) === "editor") stage.set("list");
    selected.set(0);
    trashed.set([]);
    renaming.set(null);
  });
  if (before && before !== n) before.dispose();
  restartReminders();
  refresh();
  return n;
}

/**
 * Moves the notes into the folder `dir` (the settings' "Move to iCloud Drive"), never over a note there, then makes
 * it the notes folder (the AI apps follow). The open note's last edits go along. Rejects, the folder unchanged, when
 * the notes cannot be moved; throws when the new folder cannot be opened.
 */
export async function moveNotesTo(dir: string): Promise<MovedNotes> {
  const from = untracked(folderPath);
  if (!from) throw new Error(untracked(folderError) ?? "no notes folder");
  flushEditor?.();
  const moved = await Folder.moveNotes(from, dir);
  changeFolder(dir);
  return moved;
}

/** Moves Jot to the folder at `dir` (the settings' "Change…"): opened, watched, remembered. Throws when it cannot be opened. */
export function changeFolder(dir: string) {
  const n = new Notes(dir);
  useFolder(n);
  void Storage.setItem(DIR_KEY, dir);
  // The AI apps connected to the old folder follow.
  void syncClients(n.dir);
}

/** What fires when to-dos come due (App.tsx's), and the folder's reminders running it. */
let onDue: ((event: DueEvent) => void) | null = null;
let reminders: Reminders | null = null;

/** Fires `listener` at the to-dos' due times, in whichever folder is open (again after the folder changes). */
export function startReminders(listener: (event: DueEvent) => void) {
  onDue = listener;
  restartReminders();
}

function restartReminders() {
  const n = untracked(notes);
  const listener = onDue;
  reminders?.dispose();
  reminders = null;
  if (!n || !listener) return;
  try {
    const next = new Reminders(n);
    next.start(listener);
    reminders = next;
  } catch (error) {
    folderError.set(t("notify.reminders_failed", { error: errorMessage(error) }));
  }
}

/** Whether this is Jot's first run (it then shows itself once, so the user meets it). */
export async function firstRun(): Promise<boolean> {
  if (await Storage.getItem(WELCOMED_KEY)) return false;
  await Storage.setItem(WELCOMED_KEY, "1");
  return true;
}

/** Listeners to what AI apps write to the notes folder on this Mac (the island shows it). */
const activities = new Set<(activity: AgentActivity) => void>();
export function onAgentActivity(listener: (activity: AgentActivity) => void): () => void {
  activities.add(listener);
  return () => activities.delete(listener);
}

/**
 * Follows the activity log `jot-mcp` writes (every write of an AI app's, `ActivityLog`) for the folder `n`: the only
 * word of what an app did, since a note appearing in the folder may come from another Mac through iCloud Drive.
 */
function watchActivity(n: Notes) {
  const log = ActivityLog.path();
  if (!log) return;
  try {
    n.watchActivity(log, (activity) => {
      for (const l of activities) l(activity);
    });
  } catch (error) {
    // Without it the island says nothing of AI apps; the notes work as ever.
    console.warn(`cannot watch the AI apps' activity: ${errorMessage(error)}`);
  }
}

/**
 * Puts back the half of a lock that went missing: the file's locked flag on a note whose frontmatter says locked
 * (synced from another Mac, or cleared by iCloud Drive as it uploaded the note), `locked: true` on a note locked in
 * Finder. Its own writes come back through the watcher with nothing left to do.
 */
function settleLocks(n: Notes) {
  try {
    n.settleLocks();
  } catch {
    // Not now (a file busy, the folder gone): the folder's next change tries again.
  }
}

/**
 * The folder changed on disk: read it again, and drop in the rows of new notes an AI app made (here, or on another Mac
 * and synced). What the island says comes from the activity log instead (`onAgentActivity`).
 */
function folderChanged() {
  const n = notes();
  if (!n) return;
  settleLocks(n);
  const list = n.list();
  const fresh = list.filter((m) => !known.has(m.title) && !createdHere.has(m.title) && m.source !== null);
  known = new Set(list.map((m) => m.title));
  if (fresh.length) {
    if (untracked(stage) === "list" && !untracked(query).trim()) morphNext(T.spring.drop);
    arriving.set(fresh[0].title);
    setTimeout(() => arriving.set(null), 1600);
  }
  revision.update((r) => r + 1);
}

/** Jot changed the folder itself: read it again now, rather than at the watcher's echo. */
export function refresh() {
  revision.update((r) => r + 1);
}

/** Shows the panel: one motion, the glass and its rows together (no capsule step). */
export function summon(start: { query?: string } = {}) {
  if (untracked(stage) !== "hidden") {
    if (start.query !== undefined) setQuery(start.query);
    focusRequest.set({ target: "field" });
    return;
  }
  batch(() => {
    query.set(start.query ?? "");
    selected.set(0);
    opened.set(null);
    notice.set(null);
    startEntrance();
    stage.set("list");
  });
  focusRequest.set({ target: "field" });
}

/** Hides the panel. */
export function dismiss() {
  if (untracked(stage) === "hidden") return;
  stage.set("hidden");
}

/** The summon keys: shows the panel, or hides it when it shows. */
export function toggle() {
  if (untracked(stage) === "hidden") summon();
  else dismiss();
}

/** Escape: from a note back to the list, from the to-do view back to the notes, else hides the panel. */
export function back() {
  const s = untracked(stage);
  if (s === "editor") {
    morphNext(T.spring.open);
    const to = backQuery;
    backQuery = null;
    batch(() => {
      opened.set(null);
      stage.set("list");
      if (to !== null) {
        query.set(to);
        selected.set(0);
      }
    });
    focusRequest.set({ target: "field" });
  } else if (untracked(todoMode)) {
    setQuery("");
  } else {
    dismiss();
  }
}

/** The query changed: a new search, the first row selected; typing over an open note goes back to the list. */
export function setQuery(value: string) {
  const s = untracked(stage);
  backQuery = null;
  if (s === "editor") morphNext(T.spring.open);
  batch(() => {
    query.set(value);
    selected.set(0);
    notice.set(null);
    if (s === "capsule" || s === "editor") {
      opened.set(null);
      stage.set("list");
    }
  });
}

/** The arrow keys: the next or previous row (wrapping); with a note open, that row's note opens. */
/** Bumped by every arrow-key step, so a scrolling list brings the selected row into view (a hover does not scroll). */
export const keySteps = signal(0);

export function move(delta: number) {
  const count = untracked(selectable);
  if (!count) return;
  const s = untracked(stage);
  if (s === "capsule") stage.set("list");
  const next = (untracked(selected) + delta + count) % count;
  selected.set(next);
  keySteps.update((n) => n + 1);
  if (s === "editor") {
    const row = untracked(rows)[next];
    if (row?.kind === "note") open(row.meta.title, { focus: false });
  }
}

/** Return: opens the selected row (a note, today's to-dos, a new note, a to-do's note). */
export function activate(index = untracked(selected)) {
  if (untracked(todoMode)) {
    // A to-do opens its note with the search narrowed to that note, so the
    // sidebar shows where it came from and Escape goes back to the notes.
    const item = untracked(todoItems).find((i) => i.kind === "todo" && i.index === index);
    if (item?.kind !== "todo") return;
    morphNext(T.spring.open);
    const from = untracked(query);
    batch(() => {
      query.set(item.todo.note);
      selected.set(0);
    });
    open(item.todo.note, { line: item.todo.line });
    backQuery = from;
    return;
  }
  const row = untracked(rows)[index];
  if (!row) return;
  selected.set(index);
  if (row.kind === "summary") {
    morphNext(T.spring.expand);
    setQuery(todoKeyword());
    startEntrance();
  } else if (row.kind === "note") open(row.meta.title);
  else create(row.title);
}

/** ⌘↩ in the list: a new note titled as the query (the note of that title when there is one). */
export function createFromQuery() {
  const all = untracked(rows);
  const last = all.length - 1;
  if (last >= 0 && all[last].kind === "create") activate(last);
  else if (all.some((r) => r.kind === "note")) activate(all.findIndex((r) => r.kind === "note"));
}

/** Creates a note titled `title` and opens it with the caret in its body. */
export function create(title: string) {
  const n = untracked(notes);
  if (!n) return;
  try {
    const meta = n.create(title, "");
    gone.delete(meta.title.toLowerCase());
    createdHere.add(meta.title);
    known.add(meta.title);
    lastWritten.set(meta.title, "");
    batch(() => {
      query.set("");
      selected.set(0);
      refresh();
    });
    open(meta.title);
  } catch (error) {
    // A title the folder already has opens that note; one it cannot take says why.
    const code = errorCode(error);
    const existing = code === "ERR_JOT_ALREADY_EXISTS" ? n.read(title) : null;
    if (existing) open(existing.meta.title);
    else if (code === "ERR_JOT_INVALID_TITLE") notice.set(t("note.invalid_title", { title }));
    else notice.set(t("note.create_failed", { title, error: errorMessage(error) }));
  }
}

/** Opens `title` in the editor beside the list, its caret on `line` (or at the end). */
export function open(title: string, options: { line?: number; focus?: boolean } = {}) {
  backQuery = null;
  if (untracked(stage) !== "editor") morphNext(T.spring.open);
  const index = untracked(rows).findIndex((r) => r.kind === "note" && r.meta.title === title);
  batch(() => {
    if (index >= 0 && !untracked(todoMode)) selected.set(index);
    opened.set({ title, line: options.line ?? null, focus: options.focus ?? true, token: ++openings });
    stage.set("editor");
  });
}

/** Saves the editor's text (the editor calls it after a pause in typing). */
export function save(title: string, body: string) {
  const n = untracked(notes);
  if (!n || gone.has(title.toLowerCase())) return;
  lastWritten.set(title, body);
  n.write(title, body);
  refresh();
}

/** From a to-do ticked in the to-do view until its row folds away: its checkbox bursts, a line strikes it through, and
 * after a pause its row slides out while it fades; the fold follows the fade (`TodoRow` runs the rest). */
export function tickFoldAfter(): number {
  const tick = T.timing.tick;
  return tick.strikeAfter + tick.strike + tick.slideAfter + tick.fadeAfter + tick.fade;
}

/** Ticks a to-do in the to-do view: it shows checked and slides out, then its row folds away. A locked note's stays as
 * it is, unticked. */
export function checkTodo(todo: Todo) {
  const n = untracked(notes);
  if (!n) return;
  const key = stamp(todo);
  if (untracked(checking).has(key)) return;
  try {
    n.setTodoDone(todo.note, todo.line, todo.text, true);
  } catch (error) {
    // A locked note keeps its to-dos as they are (the row never shows ticked); one that changed under it (`Changed`)
    // shows as it is now.
    if (errorCode(error) === "ERR_JOT_LOCKED") {
      notice.set(t("lock.todo", { note: todo.note }));
      return;
    }
  }
  batch(() => {
    checking.update((s) => new Set([...s, key]));
    refresh();
  });
  setTimeout(() => {
    // The rows below close the gap as the group's count flips (and its header folds when it empties).
    morphNext(T.spring.collapse);
    checking.update((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }, tickFoldAfter());
}

/** ⌘↩ in the to-do view: ticks the selected to-do. */
export function checkSelected() {
  const item = untracked(todoItems).find((i) => i.kind === "todo" && i.index === untracked(selected));
  if (item?.kind === "todo") checkTodo(item.todo);
}

/** Keeps the selection on a row that exists as the rows change. */
export function clampSelection() {
  const count = selectable();
  if (untracked(selected) >= count) selected.set(Math.max(0, count - 1));
}

/** Moves `title` to the system trash; "Moved to the trash" shows, with the undo key, for a few seconds. */
export function trashNote(title: string) {
  const n = untracked(notes);
  if (!n) return;
  const wasOpen = untracked(stage) === "editor" && untracked(opened)?.title.toLowerCase() === title.toLowerCase();
  // The note's last edits go with it to the trash, and no autosave after brings it back.
  if (wasOpen) flushEditor?.();
  let note: TrashedNote;
  try {
    note = n.trash(title);
  } catch (error) {
    notice.set(
      errorCode(error) === "ERR_JOT_LOCKED"
        ? t("lock.trash", { title, bin: binName() })
        : t("trash.failed", { title, error: errorMessage(error), bin: binName() }),
    );
    return;
  }
  gone.add(note.title.toLowerCase());
  known.delete(note.title);
  lastWritten.delete(note.title);
  morphNext(T.spring.collapse);
  batch(() => {
    if (wasOpen) {
      backQuery = null;
      opened.set(null);
      stage.set("list");
    }
    notice.set(null);
    trashed.update((list) => [...list, note]);
    refresh();
  });
  if (wasOpen) focusRequest.set({ target: "field" });
  restartTrashCountdown();
}

/** ⌘Z (Ctrl+Z) while "Moved to the trash" shows: the last note trashed comes back where it was, selected. */
export function undoTrash() {
  const n = untracked(notes);
  const list = untracked(trashed);
  const note = list[list.length - 1];
  if (!n || !note) return;
  const rest = list.slice(0, -1);
  let meta: NoteMeta;
  try {
    meta = n.restore(note.token);
  } catch (error) {
    // A note took its title meanwhile: this one stays in the trash, where the system's trash still has it.
    batch(() => {
      trashed.set(rest);
      notice.set(
        errorCode(error) === "ERR_JOT_ALREADY_EXISTS"
          ? t("trash.restore_taken", { title: note.title, bin: binName() })
          : t("trash.restore_failed", { title: note.title, error: errorMessage(error) }),
      );
    });
    restartTrashCountdown();
    return;
  }
  gone.delete(meta.title.toLowerCase());
  // Back from the trash is no AI app's arrival, whoever wrote it.
  known.add(meta.title);
  createdHere.add(meta.title);
  morphNext(T.spring.drop);
  batch(() => {
    trashed.set(rest);
    notice.set(null);
    refresh();
  });
  selectNote(meta.title);
  restartTrashCountdown();
}

/** Selects the row of `title`; when the query hides it, the search narrows to it. */
function selectNote(title: string) {
  const find = () => untracked(rows).findIndex((r) => r.kind === "note" && r.meta.title === title);
  let index = find();
  if (index < 0) {
    query.set(title);
    index = find();
  }
  selected.set(Math.max(0, index));
}

/** "Moved to the trash" stays `T.timing.undoFor` after the last change, then the footer and ⌘Z are theirs again. */
function restartTrashCountdown() {
  clearTimeout(trashTimer);
  if (!untracked(trashed).length) {
    trashTimer = undefined;
    return;
  }
  trashCountdown.update((c) => c + 1);
  trashTimer = setTimeout(() => {
    trashTimer = undefined;
    trashed.set([]);
  }, T.timing.undoFor);
}

/** The action panel's "Rename": the row's title becomes a field. */
export function startRename(title: string) {
  notice.set(null);
  renaming.set(title);
}

/** Leaves the title field: Return or leaving it renames the note (`to` trimmed), Escape keeps the old title. */
export function finishRename(to: string | null) {
  const from = untracked(renaming);
  if (from === null) return;
  renaming.set(null);
  const title = to?.trim();
  const n = untracked(notes);
  if (!n || !title || title === from) return;
  const wasOpen = untracked(opened)?.title === from;
  // The editor's pending edits land in the file before it is renamed, not in a new file of the old name.
  if (wasOpen) flushEditor?.();
  let meta: NoteMeta;
  try {
    meta = n.rename(from, title);
  } catch (error) {
    const code = errorCode(error);
    notice.set(
      code === "ERR_JOT_ALREADY_EXISTS"
        ? t("note.rename_taken", { title })
        : code === "ERR_JOT_INVALID_TITLE"
          ? t("note.invalid_title", { title })
          : code === "ERR_JOT_LOCKED"
            ? t("lock.rename", { title: from })
            : t("note.rename_failed", { title: from, error: errorMessage(error) }),
    );
    return;
  }
  // The new name is no AI app's note arriving.
  known.delete(from);
  known.add(meta.title);
  createdHere.add(meta.title);
  const written = lastWritten.get(from);
  lastWritten.delete(from);
  if (written !== undefined) lastWritten.set(meta.title, written);
  batch(() => {
    refresh();
    if (untracked(query).trim()) query.set(meta.title);
    // The open note follows its new name (a new editor on the same text).
    if (wasOpen) opened.set({ title: meta.title, line: null, focus: false, token: ++openings });
  });
  selectNote(meta.title);
}

/** The action panel's "Show in Finder": the note's file, selected in the file manager. */
export function revealNote(title: string) {
  const path = untracked(notes)?.path(title);
  if (path) void Folder.reveal(path).catch((error: unknown) => notice.set(errorMessage(error)));
}

/**
 * Locks the note (`lock`) or unlocks it: the open note's last edits are saved first, so they are in what is locked.
 * Locking makes it read-only, in Jot, in AI apps and for any other program (the file's locked flag). The footer says
 * so for a moment.
 */
export function setLocked(title: string, lock: boolean) {
  const n = untracked(notes);
  if (!n) return;
  if (lock && untracked(opened)?.title.toLowerCase() === title.toLowerCase()) flushEditor?.();
  let meta: NoteMeta;
  try {
    meta = lock ? n.lock(title) : n.unlock(title);
  } catch (error) {
    notice.set(t(lock ? "lock.failed" : "lock.unlock_failed", { title, error: errorMessage(error) }));
    return;
  }
  // The frontmatter Jot wrote is no outside change of the open note.
  const body = n.read(meta.title)?.body;
  if (body !== undefined) lastWritten.set(meta.title, body);
  notice.set(null);
  refresh();
  showFlash(t(lock ? "lock.done" : "lock.undone", { title: meta.title }));
}
