// The list under the search field: today's to-dos, the notes that match,
// and "new note" for a title no note has. With a note open the same rows
// narrow into a sidebar of titles. Rows drop in one after another as the
// list opens; filtering and the arrow keys change it without motion.
import { Animated, computed, createAnimatedValue, effect, keymap, reduceMotion, signal, Text, token, untracked, View, type InputRef } from "nsh";
import { Input } from "nsh/base";
import { t } from "nsh/i18n";
import { openActions, type ActionTarget } from "../actions";
import { tn } from "../i18n";
import { activate, allTodos, arriving, entering, finishRename, focusRequest, listEntrance, now, renaming, rows, selected, stage, type Row } from "../store";
import { plainSnippet } from "../tasks";
import { age, hm, todaySummary, type TodaySummary } from "../time";
import { Icon, type IconName } from "./icons";
import { springConfig } from "./motion";
import { Highlight, Keycaps } from "./parts";
import { T } from "./tokens";

type NoteRow = Extract<Row, { kind: "note" }>;
type CreateRow = Extract<Row, { kind: "create" }>;

const rowKey = (r: Row) => (r.kind === "note" ? `n:${r.meta.title}` : r.kind);

/** What the action panel acts on for a row. */
function targetOf(row: Row, index: number): ActionTarget {
  if (row.kind === "note") return { kind: "note", title: row.meta.title, index };
  if (row.kind === "create") return { kind: "create", title: row.title, index };
  return { kind: "summary", index };
}

/** Today's to-dos at a glance, for the summary row. */
const summary = computed(() => todaySummary(allTodos(), new Date(now())));

/** The rows; `compact` with a note open (titles only, a sidebar). */
export function NoteList(props: { compact: boolean }) {
  return (
    <View testID="notes" role="list" style={{ paddingTop: T.size.listTop - 2, paddingHorizontal: props.compact ? 6 : 8 }}>
      <Each of={rows()} key={rowKey}>
        {(row, index) => <ListRow row={row()} index={index()} compact={props.compact} />}
      </Each>
    </View>
  );
}

