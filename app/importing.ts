// Importing the user's Apple Notes into the notes folder, from Settings › General › Import (the only place that does):
// `AppleNotes.import` reads every note of Notes (macOS asks the user to let Jot control Notes, the first time) and
// writes the ones not imported before; how far it is, then what it did, shows under the button. docs/app.md (Importing
// from Apple Notes).
import { signal, untracked } from "nsh";
import { t } from "nsh/i18n";
import { AppleNotes, type AppleNotesImport, type AppleNotesProgress } from "jot/native";
import { tn } from "./i18n";
import { errorCode, errorMessage, folderPath } from "./store";

/** Privacy & Security › Automation, where the user lets Jot control Notes. */
export const AUTOMATION_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

/** What the last import did, in a line; `failed` tints it, `denied` (Jot may not control Notes) offers the settings. */
export interface ImportReport {
  text: string;
  failed: boolean;
  denied: boolean;
}

/** An import is under way. */
export const importing = signal(false);
/** What the last import did, or why it failed. */
export const importReport = signal<ImportReport | null>(null);
/** How far the import under way is: `null` until Notes says (it may first ask the user to let Jot control Notes). */
export const importProgress = signal<AppleNotesProgress | null>(null);

/** How far an import is, in a line: "Reading Notes…", "Reading Notes… 5/15" (folders), "Writing… 12/53" (notes). */
export function progressText(progress: AppleNotesProgress | null): string {
  if (!progress) return t("settings.import.reading");
  const counts = { done: progress.done, total: progress.total };
  return progress.phase === "writing" ? t("settings.import.writing", counts) : t("settings.import.reading_count", counts);
}

/** What an import did, in one line: "Imported 132 notes · 5 already imported · 3 locked notes skipped". */
export function importedText(done: AppleNotesImport): string {
  const parts = [done.imported ? tn("settings.import.imported", done.imported) : t("settings.import.none")];
  if (done.renamed.length) {
    parts.push(tn("settings.import.renamed", done.renamed.length, { from: done.renamed[0].from, to: done.renamed[0].to }));
  }
  if (done.already) parts.push(tn("settings.import.already", done.already));
  if (done.locked) parts.push(tn("settings.import.locked", done.locked));
  if (done.deleted) parts.push(tn("settings.import.deleted", done.deleted));
  if (done.waiting) parts.push(tn("settings.import.waiting", done.waiting));
  if (done.failed.length) {
    parts.push(tn("settings.import.failed_some", done.failed.length, { title: done.failed[0].title, error: done.failed[0].error }));
  }
  return parts.join(" · ");
}

/**
 * Why an import failed, as the report shows it: not allowed to control Notes (`ERR_JOT_NOT_AUTHORIZED`), Notes too
 * slow to answer (`ERR_JOT_TIMED_OUT`), or the error's words.
 */
export function importFailure(error: unknown): ImportReport {
  const code = errorCode(error);
  if (code === "ERR_JOT_NOT_AUTHORIZED") return { text: t("settings.import.denied"), failed: true, denied: true };
  if (code === "ERR_JOT_TIMED_OUT") return { text: t("settings.import.timed_out"), failed: true, denied: false };
  return { text: t("settings.import.failed", { error: errorMessage(error) }), failed: true, denied: false };
}

/**
 * Imports every note of Apple Notes not imported before into the notes folder; one import at a time. The folder is
 * the one open when it starts: Settings keeps it from changing meanwhile (Change… and Move to iCloud Drive are off).
 */
export async function importAppleNotes() {
  const dir = untracked(folderPath);
  if (!dir || untracked(importing)) return;
  importing.set(true);
  importReport.set(null);
  importProgress.set(null);
  try {
    const done = await AppleNotes.import(dir, (progress) => importProgress.set(progress));
    importReport.set({ text: importedText(done), failed: done.failed.length > 0, denied: false });
  } catch (error) {
    importReport.set(importFailure(error));
  } finally {
    importing.set(false);
    importProgress.set(null);
  }
}
