// The open note: its title, who wrote it and when, and its Markdown in
// NSH's editor, previewed live as Typora does (app/markdown.ts): the syntax
// hides where the caret is not, and shows where it is; headings are large,
// code is monospaced. Typing saves itself after a short pause; task lines get
// their boxes, due times and done stamps styled, and the box ticks with a
// click or ⌘↩; a time phrase being typed ("明天 9 点") lights up as a chip
// and becomes an absolute time when the caret leaves the line. Changes made
// elsewhere (an AI app appending to the note) come in without moving the caret.
// Dictation (⌥ held, or the microphone at the top right) types at the caret:
// the words still being recognized show faint, and turn to ink when final.
// Pressing a time chip (or ⇧⌘D on a to-do line) opens the reminder time
// picker over it; the time it picks is one edit, which undo takes back.
// A note iCloud Drive has not downloaded yet shows read-only, empty, saying
// so, and fills in when it lands; one iCloud kept two versions of (changed
// on two devices at once) shows a bar to choose: this Mac's, the other, or
// both (the other as a note of its own).
// A locked note is read-only: the header says "Locked" with a padlock, and a
// click there unlocks it; nothing edits it (typing, ticks, times, dictation).
import { cleanup, computed, createAnimatedValue, effect, keymap, Notifications, signal, Text, token, untracked, View } from "nsh";
import { Button, Editor, type EditorDecoration, type EditorPosition, type EditorRef, type EditorSelection } from "nsh/base";
import { t } from "nsh/i18n";
import { When, type Conflict } from "jot/native";
import { caretOnTodo, openDuePicker, setEditorDue } from "../due";
import { codeBlocks, continuation, fenceMark, fencedLines, isQuote, lineMarks, type Mark, type MarkKind } from "../markdown";
import { whenOptions } from "../settings";
import { allNotes, errorMessage, lastWritten, notes, now, opened, refresh, revision, save, setEditorFlush, setLocked, showFlash } from "../store";
import { taskLine, toggledLine, withDue } from "../tasks";
import { age, parseDue } from "../time";
import { cancelVoice, joinSpoken, listening, listeningLang, speechAvailable, startVoice, stopVoice, voiceError } from "../voice";
import { Icon } from "./icons";
import { fadeTo } from "./motion";
import { fade } from "./themes";
import { T } from "./tokens";
import { Breathing, LanguageTag, MicButton } from "./Voice";

/** What the panel's keys ask of the open note (⌘↩ ticks the caret's task). */
interface PaperActions {
  toggleTaskAtCaret(): void;
  dictate(options: { byHold?: boolean }): boolean;
}

let current: PaperActions | null = null;

/** ⌘↩ with a note open: ticks or unticks the task under the caret. Returns whether a note was open. */
export function toggleTaskAtCaret(): boolean {
  if (!current) return false;
  current.toggleTaskAtCaret();
  return true;
}

/** Holding ⌥ with the note's text focused: dictates at its caret. Returns whether it started. */
export function dictateIntoNote(options: { byHold?: boolean } = {}): boolean {
  return current?.dictate(options) ?? false;
}

/** The note `opened` names; a new opening makes a new editor (its own undo history and caret). */
export function Paper() {
  const openings = computed(() => {
    const o = opened();
    return o ? [o] : [];
  });
  return (
    <Each of={openings()} key={(o) => o.token}>
      {(o) => <NotePaper title={o().title} line={o().line} focus={o().focus} />}
    </Each>
  );
}

/** The paper's margins (the design's 30 / 37 points): the title and the body share the side ones. */
const PAPER_X = 37;
const PAPER_BOTTOM = 30;
/** Room the title keeps on its right for what sits at the paper's top right: the microphone and "Saved", or "Listening…" with its language. */
const STATUS_ROOM = { saved: 80, savedMic: 108, listening: 168 };
/** How the editor draws each kind of Markdown mark (app/markdown.ts): the syntax muted (where it shows), the words in their colour and weight. */
const MARK_CLASS: Record<MarkKind, string> = {
  syntax: "text-paper-muted",
  heading: "text-heading font-bold",
  link: "text-accent-ink",
  code: "bg-paper-fg/7",
  strong: "font-bold",
  em: "italic",
  strike: "line-through",
  // A to-do's box is drawn by its label; its `[ ]`, shown, is styled with the to-do (`task.box` below).
  box: "",
};

/** The monospaced font of a note's code (NSH reads `ui-monospace` as the system's). */
const CODE_FONT = "ui-monospace";