function ListRow(props: { row: Row; index: number; compact: boolean }) {
  const isSelected = () => selected() === props.index;
  const onAccent = () => isSelected() && T.selection === "fill";
  const opacity = createAnimatedValue(1);
  const offset = createAnimatedValue(0);
  const glow = createAnimatedValue(0);

  // Hidden: the rows wait invisible, so the next summon never shows last time's rows for a frame before they drop in.
  effect(() => {
    if (stage() === "hidden") opacity.set(0);
  });
  // The list opening: each row drops in 28 ms after the one above it. A row a search brings in later (made after
  // the entrance's turn) shows at once, as the rows it joins: typing never replays the entrance.
  const born = untracked(listEntrance);
  effect(() => {
    const entrance = listEntrance();
    if (!entrance || (entrance === born && !entering())) return;
    const delay = untracked(() => props.index) * T.timing.stagger;
    if (reduceMotion()) {
      opacity.set(0);
      Animated.timing(opacity, { toValue: 1, duration: 180, delay, easing: "easeOut" }).start();
      return;
    }
    opacity.set(0);
    offset.set(-9);
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, easing: "easeOut" }),
        Animated.spring(offset, { toValue: 0, ...springConfig(T.spring.drop) }),
      ]),
    ]).start();
  });

  // A note an AI app just wrote: a ring in the agents' orange that fades.
  effect(() => {
    const row = props.row;
    if (row.kind !== "note" || arriving() !== row.meta.title) return;
    glow.set(0);
    void glow.keyframes([0, { offset: 0.1, value: 1 }, 0], { duration: 1600 });
  });

  const note = () => (props.row.kind === "note" ? props.row : null);
  const create = () => (props.row.kind === "create" ? props.row : null);
  const height = () => (props.compact ? T.size.sidebarRow : T.size.row);
  const title = () => (onAccent() ? "text-on-accent" : "text-glass-fg");
  const sub = () => (onAccent() ? "text-on-accent-muted" : "text-glass-muted");

  return (
    <View
      testID={note() ? `row:${note()!.meta.title}` : `row:${props.row.kind}`}
      role="button"
      accessibilityState={{ selected: isSelected() }}
      onPress={() => {
        if (untracked(renaming) === null) activate(props.index);
      }}
      // A right click shows the row's actions: the same panel as ⌘K.
      onContextMenu={() => {
        if (untracked(renaming) === null) openActions(targetOf(props.row, props.index));
      }}
      onMouseEnter={() => {
        if (untracked(stage) !== "editor" && untracked(renaming) === null) selected.set(props.index);
      }}
      class="flex-row items-center"
      classList={{
        "bg-primary": isSelected() && T.selection === "fill",
        "bg-glass-hover": isSelected() && T.selection !== "fill",
      }}
      style={{
        height: height(),
        gap: 12,
        paddingHorizontal: props.compact ? 10 : 14,
        borderRadius: T.radius.row,
        borderCurve: "continuous",
        opacity,
        transform: [{ translateY: offset }],
      }}
    >
      <View
        class="absolute inset-0 border-2 border-agent"
        style={{ borderRadius: T.radius.row, opacity: glow, pointerEvents: "none" }}
      />
      <If when={T.selection === "bar" && isSelected()}>
        <View class="absolute bg-primary" style={{ left: 2, top: height() / 2 - 8, width: 3, height: 16, borderRadius: 2 }} />
      </If>
      <RowIcon row={props.row} onAccent={onAccent()} />
      <View class="flex-1" style={{ minWidth: 0 }}>
        <If when={props.row.kind === "summary"}>
          <Text class={title()} style={{ numberOfLines: 1, fontSize: T.type.row }}>
            {summaryTitle(summary())}
          </Text>
          <If when={!props.compact}>
            <Text class={sub()} style={{ numberOfLines: 1, fontSize: T.type.snippet }}>
              {summaryLine(summary())}
            </Text>
          </If>
        </If>
        <If when={note()}>
          {(row: () => NoteRow) => (
            <>
              <If
                when={renaming() === row().meta.title}
                else={
                  <Highlight
                    text={row().meta.title}
                    terms={row().terms}
                    selected={onAccent()}
                    size={T.type.row}
                    class={title()}
                  />
                }
              >
                <RenameField title={row().meta.title} class={title()} />
              </If>
              <If when={!props.compact}>
                <Highlight
                  text={row().meta.downloading ? t("list.downloading") : plainSnippet(row().snippet) || t("list.blank")}
                  terms={row().terms}
                  selected={onAccent()}
                  size={T.type.snippet}
                  class={sub()}
                />
              </If>
            </>
          )}
        </If>
        <If when={create()}>
          {(row: () => CreateRow) => (
            <>
              <Text class={title()} style={{ numberOfLines: 1, fontSize: T.type.row }}>
                {t("list.create", { title: row().title })}
              </Text>
              <If when={!props.compact}>
                <Text class={sub()} style={{ numberOfLines: 1, fontSize: T.type.snippet }}>
                  {t("list.create_hint")}
                </Text>
              </If>
            </>
          )}
        </If>
      </View>
      <If when={props.compact && note()?.meta.locked}>
        <LockMark onAccent={onAccent()} />
      </If>
      <If when={!props.compact}>
        <If when={props.row.kind === "summary"}>
          <Dots done={summary().dots} onAccent={onAccent()} />
        </If>
        <If when={note()}>
          {(row: () => NoteRow) => (
            // The mark and the time keep their widths and the design's gap; the title and snippet give way.
            <View class="flex-row items-center" style={{ gap: 10, flexShrink: 0, marginLeft: 4 }}>
              <If when={row().meta.source}>
                {(agent) => (
                  <Text
                    testID="note-agent"
                    class={sub()}
                    style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 0, maxWidth: 120 }}
                  >
                    {agent()}
                  </Text>
                )}
              </If>
              <If when={row().meta.locked}>
                <LockMark onAccent={onAccent()} />
              </If>
              <Text class={sub()} style={{ numberOfLines: 1, fontSize: T.type.meta, fontVariant: ["tabular-nums"], flexShrink: 0 }}>
                {age(row().meta.modified, now())}
              </Text>
            </View>
          )}
        </If>
        <If when={create()}>
          <Keycaps keys={T.keys.create} onAccent={onAccent()} />
        </If>
      </If>
    </View>
  );
}

