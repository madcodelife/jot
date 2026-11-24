// The open note: its title, who wrote it and when, and its Markdown in
// NSH's editor. Typing saves itself after a short pause; task lines get
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
import { cleanup, computed, createAnimatedValue, effect, Notifications, signal, Text, token, untracked, View } from "nsh";
import { Button, Editor, type EditorDecoration, type EditorPosition, type EditorRef, type EditorSelection } from "nsh/base";
import { t } from "nsh/i18n";
import { When, type Conflict } from "jot/native";
import { caretOnTodo, openDuePicker, setEditorDue } from "../app/due";
import { whenOptions } from "../app/settings";
import { allNotes, errorMessage, lastWritten, notes, now, opened, refresh, revision, save, setEditorFlush, showFlash } from "../app/store";
import { taskLine, toggledLine, withDue } from "../app/tasks";
import { age, parseDue } from "../app/time";
import { cancelVoice, joinSpoken, listening, listeningLang, speechAvailable, startVoice, stopVoice, voiceError } from "../app/voice";
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
/** A Markdown heading line (ATX: up to three spaces, one to six `#`, then a space or the end). */
const HEADING = /^ {0,3}#{1,6}(?=[ \t]|$)/;

/** A line of `text`, by index. */
const lineAt = (text: string, line: number) => text.split("\n")[line] ?? "";

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
  /** A dictation is typing: its interim words are not saved, the final ones are. */
  let dictating = false;
  let editor: EditorRef | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let phraseTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;

  const meta = computed(() => allNotes().find((m) => m.title === title) ?? first?.meta ?? null);

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const body = untracked(text);
    if (body === onDisk || untracked(downloading)) return;
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
    if (/⏰ \d{4}-\d\d-\d\d \d\d:\d\d/.test(content)) return phrase.set(null);
    const match = When.parse(content, whenOptions());
    phrase.set(match ? { line, start: match.start, end: match.end } : null);
  }

  /** Writes the line's time phrase as an absolute time (` ⏰ 2026-11-14 09:00`), once the caret has left it. */
  function normalize(line: number) {
    const before = lineAt(untracked(text), line);
    if (!before) return;
    const after = When.normalizeLine(before, whenOptions());
    if (after === null || after === before || !editor) return;
    editor.edit([{ range: { start: { line, column: 0 }, end: { line, column: before.length } }, text: after }]);
    if (after.includes("⏰")) askToNotify();
  }

  function toggleLine(line: number) {
    const content = lineAt(untracked(text), line);
    const task = taskLine(content);
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
    if (!editor) return false;
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
    const task = taskLine(content);
    if (!task || task.done || !editor) return false;
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
    if (!editor) return;
    if (taskLine(content) === null || content !== before) {
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
    const task = taskLine(lineAt(text(), caretLine()));
    caretOnTodo.set(!!task && !task.done);
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
    const line = selections[0]?.head.line ?? 0;
    if (line === lastLine) return;
    const left = lastLine;
    lastLine = line;
    caretLine.set(line);
    phrase.set(null);
    normalize(left);
  }

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
        editor.edit([{ range: { start: at, end: at }, text: tail }]);
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

  // Headings in the theme's heading colour (the editor's own Markdown colours are the same in every theme); task
  // lines, reminders and done stamps, styled where they are; the live phrase as a chip.
  const decorations = computed<EditorDecoration[]>(() => {
    const out: EditorDecoration[] = [];
    const lines = text().split("\n");
    const at = now();
    lines.forEach((content, line) => {
      const heading = HEADING.exec(content);
      if (heading) out.push({ range: { start: { line, column: heading.index }, end: { line, column: content.length } }, class: "text-heading" });
      const task = taskLine(content);
      if (!task) return;
      const span = (start: number, end: number) => ({ start: { line, column: start }, end: { line, column: end } });
      out.push({ range: span(task.box.start, task.box.end), class: task.done ? "text-paper-muted font-semibold" : "text-accent-ink font-semibold" });
      if (task.done) out.push({ range: span(task.rest.start, task.stamp?.start ?? task.rest.end), class: "text-paper-muted line-through" });
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
    return out;
  });

  return (
    <View testID="paper" class={`flex-1 bg-paper ${fade()}`} style={{ borderRadius: T.radius.paper, borderCurve: "continuous", overflow: "hidden" }}>
      <View style={{ paddingTop: 30, paddingLeft: PAPER_X, paddingRight: speechAvailable() ? PAPER_X + 30 : PAPER_X }}>
        <Text testID="paper-title" class="font-bold text-paper-fg" style={{ numberOfLines: 2, fontSize: T.type.title, letterSpacing: -0.6, lineHeight: 33 }}>
          {title}
        </Text>
        <View class="flex-row items-center" style={{ gap: 6, marginTop: 9, marginBottom: 14 }}>
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
          <Text testID="paper-meta" class="text-paper-muted" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
            {`${meta() ? age(meta()!.modified, now()) : t("time.just_now")} · ${title}.md`}
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
          <If when={speechAvailable()}>
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
        readOnly={downloading()}
        placeholder={downloading() ? "" : t("paper.placeholder")}
        accessibilityLabel={t("paper.label", { title })}
        autoFocus={props.focus}
        lineNumbers={false}
        folding={false}
        activeLine={false}
        indentGuides={false}
        softWrap
        scrollBeyondLastLine={false}
        fontFamily="system-ui"
        fontSize={T.type.body}
        lineHeight={T.type.bodyLine}
        decorations={decorations()}
        classes={{ content: "text-paper-fg", caret: "bg-primary", selection: "bg-primary/25", placeholder: "text-paper-muted" }}
        // The text area's padding is the paper's margins: the body starts where the title does and keeps the same room on the right.
        styles={{ content: { paddingLeft: PAPER_X, paddingRight: PAPER_X, paddingTop: 2, paddingBottom: PAPER_BOTTOM } }}
        onChange={({ value }) => changed(value)}
        onSelectionChange={({ selections }) => selectionChanged(selections)}
        onBlur={() => {
          normalize(untracked(caretLine));
          saveNow();
        }}
        onTextPress={({ position, clicks }) => {
          const task = taskLine(lineAt(untracked(text), position.line));
          if (clicks !== 1 || !task) return;
          if (position.column >= task.box.start && position.column <= task.box.end) toggleLine(position.line);
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
    <Button testID={`paper-versions-${id}`} class="px-2 py-1" onPress={() => props.onSettle(id)}>
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
      style={{ gap: 4, marginBottom: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: T.radius.chip, borderCurve: "continuous" }}
    >
      <Text class="text-paper-fg" style={{ fontSize: 12.5, lineHeight: 17 }}>
        {props.more > 0
          ? t("paper.versions_more", { device: device(), when: age(props.version.modified, now()), more: props.more })
          : t("paper.versions", { device: device(), when: age(props.version.modified, now()) })}
      </Text>
      <View class="flex-row items-center" style={{ gap: 4, marginLeft: -8, flexWrap: "wrap" }}>
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
