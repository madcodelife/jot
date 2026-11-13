// Jot's state: the notes folder, the panel's stage (hidden, the capsule, the
// list, a note open), the query and the selection, and what the user does
// with them. Components read these signals; only the functions below write
// them, so every change goes through one place.
import { batch, computed, reduceMotion, signal, Storage, untracked } from "nsh";
import { Notes, Summon, type NoteMeta, type Todo } from "jot/native";
import { morphNext } from "../ui/motion";
import { T } from "../ui/tokens";
import { groupOf, parseDue, type TodoGroup } from "./time";

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
/** A row that just arrived from Claude: it glows once. */
export const arriving = signal<string | null>(null);
/** A short message in the footer (a title the folder cannot take). */
export const notice = signal<string | null>(null);
/** Asks the panel to focus the search field or the editor (a new object each time). */
export const focusRequest = signal<{ target: "field" | "editor" }>({ target: "field" }, { equals: false });
/** Bumped as the list opens: rows made then drop in one after another. */
export const listEntrance = signal(0);
/** To-dos being ticked in the to-do view: they stay, checked, until their row folds away. */
export const checking = signal<ReadonlySet<string>>(new Set());

/** Notes Jot itself created this run: not Claude's arrivals. */
const createdHere = new Set<string>();
/** What Jot last wrote per note: the folder's echo of its own saves is not an outside change. */
export const lastWritten = new Map<string, string>();
/** The notes as last seen, to tell new ones apart. */
let known = new Set<string>();
let openings = 0;
/** The query Escape goes back to from a note opened out of the to-do view. */
let backQuery: string | null = null;

/** The `code` of an error `jot/native` threw (`ERR_JOT_*`, or Node's errno codes for I/O). */
export const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;

/** An error's message, for a notice. */
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** "待办" or "/todo": the to-do view. */
export const isTodoQuery = (q: string) => /^(待办|\/todo)$/i.test(q.trim());
export const todoMode = computed(() => isTodoQuery(query()));

/** Every note, newest first. */
export const allNotes = computed<NoteMeta[]>(() => {
  revision();
  return notes()?.list() ?? [];
});

/** Every to-do of every note. */
export const allTodos = computed<Todo[]>(() => {
  revision();
  return notes()?.todos() ?? [];
});

/** The list's rows for the query: today's to-dos first while it is empty, a "new note" row last while no note has that title. */
export const rows = computed<Row[]>(() => {
  const n = notes();
  const q = query().trim();
  revision();
  if (!n || isTodoQuery(q)) return [];
  if (!q) {
    const recent = allNotes().slice(0, LIMIT);
    const head: Row[] = recent.length || allTodos().length ? [{ kind: "summary" }] : [];
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

/** Opens the notes folder (Storage's `jot.dir`, else ~/Documents/Jot) and watches it. */
export async function openFolder(): Promise<Notes | null> {
  let dir = await Storage.getItem(DIR_KEY);
  try {
    // `Notes` expands a leading "~/" itself.
    dir ??= `~/${T.folder.path}`;
    const n = new Notes(dir);
    known = new Set(n.list().map((m) => m.title));
    n.watch(folderChanged);
    batch(() => {
      notes.set(n);
      folderError.set(null);
    });
    return n;
  } catch (error) {
    folderError.set(errorMessage(error));
    return null;
  }
}

/** Whether this is Jot's first run (it then shows itself once, so the user meets it). */
export async function firstRun(): Promise<boolean> {
  if (await Storage.getItem(WELCOMED_KEY)) return false;
  await Storage.setItem(WELCOMED_KEY, "1");
  return true;
}

/** Listeners to notes Claude wrote (the island shows them). */
const arrivals = new Set<(title: string) => void>();
export function onClaudeNote(listener: (title: string) => void): () => void {
  arrivals.add(listener);
  return () => arrivals.delete(listener);
}

/** The folder changed on disk: read it again, and tell apart the notes Claude just wrote. */
function folderChanged() {
  const n = notes();
  if (!n) return;
  const list = n.list();
  const fresh = list.filter((m) => !known.has(m.title) && !createdHere.has(m.title) && m.source === "claude");
  known = new Set(list.map((m) => m.title));
  if (fresh.length) {
    if (untracked(stage) === "list" && !untracked(query).trim()) morphNext(T.spring.drop);
    arriving.set(fresh[0].title);
    setTimeout(() => arriving.set(null), 1600);
  }
  revision.update((r) => r + 1);
  for (const m of fresh) for (const l of arrivals) l(m.title);
}

/** Jot changed the folder itself: read it again now, rather than at the watcher's echo. */
export function refresh() {
  revision.update((r) => r + 1);
}

/** Shows the panel: the capsule first, which grows into the list. */
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
    stage.set("capsule");
  });
  setTimeout(
    () => {
      if (untracked(stage) !== "capsule") return;
      morphNext(T.spring.expand);
      batch(() => {
        listEntrance.update((n) => n + 1);
        stage.set("list");
      });
    },
    reduceMotion() ? 0 : T.timing.expandAfter,
  );
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
export function move(delta: number) {
  const count = untracked(selectable);
  if (!count) return;
  const s = untracked(stage);
  if (s === "capsule") stage.set("list");
  const next = (untracked(selected) + delta + count) % count;
  selected.set(next);
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
    setQuery("待办");
    listEntrance.update((n) => n + 1);
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
    else if (code === "ERR_JOT_INVALID_TITLE") notice.set(`「${title}」不能作标题`);
    else notice.set(`没能新建「${title}」：${errorMessage(error)}`);
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
  if (!n) return;
  lastWritten.set(title, body);
  n.write(title, body);
  refresh();
}

/** Ticks a to-do in the to-do view: it shows checked, then its row folds away. */
export function checkTodo(todo: Todo) {
  const n = untracked(notes);
  if (!n) return;
  const key = stamp(todo);
  if (untracked(checking).has(key)) return;
  checking.update((s) => new Set([...s, key]));
  try {
    n.setTodoDone(todo.note, todo.line, todo.text, true);
  } catch {
    // The line changed under it (`Changed`): the fresh list shows it as it is now.
  }
  refresh();
  setTimeout(
    () => {
      morphNext(T.spring.collapse);
      checking.update((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    },
    reduceMotion() ? 0 : 280,
  );
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
