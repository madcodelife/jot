// The reminder time picker's state: which to-do it is changing (a line of
// the open note, or a row of the to-do view), where it is anchored, the
// quick choices it offers, and writing the time it picks: through the
// editor for the open note (one edit undo takes back), through the store
// for the to-do view.
import { batch, signal, untracked, type Bounds, type ViewRef } from "nsh";
import { t } from "nsh/i18n";
import type { Todo } from "jot/native";
import { morphNext, settleMs } from "./ui/motion";
import { T } from "./ui/tokens";
import { errorCode, errorMessage, focusRequest, keySteps, notes, notice, refresh, selected, todoItems } from "./store";
import { dueValue, parseDue } from "./time";

/** The to-do whose time is picked: a line of the open note (its text when the picker opened), or a to-do of the to-do view. */
export type DueTarget = { kind: "editor"; line: number; text: string } | { kind: "todo"; todo: Todo };

/** The picker, while it shows: its to-do, the time it has (`"2026-11-14T09:00"`), and what it is placed against. */
export interface DuePickerState {
  target: DueTarget;
  due: string | null;
  /** The time chip's (or the caret's) box in the panel's window, or the to-do row's label; `null`: the panel's foot. */
  anchor: ViewRef | Bounds | null;
}

export const duePicker = signal<DuePickerState | null>(null);

/** The open note's caret is on an open to-do: the action panel offers "Reminder Time…" for it. */
export const caretOnTodo = signal(false);

/** What the open note's editor does for the picker (Paper sets it while a note is open). */
export interface EditorDue {
  /** Writes `due` on `line` if its text is still `text`, as one edit undo takes back; the caret stays. */
  apply(line: number, text: string, due: Date | null): void;
  /** Opens the picker on the caret's to-do; false when the caret is on no open to-do. */
  openAtCaret(): boolean;
  /** Gives the note's text the keys again. */
  focus(): void;
}

let editorDue: EditorDue | null = null;

/** The editor's side of the picker, while a note is open; `null` as it closes. */
export function setEditorDue(handler: EditorDue | null) {
  editorDue = handler;
}

/** Opens the picker on `target`, placed against `anchor`. */
export function openDuePicker(target: DueTarget, due: string | null, anchor: DuePickerState["anchor"]) {
  duePicker.set({ target, due, anchor });
}

/** The to-do view's due labels (each row's, empty without a time), by the row's key: where the picker opens for a row. */
const todoAnchors = new Map<string, ViewRef>();

/** The to-do view's row `key` has its label at `ref`. */
export function setTodoAnchor(key: string, ref: ViewRef) {
  todoAnchors.set(key, ref);
}

/** The row's label `ref` goes (a row of the same key made meanwhile keeps its own). */
export function clearTodoAnchor(key: string, ref: ViewRef | undefined) {
  if (todoAnchors.get(key) === ref) todoAnchors.delete(key);
}

/** The picker on a to-do of the to-do view, under its due label. */
export function openTodoDue(todo: Todo) {
  openDuePicker({ kind: "todo", todo }, todo.due ?? null, todoAnchors.get(`${todo.note}\u0000${todo.line}`) ?? null);
}

/** ⇧⌘D, or the action panel's "Reminder Time…" in the note: the picker on the caret's to-do. */
export function openDueAtCaret(): boolean {
  return editorDue?.openAtCaret() ?? false;
}

/** Closes the picker; the keys go back where they were (the note's text, else the search field's list). */
export function closeDuePicker() {
  const state = untracked(duePicker);
  if (!state) return;
  duePicker.set(null);
  if (state.target.kind === "editor") editorDue?.focus();
  else focusRequest.set({ target: "field" });
}

/** Writes `due` (or no time) on the picker's to-do and closes the picker. */
export function pickDue(due: Date | null) {
  const state = untracked(duePicker);
  if (!state) return;
  closeDuePicker();
  const { target } = state;
  if (target.kind === "editor") {
    editorDue?.apply(target.line, target.text, due);
    return;
  }
  writeTodoDue(target.todo, due);
}

/** The to-do view's row (its key) moving to its new group after its time changed: lifted while it moves, `landed`
 * once it is there (its lifted look then fades), until that has faded. */
export const regrouping = signal<{ key: string; landed: boolean } | null>(null);
let landing: ReturnType<typeof setTimeout>[] = [];

/** Sets (or removes) the time of a to-do of the to-do view through the store; its row follows to its new group, selected. */
export function writeTodoDue(todo: Todo, due: Date | null) {
  const n = untracked(notes);
  if (!n) return;
  const was = parseDue(todo.due);
  if ((was?.getTime() ?? null) === (due?.getTime() ?? null)) return;
  try {
    n.setTodoDue(todo.note, todo.line, todo.text, due ? dueValue(due) : null);
  } catch (error) {
    notice.set(errorCode(error) === "ERR_JOT_CHANGED" ? t("due.changed") : t("due.failed", { error: errorMessage(error) }));
    refresh();
    return;
  }
  // The row moves to its new group, lifted over the rows it passes until it lands; the selection goes with it, kept
  // in view.
  const key = `${todo.note}\u0000${todo.line}`;
  morphNext(T.spring.regroup);
  batch(() => {
    notice.set(null);
    regrouping.set({ key, landed: false });
    refresh();
  });
  for (const timer of landing) clearTimeout(timer);
  const lands = settleMs(T.spring.regroup);
  landing = [
    setTimeout(() => regrouping.set({ key, landed: true }), lands),
    setTimeout(() => regrouping.set(null), lands + T.timing.liftOut),
  ];
  const item = untracked(todoItems).find((i) => i.kind === "todo" && i.key === key);
  if (item?.kind === "todo") {
    selected.set(item.index);
    keySteps.update((k) => k + 1);
  }
}