/** How a label in place of a mark looks: a to-do's box drawn, a bullet's `•` muted, a fence's language small and muted; hidden syntax, nothing. */
function labelLook(m: Mark): Pick<EditorDecoration, "labelClass" | "labelStyle"> {
  if (m.kind === "box") {
    const box = { width: 15, height: 15, borderRadius: 4, borderCurve: "continuous", marginRight: 1, alignItems: "center", justifyContent: "center" } as const;
    return m.done
      ? { labelClass: "bg-paper-muted text-paper text-[11px] font-bold", labelStyle: box }
      : { labelClass: "border-accent-ink", labelStyle: { ...box, borderWidth: 1.5 } };
  }
  // A fence's language, small; a bullet's `•`, muted.
  if (m.kind === "syntax" && m.label) return m.label === "•" ? { labelClass: "text-paper-muted" } : { labelClass: `text-paper-muted text-[${T.type.meta}px]` };
  return {};
}

/** Selected text: ink, with no fill of its own over the selection's. */
const SELECTED = "text-paper-fg bg-transparent";

/** A line of `text`, by index. */
const lineAt = (text: string, line: number) => text.split("\n")[line] ?? "";

/** The to-do line `line` of `text` is, unless it is in fenced code: there it is code, as the store reads it too. */
function taskAt(text: string, line: number) {
  const lines = text.split("\n");
  return fencedLines(lines)[line] ? null : taskLine(lines[line] ?? "");
}

/** Whether line `line` of `text` is in fenced code (its fences too). */
const inCode = (text: string, line: number) => fencedLines(text.split("\n"))[line] ?? false;

/** The position just past the text's end. */
function endOf(text: string) {
  const lines = text.split("\n");
  return { line: lines.length - 1, column: lines[lines.length - 1].length };
}

/** `a` comes before `b`. */
const before = (a: EditorPosition, b: EditorPosition) => a.line < b.line || (a.line === b.line && a.column <= b.column);

/** The text between two positions. */
function between(text: string, from: EditorPosition, to: EditorPosition): string {
  const lines = text.split("\n");
  if (from.line === to.line) return (lines[from.line] ?? "").slice(from.column, to.column);
  const out = [(lines[from.line] ?? "").slice(from.column), ...lines.slice(from.line + 1, to.line), (lines[to.line] ?? "").slice(0, to.column)];
  return out.join("\n");
}

/** Where `inserted` ends when it starts at `at`. */
function after(at: EditorPosition, inserted: string): EditorPosition {
  const lines = inserted.split("\n");
  return lines.length === 1 ? { line: at.line, column: at.column + inserted.length } : { line: at.line + lines.length - 1, column: lines[lines.length - 1].length };
}

/** Asks for the permission to notify once, when the first reminder is written. */
let askedToNotify = false;
function askToNotify() {
  if (askedToNotify) return;
  askedToNotify = true;
  void Notifications.permission().then((state) => {
    if (state === "default") void Notifications.requestPermission();
  });
}

