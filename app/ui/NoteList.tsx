// The list under the search field: today's to-dos, the notes that match,
// and "new note" for a title no note has. Rows are words alone, no icon: a
// note's emoji, when it has one, leads its title, and an AI app's note is
// told by the app's name at the row's end. With a note open the same rows
// narrow into a sidebar of titles. Rows drop in one after another as the
// list opens, and on their own for a note new in the folder or back from
// the trash; a note moved to the trash slides left as it fades, then the
// rows below close the gap. Filtering and the arrow keys change the list
// without motion. It shows `T.size.listRows` rows and scrolls to the rest:
// an arrow-key step keeps the selected row in view, a new search or summon
// starts at the top.
import { Animated, type CompositeAnimation, computed, createAnimatedValue, effect, keymap, reduceMotion, Scroll, signal, Text, token, untracked, View, type InputRef, type ScrollRef } from "nsh";
import { Input } from "nsh/base";
import { t } from "nsh/i18n";
import { openActions, type ActionTarget } from "../actions";
import { tn } from "../i18n";
import { activate, allTodos, arriving, dropIn, dropping, editingInPlace, entering, finishRename, focusRequest, keySteps, listEntrance, listRows, now, query, renaming, rowKey, selected, stage, type Row } from "../store";
import { plainSnippet } from "../tasks";
import { age, hm, todaySummary, type TodaySummary } from "../time";
import { emojiAnchor } from "./Emoji";
import { Icon } from "./icons";
import { springConfig } from "./motion";
import { Highlight, Keycaps } from "./parts";
import { T } from "./tokens";

type NoteRow = Extract<Row, { kind: "note" }>;
type CreateRow = Extract<Row, { kind: "create" }>;

/** A row drops in from this far above, in points. */
const DROP_FROM = -9;
/** A row moved to the trash slides this far left (a ticked to-do slides right) and shrinks to `TRASH_SCALE`. */
const TRASH_SLIDE = -24;
const TRASH_SCALE = 0.96;

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
  let scroll: ScrollRef | undefined;
  let offset = 0;
  let viewport = 0;
  const rowHeight = () => (props.compact ? T.size.sidebarRow : T.size.row);
  const to = (y: number) => {
    if (!scroll || y === offset) return;
    offset = y;
    scroll.scrollTo({ y, animated: false });
  };
  // A new search, or the list summoned again: back to the top, where the first row is selected.
  effect(() => {
    query();
    listEntrance();
    untracked(() => to(0));
  });
  // An arrow-key step (with a note open too: the next note opens) keeps the selected row in view, set at once as the
  // to-do view does: a held key steps faster than a scroll animation. A hover does not scroll. So does a note opened:
  // the sidebar's rows are shorter, and the open one stays in view.
  effect(() => {
    keySteps();
    void props.compact;
    untracked(() => {
      const at = listRows().findIndex((r) => r.index === selected());
      if (at < 0) return;
      const height = viewport || T.size.listRows * rowHeight();
      const top = T.size.listTop - 2 + at * rowHeight();
      const bottom = top + rowHeight();
      if (at === 0) to(0);
      else if (top < offset) to(top);
      else if (bottom > offset + height) to(bottom - height);
    });
  });
  return (
    <Scroll
      testID="notes-scroll"
      class="flex-1"
      ref={(r) => {
        scroll = r;
      }}
      onScroll={({ offset: at, size }) => {
        offset = at.y;
        viewport = size.height;
      }}
    >
      <View testID="notes" role="list" style={{ paddingTop: T.size.listTop - 2, paddingHorizontal: props.compact ? 6 : 8 }}>
        <Each of={listRows()} key={(r) => rowKey(r.row)}>
          {(item) => <ListRow row={item().row} index={item().index} leaving={item().leaving} compact={props.compact} />}
        </Each>
      </View>
    </Scroll>
  );
}