/** A locked note's small padlock, at the row's end. */
function LockMark(props: { onAccent: boolean }) {
  return (
    <View testID="note-locked" accessible accessibilityLabel={t("lock.row")} style={{ flexShrink: 0 }}>
      <Icon name="lock" size={13} tint={props.onAccent ? token("on-accent-muted") : token("glass-muted")} />
    </View>
  );
}

/** The row's icon tile: a document, an AI app's spark, the to-do list, or a plus. An AI app's note keeps the plain tile
 * and only its spark is orange, in the darker ink: a tinted tile over the glass muddies when a dark window is behind. */
function RowIcon(props: { row: Row; onAccent: boolean }) {
  const byAgent = () => props.row.kind === "note" && props.row.meta.source !== null;
  const tile = () =>
    props.onAccent
      ? "bg-on-accent-fill"
      : props.row.kind === "summary"
          ? "bg-primary/15"
          : "bg-glass-hover";
  const tint = () =>
    props.onAccent
      ? token("on-accent")
      : byAgent()
        ? token("agent-ink")
        : props.row.kind === "summary"
          ? token("accent-ink")
          : token("glass-fg");
  const downloading = () => props.row.kind === "note" && props.row.meta.downloading;
  const name = (): IconName =>
    props.row.kind === "summary" ? "list" : props.row.kind === "create" ? "plus" : downloading() ? "cloud" : byAgent() ? "spark" : "doc";
  return (
    <View
      class={`items-center justify-center ${tile()}`}
      style={{ width: T.size.rowIcon, height: T.size.rowIcon, borderRadius: T.radius.row / 2, borderCurve: "continuous" }}
    >
      <Icon name={name()} size={16} tint={tint()} />
    </View>
  );
}

/** The summary row's title: today's open to-dos; with none left, what is overdue (the row shows only with one of them). */
function summaryTitle(s: TodaySummary): string {
  return s.left ? tn("list.today", s.left) : tn("list.late_title", s.late);
}

/** The summary row's second line: what is overdue and what comes next; with nothing left today, how today stands under an overdue title. */
function summaryLine(s: TodaySummary): string {
  if (!s.left) return s.late ? (s.total ? t("list.all_done") : t("list.today_none")) : t("list.see_all");
  const parts: string[] = [];
  if (s.late) parts.push(tn("list.late", s.late));
  if (s.next) parts.push(t("list.next", { time: hm(s.next.due), text: s.next.text }));
  return parts.join(" · ") || t("list.see_all");
}

/** Today's to-dos as dots: filled for the done ones. */
function Dots(props: { done: boolean[]; onAccent: boolean }) {
  const filled = () => (props.onAccent ? "bg-on-accent" : "bg-primary");
  const empty = () => (props.onAccent ? "border border-on-accent-muted" : "border border-glass-muted");
  return (
    <View
      class="flex-row items-center"
      style={{ gap: 4 }}
      accessibilityLabel={t("list.dots", { total: props.done.length, done: props.done.filter(Boolean).length })}
    >
      <Each of={props.done} key="index">
        {(done) => <View class={done() ? filled() : empty()} style={{ width: 7, height: 7, borderRadius: 3.5 }} />}
      </Each>
    </View>
  );
}

/** The title being renamed, in place: Return or leaving the field renames, Escape keeps the old title. */
function RenameField(props: { title: string; class: string }) {
  const value = signal(props.title);
  let finished = false;
  const finish = (to: string | null) => {
    if (finished) return;
    finished = true;
    finishRename(to);
    focusRequest.set({ target: "field" });
  };
  // Newer than the panel's Escape (which steps back): this one only leaves the field.
  keymap.bind("escape", () => finish(null), { when: "always" });
  return (
    <Input
      testID="rename"
      ref={(r: InputRef | undefined) => {
        r?.focus();
        r?.setSelection(0, props.title.length);
      }}
      class={props.class}
      style={{ fontSize: T.type.row, backgroundColor: "transparent", padding: 0 }}
      value={value()}
      accessibilityLabel={t("actions.rename_label", { title: props.title })}
      autoCorrect={false}
      autoCapitalize="none"
      submitBehavior="submit"
      onChange={({ value: next }) => value.set(next)}
      onSubmit={() => finish(untracked(value))}
      onBlur={() => finish(untracked(value))}
    />
  );
}
