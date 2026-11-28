// A note's version history in the panel ("Version History…"): its earlier
// texts, newest first, the selected one shown read-only beside the list, and
// putting one back. The store keeps the versions (outside the notes folder,
// before each change: docs/storage.md); this is the view's state and what it
// does. Restoring writes the version as the note's text, its text now kept
// first; in the open note it is one edit of the editor, which ⌘Z takes back.
import { batch, computed, signal, untracked } from "nsh";
import { t } from "nsh/i18n";
import type { NoteVersion } from "jot/native";
import { tn } from "./i18n";
import { versionTime } from "./time";
import { errorCode, errorMessage, flushOpenNote, focusRequest, history, isLocked, notes, now, opened, refresh, revision, showFlash, stage } from "./store";

/** What the open note's editor does for the history (Paper sets it while a note is open). */
export interface EditorHistory {
  /** The open note's title. */
  title: string;
  /** Replaces the whole text with `body` as one edit undo takes back, and saves it; false when the note is read-only. */
  restore(body: string): boolean;
  /** Gives the note's text the keys again. */
  focus(): void;
}

let editorHistory: EditorHistory | null = null;

/** The editor's side of the history, while a note is open; `null` as it closes. */
export function setEditorHistory(handler: EditorHistory | null) {
  editorHistory = handler;
}

/** The history shows (it takes the panel's body, a note's width). Tracked. */
export const historyShown = () => history() !== null;

/** The note's versions, newest first, as read when the history opened (and after a restore). */
export const versions = signal<NoteVersion[]>([]);
/** The selected version's place in `versions`. */
export const versionSelected = signal(0);
/** Bumped by an arrow-key step: the list keeps the selected row in view. */
export const versionSteps = signal(0);

/** Why the last restore failed, shown in the history (its footer is the panel's, hidden meanwhile); cleared by the
 * next selection. */
export const restoreError = signal<string | null>(null);

/** The selected version. Tracked. */
export const selectedVersion = computed(() => versions()[versionSelected()] ?? null);

/** The note's text now, for the hints of what differs. Tracked. */
const current = computed(() => {
  const h = history();
  // A change from outside reads it again.
  revision();
  return h ? (untracked(notes)?.read(h.title)?.body ?? "") : "";
});

/** Opens the history of `title` in the panel, the newest version selected. The open note's edits are saved first, so
 * its text now is what the versions are compared with. */
export function openHistory(title: string) {
  const n = untracked(notes);
  if (!n) return;
  if (untracked(opened)?.title === title) flushOpenNote();
  let list: NoteVersion[];
  try {
    list = n.versions(title);
  } catch {
    list = [];
  }
  batch(() => {
    versions.set(list);
    versionSelected.set(0);
    restoreError.set(null);
    history.set({ title });
  });
  // The arrows, Return and Escape go through the field while it shows (the open note's text hides under it).
  focusRequest.set({ target: "field" });
}

/** Escape: back where it opened, the open note's text with the keys again. */
export function closeHistory() {
  if (!untracked(history)) return;
  history.set(null);
  if (untracked(stage) === "editor") editorHistory?.focus();
  else focusRequest.set({ target: "field" });
}

/** Selects the version at `index` (a press on its row). */
export function selectVersion(index: number) {
  batch(() => {
    versionSelected.set(index);
    restoreError.set(null);
  });
}

/** ↑↓ in the history: the next or the previous version, stopping at either end. */
export function moveVersion(delta: number) {
  const count = untracked(versions).length;
  if (!count) return;
  selectVersion(Math.max(0, Math.min(count - 1, untracked(versionSelected) + delta)));
  versionSteps.update((s) => s + 1);
}

/** Why the selected version cannot be restored now, or null: a locked note stays as it is. Tracked. */
export const restoreBlocked = computed(() => {
  const h = history();
  if (!h || !selectedVersion()) return null;
  return isLocked(h.title) ? t("history.locked") : null;
});

/**
 * Return, or "Restore This Version": the selected version becomes the note's text, its text now kept in its history
 * first. In the open note it is an edit of its editor (⌘Z takes it back), else a write; the history closes either way
 * and says what it did.
 */
export function restoreSelected() {
  const h = untracked(history);
  const version = untracked(selectedVersion);
  const n = untracked(notes);
  if (!h || !version || !n || untracked(restoreBlocked)) return;
  const { title } = h;
  const time = versionTime(version.modified, untracked(now));
  try {
    const editor = untracked(stage) === "editor" && untracked(opened)?.title === title ? editorHistory : null;
    if (editor?.title === title) {
      flushOpenNote();
      n.saveVersion(title);
      if (!editor.restore(version.body)) n.restoreVersion(title, version.id);
    } else {
      n.restoreVersion(title, version.id);
    }
  } catch (error) {
    restoreError.set(errorCode(error) === "ERR_JOT_LOCKED" ? t("history.locked") : t("history.restore_failed", { title, error: errorMessage(error) }));
    return;
  }
  refresh();
  closeHistory();
  showFlash(t("history.restored", { time }));
}

/**
 * What differs between a version and the note's text now, on one line: "Same as now", else the first line the version
 * has that the note no longer has (its words), else how many lines the note has gained since, else that only the
 * spacing differs.
 */
export function versionHint(body: string, now: string): string {
  if (body === now) return t("history.same");
  const count = (text: string) => {
    const lines = new Map<string, number>();
    for (const line of text.split("\n")) {
      const key = line.trim();
      if (key) lines.set(key, (lines.get(key) ?? 0) + 1);
    }
    return lines;
  };
  const left = count(now);
  for (const line of body.split("\n")) {
    const key = line.trim();
    if (!key) continue;
    const n = left.get(key) ?? 0;
    if (n === 0) return key.replace(/\s+/g, " ");
    left.set(key, n - 1);
  }
  const gained = [...left.values()].reduce((sum, n) => sum + n, 0);
  return gained ? tn("history.fewer", gained) : t("history.spacing");
}

/** The hint of `version` against the note's text now. Tracked. */
export const hintOf = (version: NoteVersion) => versionHint(version.body, current());