function NotePaper(props: { title: string; line: number | null; focus: boolean }) {
  const title = props.title;
  const first = untracked(notes)?.read(title) ?? null;
  /** Its text is not on this Mac yet (iCloud Drive is downloading it): the editor waits, read-only. */
  const downloading = signal(first?.meta.downloading ?? false);
  /** The other versions iCloud Drive kept of it, newest first: the bar offers the first. */
  const versions = signal<Conflict[]>([]);
  /** The editor's text, as it last reported it. */
  const text = signal(first?.body ?? "");
  /** The text as the file has it (what Jot wrote last, or what came from outside). */
  let onDisk = text();
  /** The caret's line, and the line it was on before. */
  const caretLine = signal(props.line ?? 0);
  /** A time phrase on the caret's line, shown as a chip after a pause in typing. */
  const phrase = signal<{ line: number; start: number; end: number } | null>(null);
  /** A notice over the note's foot: text was added to its end from outside, or it changed in a way Jot could not merge. */
  const notice = signal<{ kind: "append" | "conflict"; text: string } | null>(null);
  const savedOpacity = createAnimatedValue(0);
  /** The words of a dictation still being recognized: drawn faint. */
  const interim = signal<{ line: number; start: number; end: number } | null>(null);
  /** The primary selection, as the editor last reported it. */
  let selection: EditorSelection | null = null;
  /** The caret, while there is one and nothing is selected (Return goes on with a list from it). */
  const caret = signal<EditorPosition | null>(null);
  /** What is selected, by range (start before end): the text there is drawn in ink. */
  const selected = signal<{ start: EditorPosition; end: EditorPosition }[]>([]);
  /** Every caret and selection, by range (start before end; a caret's is empty): the preview shows the syntax there. */
  const touching = signal<{ start: EditorPosition; end: EditorPosition }[]>([]);
  /** The editor has the keyboard focus: its ⌘↩ and Return are Jot's then. */
  const focused = signal(false);
  /** A dictation is typing: its interim words are not saved, the final ones are. */
  let dictating = false;
  let editor: EditorRef | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let phraseTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  const meta = computed(() => allNotes().find((m) => m.title === title) ?? first?.meta ?? null);
  /** Locked (in Jot, in Finder, on another Mac): read-only, the header says so. */
  const locked = () => meta()?.locked ?? false;
  /** Nothing may change the text: not downloaded yet, or locked. */
  const readOnly = () => downloading() || locked();

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const body = untracked(text);
    if (body === onDisk || untracked(readOnly)) return;
    try {
      save(title, body);
      onDisk = body;
      fadeTo(savedOpacity, 1, 160);
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => fadeTo(savedOpacity, 0, 300), T.timing.savedFor);
    } catch (error) {
      showNotice("conflict", t("paper.save_failed", { error: errorMessage(error) }));
    }
  }

  function showNotice(kind: "append" | "conflict", message: string) {
    notice.set({ kind, text: message });
    clearTimeout(noticeTimer);
    if (kind === "append") noticeTimer = setTimeout(() => notice.set(null), T.timing.noticeFor);
  }

  function changed(value: string) {
    text.set(value);
    clearTimeout(saveTimer);
    if (!dictating) saveTimer = setTimeout(saveNow, T.timing.saveAfter);
    // The live chip waits for a pause, so it does not flicker under typing.
    phrase.set(null);
    clearTimeout(phraseTimer);
    phraseTimer = setTimeout(findPhrase, T.timing.chipAfter);
  }

  function findPhrase() {
    const line = untracked(caretLine);
    const content = lineAt(untracked(text), line);
    if (/⏰ \d{4}-\d\d-\d\d \d\d:\d\d/.test(content) || inCode(untracked(text), line)) return phrase.set(null);
    const match = When.parse(content, whenOptions());
    phrase.set(match ? { line, start: match.start, end: match.end } : null);
  }

  /** Writes the line's time phrase as an absolute time (` ⏰ 2026-11-14 09:00`), once the caret has left it. */
  function normalize(line: number) {
    if (untracked(readOnly)) return;
    const before = lineAt(untracked(text), line);
    if (!before || inCode(untracked(text), line)) return;
    const after = When.normalizeLine(before, whenOptions());
    if (after === null || after === before || !editor) return;
    editor.edit([{ range: { start: { line, column: 0 }, end: { line, column: before.length } }, text: after }]);
    if (after.includes("⏰")) askToNotify();
  }

  function toggleLine(line: number) {
    if (untracked(readOnly)) return;
    const content = lineAt(untracked(text), line);
    const task = taskAt(untracked(text), line);
    if (!task || !editor) return;
    const next = toggledLine(content, !task.done, new Date(untracked(now)));
    editor.edit([{ range: { start: { line, column: 0 }, end: { line, column: content.length } }, text: next }]);
  }

  /**
   * Dictates at the caret (over the selection, which comes back on Escape):
   * each result replaces the words the last one typed, faint until the final
   * one, which is saved. A space keeps two Latin words apart; CJK takes none.
   */
  function dictate(options: { byHold?: boolean }): boolean {
    if (!editor || untracked(readOnly)) return false;
    const body = untracked(text);
    const sel = selection ?? { anchor: endOf(body), head: endOf(body) };
    const [from, to] = before(sel.anchor, sel.head) ? [sel.anchor, sel.head] : [sel.head, sel.anchor];
    const replaced = between(body, from, to);
    const prev = (lineAt(body, from.line)[from.column - 1] ?? "").trim();
    const next = (lineAt(body, to.line)[to.column] ?? "").trim();
    let end = to;
    const put = (words: string, faint: boolean) => {
      if (!editor) return;
      let typed = words;
      if (words) {
        typed = joinSpoken(prev, words).slice(prev.length);
        if (next) typed = joinSpoken(typed, next).slice(0, -next.length);
      }
      editor.edit([{ range: { start: from, end }, text: typed }]);
      end = after(from, typed);
      interim.set(faint && typed ? { line: from.line, start: from.column, end: end.column } : null);
    };
    const finish = (words: string) => {
      dictating = false;
      interim.set(null);
      put(words || replaced, false);
      editor?.setSelections([{ anchor: end, head: end }]);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, T.timing.saveAfter);
    };
    dictating = true;
    const started = startVoice(
      "editor",
      {
        update: (words) => put(words, true),
        finish,
        fail: (error, words) => {
          finish(words);
          showNotice("conflict", voiceError(error));
        },
        cancel: () => finish(""),
      },
      options,
    );
    if (!started) dictating = false;
    else editor.focus();
    return started;
  }

  /**
   * Opens the reminder time picker on the to-do of `line`, against its time chip (or the line's end when it has
   * none, where a new one goes). False when the line is no open to-do.
   */
  function pickDueAt(line: number): boolean {
    const content = lineAt(untracked(text), line);
    const task = taskAt(untracked(text), line);
    if (!task || task.done || !editor || untracked(readOnly)) return false;
    const column = task.due ? task.due.start : content.length;
    const end = task.due ? task.due.end : content.length;
    const due = task.due ? task.due.at.replace(" ", "T") : null;
    const target = { kind: "editor" as const, line, text: content };
    void editor
      .rangeBounds({ start: { line, column }, end: { line, column: end } })
      .then((boxes) => openDuePicker(target, due, boxes[0]?.pageBounds ?? null))
      .catch(() => openDuePicker(target, due, null));
    return true;
  }

  /** Writes the picked time on `line`, if it still reads `before`: only the part that changes, so a caret elsewhere on the line stays where it was. */
  function writeDue(line: number, before: string, due: Date | null) {
    const content = lineAt(untracked(text), line);
    if (!editor || untracked(readOnly)) return;
    if (taskAt(untracked(text), line) === null || content !== before) {
      showNotice("conflict", t("due.changed"));
      return;
    }
    const next = withDue(content, due);
    if (next === content) return;
    let from = 0;
    while (from < content.length && from < next.length && content[from] === next[from]) from++;
    let back = 0;
    while (back < content.length - from && back < next.length - from && content[content.length - 1 - back] === next[next.length - 1 - back]) back++;
    editor.edit([
      { range: { start: { line, column: from }, end: { line, column: content.length - back } }, text: next.slice(from, next.length - back) },
    ]);
    if (due) askToNotify();
  }

  const actions: PaperActions = { toggleTaskAtCaret: () => toggleLine(untracked(caretLine)), dictate };
  current = actions;
  // Before the note goes to the trash or takes a new name, what was typed is saved.
  setEditorFlush(saveNow);
  const dueSide = { apply: writeDue, openAtCaret: () => pickDueAt(untracked(caretLine)), focus: () => editor?.focus() };
  setEditorDue(dueSide);
  // Whether the caret is on an open to-do: the action panel offers "Reminder Time…" then.
  effect(() => {
    const task = taskAt(text(), caretLine());
    caretOnTodo.set(!!task && !task.done && !readOnly());
  });
  cleanup(() => {
    if (current === actions) {
      current = null;
      setEditorFlush(null);
      setEditorDue(null);
      caretOnTodo.set(false);
    }
    // The note closes while dictating into it: the words go with it.
    cancelVoice("editor");
    // Leaving the note (Escape, another note): what was typed is saved now.
    saveNow();
    clearTimeout(phraseTimer);
    clearTimeout(noticeTimer);
    clearTimeout(savedTimer);
  });

  // A to-do opened from the to-do view: the caret goes to the end of its line.
  effect(() => {
    untracked(() => {
      if (editor && props.line !== null) placeCaret(editor, props.line, text());
    });
    // Return in the search field opens the note: the caret moves here once the field's submit is done
    // (`autoFocus` alone loses to the field, which still has the keys while Return is handled).
    if (props.focus) setTimeout(() => editor?.focus(), 0);
  });

  // The caret moved to another line: the line it left gets its absolute time.
  let lastLine = untracked(caretLine);
  function selectionChanged(selections: EditorSelection[]) {
    selection = selections[selections.length - 1] ?? null;
    const only = selections.length === 1 ? selections[0] : null;
    const ranges = selections.map((s) => (before(s.anchor, s.head) ? { start: s.anchor, end: s.head } : { start: s.head, end: s.anchor }));
    touching.set(ranges);
    selected.set(ranges.filter((r) => r.start.line !== r.end.line || r.start.column !== r.end.column));
    caret.set(only && only.anchor.line === only.head.line && only.anchor.column === only.head.column ? only.head : null);
    const line = selections[0]?.head.line ?? 0;
    if (line === lastLine) return;
    const left = lastLine;
    lastLine = line;
    caretLine.set(line);
    phrase.set(null);
    normalize(left);
  }

  /**
   * What Return does at the caret on a list item, a to-do or a quote line outside fenced code (`continuation`): the
   * next item, or the list's end on an empty one. `null` elsewhere, with a selection or several carets: a line break.
   */
  function itemReturn(body: string, at: EditorPosition | null) {
    if (!at || untracked(readOnly)) return null;
    const lines = body.split("\n");
    const line = lines[at.line];
    if (line === undefined || fencedLines(lines)[at.line]) return null;
    return continuation(line, at.column);
  }

  /** Return on an item line: its continuation as one edit, which one undo takes back; elsewhere the editor's break. */
  function pressReturn() {
    if (!editor) return;
    const at = untracked(caret);
    const next = dictating ? null : itemReturn(untracked(text), at);
    if (!at || !next) {
      editor.run("newline");
      return;
    }
    const end = lineAt(untracked(text), at.line).length;
    editor.edit([{ range: { start: { line: at.line, column: 0 }, end: { line: at.line, column: end } }, text: next.text }]);
    const to = { line: at.line + next.caret.line, column: next.caret.column };
    editor.setSelections([{ anchor: to, head: to }]);
  }

  // The editor binds ⌘↩ (a line below) and Return itself; while it has the focus, Jot's come first (`overFocused`).
  // ⌘↩ ticks the caret's to-do, and does nothing on another line. Return is Jot's only while the caret is on an item
  // line, so a line break elsewhere stays the editor's own; ⇧↩ is always a plain break. An input method composing
  // (pinyin) keeps Return: NSH gives no binding a key then, and Return commits the letters.
  const onItem = computed(() => focused() && !readOnly() && itemReturn(text(), caret()) !== null);
  effect(() => {
    if (!focused()) return;
    return keymap.bind("mod+enter", () => toggleLine(untracked(caretLine)), { when: "always", overFocused: true });
  });
  effect(() => {
    if (!onItem()) return;
    return keymap.bind("enter", pressReturn, { when: "always", repeat: true, overFocused: true });
  });

  /** Reads the versions iCloud Drive kept (none for most notes, at a glance). */
  function readVersions() {
    try {
      versions.set(untracked(notes)?.conflicts(title) ?? []);
    } catch {
      versions.set([]);
    }
  }

  /** The bar's choice for the version shown: this Mac's, the other one, or both. The note's pending edits are saved first. */
  function settle(version: Conflict, choice: "mine" | "theirs" | "both") {
    const n = untracked(notes);
    if (!n) return;
    saveNow();
    const device = version.device ?? t("paper.other_device");
    try {
      const done = n.resolveConflict(title, version.id, choice, t("paper.copy_title", { title, device }));
      if (choice === "theirs") {
        const body = n.read(title)?.body ?? "";
        lastWritten.set(title, body);
        onDisk = body;
        editor?.setValue(body);
      }
      if (done.copy) showFlash(t("paper.kept_both", { title: done.copy.title }));
    } catch (error) {
      showNotice("conflict", t("paper.resolve_failed", { error: errorMessage(error) }));
    }
    readVersions();
    refresh();
  }

  // The file changed outside the editor (the folder's watcher bumps `revision`).
  effect(() => {
    revision();
    untracked(() => {
      const note = notes()?.read(title);
      if (note?.meta.downloading) {
        downloading.set(true);
        return;
      }
      if (note && downloading()) {
        // It landed: the editor takes its text, as if just opened.
        downloading.set(false);
        onDisk = note.body;
        lastWritten.set(title, note.body);
        editor?.setValue(note.body);
        readVersions();
        return;
      }
      readVersions();
      const disk = note?.body;
      if (disk === undefined || disk === onDisk || disk === text() || disk === lastWritten.get(title)) return;
      const mine = text();
      const dirty = mine !== onDisk;
      if (disk.startsWith(onDisk) && editor) {
        // Added at the end (an AI app's `append`): put the tail after the caret's text, which stays.
        const tail = disk.slice(onDisk.length);
        const at = endOf(mine);
        const kept = selection;
        editor.edit([{ range: { start: at, end: at }, text: tail }]);
        // A caret at the very end would be pushed past the new text: it stays where it was.
        if (kept) editor.setSelections([kept]);
        onDisk = disk;
        if (dirty) {
          // What was typed and the tail are saved together.
          clearTimeout(saveTimer);
          saveTimer = setTimeout(saveNow, T.timing.saveAfter);
        }
        showNotice("append", t("paper.appended"));
      } else if (!dirty && editor) {
        editor.setValue(disk);
        onDisk = disk;
      } else {
        showNotice("conflict", t("paper.conflict"));
      }
    });
  });

  // The live preview (app/markdown.ts): the Markdown's syntax hidden where no caret or selection is (all of it while
  // the editor has no focus), shown muted where one is; headings large and in the theme's heading colour (the editor's
  // own Markdown colours are the same in every theme), links, code and emphasis set apart; fenced code the
  // highlighter's, in the code font on a tinted block. Task lines, reminders and done stamps, styled where they are;
  // the live phrase as a chip.
  const decorations = computed<EditorDecoration[]>(() => {
    const out: EditorDecoration[] = [];
    const lines = text().split("\n");
    const fenced = fencedLines(lines);
    const at = now();
    const carets = focused() ? touching() : [];
    /** What of `line` (`length` long) the carets and selections cover, by column. */
    const touchedOn = (line: number, length: number) =>
      carets
        .filter((r) => r.start.line <= line && line <= r.end.line)
        .map((r) => ({ start: r.start.line === line ? r.start.column : 0, end: r.end.line === line ? r.end.column : length }));
    for (const block of codeBlocks(lines)) {
      const last = lines[block.end].length;
      out.push({
        range: { start: { line: block.start, column: 0 }, end: { line: block.end, column: last } },
        lineClass: "bg-paper-fg/5",
        fontFamily: CODE_FONT,
        fontSize: T.type.code,
      });
      // Its fences show while a caret or a selection is in the block; else the opening one is its language's name.
      const shown = carets.some((r) => r.start.line <= block.end && r.end.line >= block.start);
      const fences = block.closed && block.end > block.start ? [block.start, block.end] : [block.start];
      for (const line of fences) {
        const m = fenceMark(lines[line], shown);
        if (m.end === m.start) continue;
        const range = { start: { line, column: m.start }, end: { line, column: m.end } };
        out.push({ range, class: MARK_CLASS.syntax, ...(m.label !== undefined ? { label: m.label, ...labelLook(m) } : {}) });
      }
    }
    lines.forEach((content, line) => {
      const span = (start: number, end: number) => ({ start: { line, column: start }, end: { line, column: end } });
      if (!fenced[line]) {
        const marks = lineMarks(content, touchedOn(line, content.length));
        const heading = marks.some((m) => m.level !== undefined);
        for (const m of marks) {
          const d: EditorDecoration = { range: span(m.start, m.end) };
          if (MARK_CLASS[m.kind]) d.class = MARK_CLASS[m.kind];
          if (m.level !== undefined && m.level <= 3) d.fontSize = T.type.headings[m.level - 1];
          if (m.kind === "code") {
            d.fontFamily = CODE_FONT;
            // In a heading, the heading's size.
            if (!heading) d.fontSize = T.type.code;
          }
          if (m.label !== undefined) Object.assign(d, { label: m.label }, labelLook(m));
          if (d.class || d.fontSize || d.fontFamily || d.label !== undefined) out.push(d);
        }
        if (isQuote(content)) out.push({ range: span(0, content.length), lineClass: "bg-paper-fg/5" });
      }
      const task = fenced[line] ? null : taskLine(content);
      if (!task) return;
      out.push({ range: span(task.box.start, task.box.end), class: task.done ? "text-paper-muted font-semibold" : "text-accent-ink font-semibold" });
      // The line through the words only, not the space before the stamp.
      const struck = content.slice(0, task.stamp?.start ?? task.rest.end).trimEnd().length;
      if (task.done && struck > task.rest.start) out.push({ range: span(task.rest.start, struck), class: "text-paper-muted line-through" });
      if (task.due) {
        const late = !task.done && (parseDue(task.due.at)?.getTime() ?? Infinity) < at;
        out.push({
          range: span(task.due.start, task.due.end),
          class: task.done ? "text-paper-muted" : late ? "bg-late/13 text-late font-semibold" : "bg-due/13 text-due font-semibold",
        });
      }
      if (task.stamp) out.push({ range: span(task.stamp.start, task.stamp.end), class: "text-paper-muted" });
    });
    const words = interim();
    if (words) {
      out.push({ range: { start: { line: words.line, column: words.start }, end: { line: words.line, column: words.end } }, class: "text-paper-muted" });
    }
    const p = phrase();
    if (p) {
      out.push({
        range: { start: { line: p.line, column: p.start }, end: { line: p.line, column: p.end } },
        class: "bg-due/13 text-due font-semibold",
      });
    }
    // Selected text is ink on the selection's own fill, without the chips' and code's: the colours above sit at
    // AA on the paper with no room for a fill under them (app/tests/settings.test.tsx checks the ink). The editor styles a
    // stretch by the decoration starting last there, so each one in the selection gets its part inked again.
    const styled = out.slice();
    for (const range of selected()) {
      out.push({ range, class: SELECTED });
      for (const d of styled) {
        const start = before(d.range.start, range.start) ? range.start : d.range.start;
        const end = before(d.range.end, range.end) ? d.range.end : range.end;
        if (!before(end, start)) out.push({ range: { start, end }, class: SELECTED });
      }
    }
    return out;
  });

  return (
    <View testID="paper" class={`flex-1 bg-paper ${fade()}`} style={{ borderRadius: T.radius.paper, borderCurve: "continuous", overflow: "hidden" }}>
      <View style={{ paddingTop: 30, paddingLeft: PAPER_X, paddingRight: PAPER_X }}>
        <Text
          testID="paper-title"
          role="header"
          class="font-bold text-paper-fg"
          // Clear of the microphone and "Saved" (or "Listening…") at the top right, which a long title would run under.
          style={{
            numberOfLines: 2,
            fontSize: T.type.title,
            letterSpacing: -0.6,
            lineHeight: 33,
            marginRight: (listening() === "editor" ? STATUS_ROOM.listening : speechAvailable() ? STATUS_ROOM.savedMic : STATUS_ROOM.saved) - PAPER_X,
          }}
        >
          {title}
        </Text>
        <View testID="paper-meta" class="flex-row items-center" style={{ gap: 5, marginTop: 9, marginBottom: 14 }}>
          <If when={locked()}>
            <Button
              testID="paper-locked"
              accessibilityLabel={t("lock.unlock_label", { title })}
              class="flex-row items-center bg-paper-fg/7 hover:bg-paper-fg/12 active:opacity-70"
              style={{ gap: 4, paddingHorizontal: 7, paddingVertical: 2, marginLeft: -7, borderRadius: T.radius.chip, borderCurve: "continuous" }}
              onPress={() => setLocked(title, false)}
            >
              <Icon name="lock" size={12} tint={token("paper-fg")} />
              <Text class="font-semibold text-paper-fg" style={{ fontSize: T.type.meta }}>
                {t("lock.locked")}
              </Text>
            </Button>
            <Text class="text-paper-muted" style={{ fontSize: T.type.meta }}>
              ·
            </Text>
          </If>
          <If when={meta()?.source}>
            <View class="flex-row items-center" style={{ gap: 4 }}>
              <Icon name="spark" size={12} tint={token("agent")} />
              <Text testID="paper-agent" class="font-semibold text-agent-ink" style={{ fontSize: T.type.meta }}>
                {t("paper.by_agent", { agent: meta()?.source ?? "" })}
              </Text>
            </View>
            <Text class="text-paper-muted" style={{ fontSize: T.type.meta }}>
              ·
            </Text>
          </If>
          {/* When, then the file: each "·" with the same room around it. */}
          <Text class="text-paper-muted" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 0 }}>
            {meta() ? age(meta()!.modified, now()) : t("time.just_now")}
          </Text>
          <Text class="text-paper-muted" style={{ fontSize: T.type.meta }}>
            ·
          </Text>
          <Text class="text-paper-muted" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
            {`${title}.md`}
          </Text>
        </View>
        <If when={downloading()}>
          <View testID="paper-downloading" class="flex-row items-center" style={{ gap: 6, marginBottom: 10 }}>
            <Icon name="cloud" size={14} tint={token("paper-muted")} />
            <Text class="text-paper-muted" style={{ fontSize: T.type.meta }}>
              {t("paper.downloading")}
            </Text>
          </View>
        </If>
        <If when={downloading() ? undefined : versions()[0]}>
          {(version) => <VersionsBar version={version()} more={versions().length - 1} onSettle={(choice) => settle(version(), choice)} />}
        </If>
        <View class="absolute flex-row items-center" style={{ right: speechAvailable() ? 14 : 22, top: speechAvailable() ? 15 : 22, gap: 8 }}>
          <If
            when={listening() === "editor"}
            else={
              <View class="flex-row items-center" style={{ gap: 5, opacity: savedOpacity }}>
                <View class="bg-ok" style={{ width: 7, height: 7, borderRadius: 3.5 }} />
                <Text class="text-paper-muted" style={{ fontSize: T.type.meta }}>
                  {t("paper.saved")}
                </Text>
              </View>
            }
          >
            <View testID="paper-listening" class="flex-row items-center" style={{ gap: 4 }}>
              <Breathing size={14} color={token("primary")} />
              <Text class="text-paper-muted" style={{ fontSize: T.type.meta }}>
                {t("voice.listening")}
              </Text>
              <If when={listeningLang()}>
                {(lang) => (
                  <View style={{ marginLeft: 4 }}>
                    <LanguageTag testID="paper-lang" lang={lang()} surface="paper" />
                  </View>
                )}
              </If>
            </View>
          </If>
          <If when={speechAvailable() && !readOnly()}>
            <MicButton
              testID="paper-mic"
              size={28}
              active={listening() === "editor"}
              label={listening() === "editor" ? t("voice.stop") : t("voice.start_note")}
              tint={token("paper-muted")}
              hoverClass="hover:bg-paper-fg/7"
              onPress={() => {
                if (untracked(listening) === "editor") stopVoice();
                else dictate({});
              }}
            />
          </If>
        </View>
      </View>
      <Editor
        testID="editor"
        ref={(r) => {
          editor = r;
        }}
        class="flex-1"
        defaultValue={text()}
        language="markdown"
        readOnly={readOnly()}
        placeholder={readOnly() ? "" : t("paper.placeholder")}
        accessibilityLabel={t("paper.label", { title })}
        autoFocus={props.focus}
        lineNumbers={false}
        folding={false}
        activeLine={false}
        indentGuides={false}
        // Prose, not code: a bracket or a quote typed is one character.
        autoClose={false}
        softWrap
        scrollBeyondLastLine={false}
        fontFamily="system-ui"
        fontSize={T.type.body}
        lineHeight={T.type.bodyLine}
        decorations={decorations()}
        // No caret while the note is read-only (not downloaded yet, or locked): there is nothing to type into.
        classes={{ content: "text-paper-fg", caret: readOnly() ? "bg-transparent" : "bg-primary", selection: "bg-paper-fg/14", placeholder: "text-paper-muted" }}
        // The text area's padding is the paper's margins: the body starts where the title does and keeps the same room on the right.
        styles={{ content: { paddingLeft: PAPER_X, paddingRight: PAPER_X, paddingTop: 2, paddingBottom: PAPER_BOTTOM } }}
        onChange={({ value }) => changed(value)}
        onSelectionChange={({ selections }) => selectionChanged(selections)}
        onFocus={() => focused.set(true)}
        onBlur={() => {
          focused.set(false);
          normalize(untracked(caretLine));
          saveNow();
        }}
        onTextPress={({ position, clicks }) => {
          const task = taskAt(untracked(text), position.line);
          if (clicks !== 1 || !task) return;
          // The box: its `[ ]`, or the drawn box standing for `- [ ]` (a press on a label lands at either end).
          if (position.column >= task.box.start - 2 && position.column <= task.box.end) {
            toggleLine(position.line);
            // The caret goes before the words, off the box, which then stays drawn.
            const words = { line: position.line, column: task.rest.start };
            if (!untracked(readOnly)) editor?.setSelections([{ anchor: words, head: words }]);
          }
          // The time chip: the picker opens over it.
          else if (task.due && !task.done && position.column >= task.due.start && position.column <= task.due.end) pickDueAt(position.line);
        }}
      />
      <If when={notice()}>
        {(n) => (
          <View class="absolute inset-x-0 items-center" style={{ bottom: 14, pointerEvents: "box-none" }}>
            <View
              testID="paper-notice"
              role="alert"
              class="flex-row items-center bg-glass-fill border border-glass-line"
              style={{ gap: 8, paddingVertical: 6, paddingLeft: 14, paddingRight: 6, borderRadius: T.radius.chip, borderCurve: "continuous" }}
            >
              <Icon name="spark" size={12} tint={token("agent")} />
              <Text class="text-glass-fg" style={{ fontSize: 12.5 }}>
                {n().text}
              </Text>
              <Button
                class="px-2 py-1"
                onPress={() => {
                  if (n().kind === "append") editor?.scrollToLine(endOf(untracked(text)).line);
                  else {
                    const disk = untracked(notes)?.read(title)?.body;
                    if (disk !== undefined && editor) {
                      editor.setValue(disk);
                      onDisk = disk;
                    }
                  }
                  notice.set(null);
                }}
              >
                <Text class="font-semibold text-accent-ink" style={{ fontSize: 12.5 }}>
                  {n().kind === "append" ? t("paper.view_end") : t("paper.use_theirs")}
                </Text>
              </Button>
            </View>
          </View>
        )}
      </If>
    </View>
  );
}

