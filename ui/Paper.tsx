// The open note: its title, who wrote it and when, and its Markdown in
// NSH's editor. Typing saves itself after a short pause; task lines get
// their boxes, due times and done stamps styled, and the box ticks with a
// click or ⌘↩; a time phrase being typed ("明天 9 点") lights up as a chip
// and becomes an absolute time when the caret leaves the line. Changes made
// elsewhere (Claude appending to the note) come in without moving the caret.
import { cleanup, computed, createAnimatedValue, effect, Notifications, signal, Text, token, untracked, View } from "nsh";
import { Button, Editor, type EditorDecoration, type EditorRef, type EditorSelection } from "nsh/base";
import { t } from "nsh/i18n";
import { When } from "jot/native";
import { whenOptions } from "../app/settings";
import { allNotes, errorMessage, lastWritten, notes, now, opened, revision, save } from "../app/store";
import { taskLine, toggledLine } from "../app/tasks";
import { age, parseDue } from "../app/time";
import { Icon } from "./icons";
import { fadeTo } from "./motion";
import { fade } from "./themes";
import { T } from "./tokens";

/** What the panel's keys ask of the open note (⌘↩ ticks the caret's task). */
interface PaperActions {
  toggleTaskAtCaret(): void;
}

let current: PaperActions | null = null;

/** ⌘↩ with a note open: ticks or unticks the task under the caret. Returns whether a note was open. */
export function toggleTaskAtCaret(): boolean {
  if (!current) return false;
  current.toggleTaskAtCaret();
  return true;
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

/** A line of `text`, by index. */
const lineAt = (text: string, line: number) => text.split("\n")[line] ?? "";

/** The position just past the text's end. */
function endOf(text: string) {
  const lines = text.split("\n");
  return { line: lines.length - 1, column: lines[lines.length - 1].length };
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
  /** The editor's text, as it last reported it. */
  const text = signal(first?.body ?? "");
  /** The text as the file has it (what Jot wrote last, or what came from outside). */
  let onDisk = text();
  /** The caret's line, and the line it was on before. */
  const caretLine = signal(props.line ?? 0);
  /** A time phrase on the caret's line, shown as a chip after a pause in typing. */
  const phrase = signal<{ line: number; start: number; end: number } | null>(null);
  /** A notice over the note's foot: Claude added to it, or it changed in a way Jot could not merge. */
  const notice = signal<{ kind: "append" | "conflict"; text: string } | null>(null);
  const savedOpacity = createAnimatedValue(0);
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
    if (body === onDisk) return;
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
    saveTimer = setTimeout(saveNow, T.timing.saveAfter);
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

  const actions: PaperActions = { toggleTaskAtCaret: () => toggleLine(untracked(caretLine)) };
  current = actions;
  cleanup(() => {
    if (current === actions) current = null;
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
    const line = selections[0]?.head.line ?? 0;
    if (line === lastLine) return;
    const left = lastLine;
    lastLine = line;
    caretLine.set(line);
    phrase.set(null);
    normalize(left);
  }

  // The file changed outside the editor (the folder's watcher bumps `revision`).
  effect(() => {
    revision();
    untracked(() => {
      const disk = notes()?.read(title)?.body;
      if (disk === undefined || disk === onDisk || disk === text() || disk === lastWritten.get(title)) return;
      const mine = text();
      const dirty = mine !== onDisk;
      if (disk.startsWith(onDisk) && editor) {
        // Added at the end (Claude's `append`): put the tail after the caret's text, which stays.
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

  // Task lines, reminders and done stamps, styled where they are; the live phrase as a chip.
  const decorations = computed<EditorDecoration[]>(() => {
    const out: EditorDecoration[] = [];
    const lines = text().split("\n");
    const at = now();
    lines.forEach((content, line) => {
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
      <View style={{ paddingTop: 30, paddingHorizontal: PAPER_X }}>
        <Text testID="paper-title" class="font-bold text-paper-fg" style={{ numberOfLines: 2, fontSize: T.type.title, letterSpacing: -0.6, lineHeight: 33 }}>
          {title}
        </Text>
        <View class="flex-row items-center" style={{ gap: 6, marginTop: 9, marginBottom: 14 }}>
          <If when={meta()?.source === "claude"}>
            <View class="flex-row items-center" style={{ gap: 4 }}>
              <Icon name="spark" size={12} tint={token("claude")} />
              <Text class="font-semibold text-claude-ink" style={{ fontSize: T.type.meta }}>
                {t("paper.by_claude")}
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
        <View class="absolute flex-row items-center" style={{ right: 22, top: 22, gap: 5, opacity: savedOpacity }}>
          <View class="bg-ok" style={{ width: 7, height: 7, borderRadius: 3.5 }} />
          <Text class="text-paper-muted" style={{ fontSize: T.type.meta }}>
            {t("paper.saved")}
          </Text>
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
        placeholder={t("paper.placeholder")}
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
          if (clicks === 1 && task && position.column >= task.box.start && position.column <= task.box.end) toggleLine(position.line);
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
              <Icon name="spark" size={12} tint={token("claude")} />
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

/** Puts the caret at the end of `line` and scrolls to it. */
function placeCaret(editor: EditorRef, line: number, text: string) {
  const column = lineAt(text, line).length;
  editor.setSelections([{ anchor: { line, column }, head: { line, column } }]);
  editor.scrollToLine(line);
}
