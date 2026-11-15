// What can be done with the row in focus, defined once: the action panel
// (⌘K, and a right click on a row) lists these, the footer names the one
// Return runs, and their own keys run them with the panel closed.
import { Clipboard, computed, signal, untracked } from "nsh";
import { t } from "nsh/i18n";
import type { Todo } from "jot/native";
import { keyCaps, T } from "../ui/tokens";
import {
  activate,
  binName,
  desktopOs,
  checkTodo,
  errorMessage,
  focusRequest,
  notes,
  notice,
  opened,
  revealNote,
  rows,
  selected,
  showFlash,
  stage,
  startRename,
  todoItems,
  todoMode,
  renaming,
  trashNote,
} from "./store";

/** What the actions are about: a note, the "new note" row, today's to-dos row, or a to-do of the to-do view. */
export type ActionTarget =
  | { kind: "note"; title: string; index: number | null }
  | { kind: "create"; title: string; index: number }
  | { kind: "summary"; index: number }
  | { kind: "todo"; todo: Todo; index: number };

/** One action: its words, its keys (shown as keycaps), and what it does. */
export interface Action {
  id: string;
  label: string;
  /** The keystroke that runs it (`keymap`'s), `"enter"` for Return. */
  shortcut: string;
  keys: readonly string[];
  /** Destroys something: drawn in the danger color, after a separator. */
  destructive?: boolean;
  run: () => void;
}

/** The row the actions are about: the open note, else the selected row (a to-do in the to-do view). Tracked. */
export function targetInFocus(): ActionTarget | null {
  if (renaming() !== null) return null;
  const s = stage();
  if (s === "editor") {
    const title = opened()?.title;
    return title ? { kind: "note", title, index: null } : null;
  }
  if (s !== "list") return null;
  const index = selected();
  if (todoMode()) {
    const item = todoItems().find((i) => i.kind === "todo" && i.index === index);
    return item?.kind === "todo" ? { kind: "todo", todo: item.todo, index } : null;
  }
  const row = rows()[index];
  if (!row) return null;
  if (row.kind === "note") return { kind: "note", title: row.meta.title, index };
  if (row.kind === "create") return { kind: "create", title: row.title, index };
  return { kind: "summary", index };
}

const action = (id: string, label: string, shortcut: string, run: () => void, destructive = false): Action => ({
  id,
  label,
  shortcut,
  keys: keyCaps(shortcut),
  destructive,
  run,
});

/** The actions of `target`, in the panel's order; the one on Return first. No to-do, "today" or "new" row can be trashed. */
export function actionsFor(target: ActionTarget): Action[] {
  switch (target.kind) {
    case "note": {
      const { title } = target;
      return [
        // With the note open, "open" puts the caret back in it.
        action("open", t("actions.open"), "enter", () =>
          target.index === null ? focusRequest.set({ target: "editor" }) : activate(target.index),
        ),
        action("reveal", t(`actions.reveal.${desktopOs}`), T.keys.reveal, () => revealNote(title)),
        action("rename", t("actions.rename"), T.keys.rename, () => startRename(title)),
        action("copy-title", t("actions.copy_title"), T.keys.copyTitle, () => copy(title)),
        action("copy-body", t("actions.copy_body"), T.keys.copyBody, () => copy(untracked(notes)?.read(title)?.body ?? "")),
        action("trash", t("actions.trash", { bin: binName() }), T.keys.trashShortcut, () => trashNote(title), true),
      ];
    }
    case "create":
      return [action("create", t("actions.create"), "enter", () => activate(target.index))];
    case "summary":
      return [action("todos", t("actions.todos"), "enter", () => activate(target.index))];
    case "todo":
      return [
        action("open-note", t("actions.open_note"), "enter", () => activate(target.index)),
        action("tick", t("actions.tick"), "mod+enter", () => checkTodo(target.todo)),
      ];
  }
}

/** The action Return runs on the row in focus (the footer names it). */
export const primaryAction = computed(() => {
  const target = targetInFocus();
  return target ? actionsFor(target)[0] : null;
});

/** Runs the action of the row in focus bound to `shortcut` (an action's own key, the panel closed or open). */
export function runShortcut(shortcut: string) {
  const target = untracked(targetInFocus);
  const found = target ? actionsFor(target).find((a) => a.shortcut === shortcut) : undefined;
  if (!found) return;
  closeActions();
  found.run();
}

/** The keys actions bind directly (Return and ⌘↩ are the panel's own). */
export const actionShortcuts = () => [T.keys.reveal, T.keys.rename, T.keys.copyTitle, T.keys.copyBody, T.keys.trashShortcut];

function copy(text: string) {
  Clipboard.writeText(text).then(
    () => showFlash(t("actions.copied")),
    (error: unknown) => notice.set(errorMessage(error)),
  );
}

/** The action panel: open on a target (⌘K, a right click), its filter and its selected item. */
export const actionsTarget = signal<ActionTarget | null>(null);
export const actionQuery = signal("");
export const actionSelected = signal(0);

/** Where the keyboard focus goes back to as the action panel closes: the note's text when it had it. */
export const actionsReturn = signal<"field" | "editor">("field");

/** Opens the action panel on the row in focus, or on `target` (a right-clicked row, which becomes the selection). */
export function openActions(target: ActionTarget | null = untracked(targetInFocus), returnTo: "field" | "editor" = "field") {
  if (!target) return;
  actionsReturn.set(returnTo);
  if (target.index !== null && untracked(stage) !== "editor") selected.set(target.index);
  actionQuery.set("");
  actionSelected.set(0);
  actionsTarget.set(target);
}

export function closeActions() {
  actionsTarget.set(null);
}

/** ⌘K: opens the panel, or closes it when it shows. */
export function toggleActions(returnTo: "field" | "editor" = "field") {
  if (untracked(actionsTarget)) closeActions();
  else openActions(untracked(targetInFocus), returnTo);
}

/** The panel's items: the target's actions that match the filter (every word, in any case). */
export function filteredActions(target: ActionTarget, query: string): Action[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return actionsFor(target).filter((a) => words.every((w) => a.label.toLowerCase().includes(w) || a.id.includes(w)));
}

/** Runs one of the panel's items: the panel closes first, so the action's own focus and motion follow. */
export function runAction(item: Action) {
  closeActions();
  item.run();
}