/** iCloud Drive kept another version of the note (changed on two devices at once): which to keep. */
function VersionsBar(props: { version: Conflict; more: number; onSettle: (choice: "mine" | "theirs" | "both") => void }) {
  const device = () => props.version.device ?? t("paper.other_device");
  const choice = (id: "mine" | "theirs" | "both", label: string) => (
    // On the paper's own colour, so the accent reads at AA over the bar's tint in every theme.
    <Button
      testID={`paper-versions-${id}`}
      class="bg-paper border border-late/25 active:opacity-70"
      style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: T.radius.action, borderCurve: "continuous" }}
      onPress={() => props.onSettle(id)}
    >
      <Text class="font-semibold text-accent-ink" style={{ fontSize: 12.5 }}>
        {label}
      </Text>
    </Button>
  );
  return (
    <View
      testID="paper-versions"
      role="alert"
      class="bg-late/10 border border-late/25"
      // A card of a few lines: a row's corners, not a pill's (the chip's radius rounded it into a stadium).
      style={{ gap: 8, marginBottom: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: T.radius.row, borderCurve: "continuous" }}
    >
      <Text class="text-paper-fg" style={{ fontSize: 12.5, lineHeight: 17 }}>
        {props.more > 0
          ? t("paper.versions_more", { device: device(), when: age(props.version.modified, now()), more: props.more })
          : t("paper.versions", { device: device(), when: age(props.version.modified, now()) })}
      </Text>
      <View class="flex-row items-center" style={{ gap: 6, flexWrap: "wrap" }}>
        {choice("mine", t("paper.keep_mine"))}
        {choice("theirs", t("paper.keep_theirs"))}
        {choice("both", t("paper.keep_both"))}
      </View>
    </View>
  );
}

/** Puts the caret at the end of `line` and scrolls to it. */
function placeCaret(editor: EditorRef, line: number, text: string) {
  const column = lineAt(text, line).length;
  editor.setSelections([{ anchor: { line, column }, head: { line, column } }]);
  editor.scrollToLine(line);
}