/** A row of the list; `leaving` while a note moved to the trash plays its exit (it takes no input then). */
function ListRow(props: { row: Row; index: number; leaving: boolean; compact: boolean }) {
  const isSelected = () => !props.leaving && selected() === props.index;
  const onAccent = () => isSelected() && T.selection === "fill";
  const opacity = createAnimatedValue(1);
  const offset = createAnimatedValue(0);
  const slide = createAnimatedValue(0);
  const scale = createAnimatedValue(1);
  const glow = createAnimatedValue(0);

  // Hidden: the rows wait invisible, so the next summon never shows last time's rows for a frame before they drop in.
  effect(() => {
    if (stage() === "hidden") opacity.set(0);
  });
  // The list opening: each row drops in 28 ms after the one above it. A row a search brings in later (made after
  // the entrance's turn) shows at once, as the rows it joins: typing never replays the entrance. So do the rows below
  // the ones the list shows, which are scrolled to later.
  const born = untracked(listEntrance);
  effect(() => {
    const entrance = listEntrance();
    if (!entrance || (entrance === born && !entering())) return;
    const index = untracked(() => props.index);
    if (index >= T.size.listRows) {
      offset.set(0);
      opacity.set(1);
      return;
    }
    const delay = index * T.timing.stagger;
    if (reduceMotion()) {
      opacity.set(0);
      Animated.timing(opacity, { toValue: 1, duration: 180, delay, easing: "easeOut" }).start();
      return;
    }
    opacity.set(0);
    offset.set(DROP_FROM);
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: T.timing.dropFade, easing: "easeOut" }),
        Animated.spring(offset, { toValue: 0, ...springConfig(T.spring.drop) }),
      ]),
    ]).start();
  });

  // Moved to the trash: the row slides left while it shrinks a little and fades; the store takes it out of the list
  // once it has faded (`trashNote`), and the rows below close the gap. A note new in the folder, or back from the trash
  // (even while it was still sliding out), drops in from above as the rows do when the list opens. A row a search
  // brings in later shows at once. With reduced motion the row only fades out and in, where it is.
  let motion: CompositeAnimation | null = null;
  let left = false;
  // A row made in the turn of a drop-in plays it; else it waits for the next one.
  let seen = dropping() ? -1 : untracked(dropIn).turn;
  effect(() => {
    const going = props.leaving;
    const drop = dropIn();
    untracked(() => {
      const row = props.row;
      const fresh = drop.turn !== seen;
      seen = drop.turn;
      const drops = fresh && row.kind === "note" && drop.titles.has(row.meta.title);
      const still = reduceMotion();
      if (going) {
        if (left) return;
        left = true;
        motion?.stop();
        const exit = { duration: T.timing.trashExit, easing: "easeOut" } as const;
        motion = Animated.parallel([
          Animated.timing(opacity, { toValue: 0, ...exit }),
          ...(still ? [] : [Animated.timing(slide, { toValue: TRASH_SLIDE, ...exit }), Animated.timing(scale, { toValue: TRASH_SCALE, ...exit })]),
        ]);
        motion.start();
        return;
      }
      const back = left;
      left = false;
      if (!drops) {
        if (back) {
          motion?.stop();
          slide.set(0);
          scale.set(1);
          opacity.set(1);
        }
        return;
      }
      motion?.stop();
      slide.set(0);
      scale.set(1);
      opacity.set(0);
      if (still) {
        motion = Animated.timing(opacity, { toValue: 1, duration: T.timing.dropFade, easing: "easeOut" });
      } else {
        offset.set(DROP_FROM);
        motion = Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: T.timing.dropFade, easing: "easeOut" }),
          Animated.spring(offset, { toValue: 0, ...springConfig(T.spring.drop) }),
        ]);
      }
      motion.start();
    });
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
      // "Set Emoji…" opens the picker under the row.
      ref={props.row.kind === "note" ? emojiAnchor("row", props.row.meta.title) : undefined}
      role="button"
      accessibilityState={{ selected: isSelected(), disabled: props.leaving }}
      onPress={() => {
        if (!props.leaving && !untracked(editingInPlace)) activate(props.index);
      }}
      // A right click shows the row's actions: the same panel as ⌘K.
      onContextMenu={() => {
        if (!props.leaving && !untracked(editingInPlace)) openActions(targetOf(props.row, props.index));
      }}
      onMouseEnter={() => {
        if (!props.leaving && untracked(stage) !== "editor" && !untracked(editingInPlace)) selected.set(props.index);
      }}
      class="flex-row items-center"
      classList={{
        "bg-primary": isSelected() && T.selection === "fill",
        "bg-glass-hover": isSelected() && T.selection !== "fill",
      }}
      style={{
        height: height(),
        gap: 10,
        paddingHorizontal: props.compact ? 10 : 14,
        borderRadius: T.radius.row,
        borderCurve: "continuous",
        opacity,
        transform: [{ translateX: slide }, { translateY: offset }, { scale }],
      }}
    >
      <View
        class="absolute inset-0 border-2 border-agent"
        style={{ borderRadius: T.radius.row, opacity: glow, pointerEvents: "none" }}
      />
      <If when={T.selection === "bar" && isSelected()}>
        <View class="absolute bg-primary" style={{ left: 2, top: height() / 2 - 8, width: 3, height: 16, borderRadius: 2 }} />
      </If>
      <View class="flex-1" style={{ minWidth: 0, gap: props.compact ? 0 : 1 }}>
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
                  // The emoji leads the title and takes only its own width; the query marks the title's words only.
                  <Highlight
                    testID="note-title"
                    text={row().meta.title}
                    prefix={row().meta.icon}
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
                  {t("list.create_sub")}
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
        {/* ⌘↩ makes the note while a search hit is selected (Return opens the hit); selected, the footer says Return. */}
        <If when={create() && !isSelected()}>
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
