// The list under the search field: today's to-dos as a card, the notes that
// match, and "new note" for a title no note has. Rows are words alone, no
// icon: a semibold title (led by the note's emoji, when it has one) with the
// AI app that wrote the note, a padlock and the time at its end, and the
// snippet under it across the row. The recent list (no query) falls into
// date groups under small headers (Today, Yesterday, This Week, Earlier),
// which the keys and the pointer pass over. With a note open the same rows
// narrow into a sidebar of titles, ungrouped. Rows drop in one after
// another as the list opens, and on their own for a note new in the folder
// or back from the trash; a note moved to the trash slides left as it
// fades, then the rows below close the gap. Filtering and the arrow keys
// change the list without motion. It shows up to `T.size.listRows` rows and
// scrolls to the rest: an arrow-key step keeps the selected row in view, a
// new search or summon starts at the top.
import { Animated, Canvas, type AnimatedValue, type CompositeAnimation, computed, createAnimatedValue, effect, keymap, localeSettings, reduceMotion, Scroll, signal, Text, token, untracked, View, type InputRef, type ScrollRef } from "nsh";
import { Input } from "nsh/base";
import { t } from "nsh/i18n";
import { openActions, type ActionTarget } from "../actions";
import { tn } from "../i18n";
import { activate, allTodos, arriving, dropIn, dropping, editingInPlace, entering, finishRename, focusRequest, keySteps, listEntrance, listRows, now, query, renaming, rowKey, selected, stage, type ListRow as ListRowItem, type Row } from "../store";
import { plainSnippet } from "../tasks";
import { age, dayGroup, dayLabel, hm, todaySummary, type DayGroup, type TodaySummary } from "../time";
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

/** Today's to-dos at a glance, for the summary card. */
const summary = computed(() => todaySummary(allTodos(), new Date(now())));

/** An item of the list as it lays out: a row, or the header of a date group above its first note. */
export type ListItem = { kind: "row"; item: ListRowItem } | { kind: "day"; group: DayGroup; next: number };

/**
 * The list's items: its rows, with a date group's header before the first note of each group when `grouped` (the
 * recent list). Today's card is in no group; a note leaving keeps its group's header until it has gone. `next` is the
 * index of the row under a header, so the header drops in with it.
 */
export function listItems(rows: readonly ListRowItem[], grouped: boolean, at: number, firstDay: number): ListItem[] {
  const out: ListItem[] = [];
  let last: DayGroup | null = null;
  rows.forEach((item, place) => {
    if (grouped && item.row.kind === "note") {
      const group = dayGroup(item.row.meta.modified, at, firstDay);
      if (group !== last) out.push({ kind: "day", group, next: item.leaving ? place : item.index });
      last = group;
    }
    out.push({ kind: "row", item });
  });
  return out;
}

/** The recent list's items, grouped by day; with a query (or a note open) the rows alone. */
const groupedItems = computed(() => listItems(listRows(), !query().trim(), now(), localeSettings().firstDayOfWeek));
const plainItems = computed(() => listItems(listRows(), false, 0, 1));

/** How tall an item is: a header, today's card with the space under it, a row (shorter in the sidebar, which has no headers). */
function itemHeight(item: ListItem, compact: boolean): number {
  if (compact) return T.size.sidebarRow;
  if (item.kind === "day") return T.size.daySection;
  return item.item.row.kind === "summary" ? T.size.row + T.size.cardGap : T.size.row;
}

/** The list's room at most: the panel as tall as with a note open. */
const MOST = T.size.editorHeight - T.size.field - T.size.footer;

/**
 * How tall the list is in the panel: its first `T.size.listRows` rows (today's card counts as one) with the headers
 * among them, fewer when the headers would make it taller than `MOST`; it scrolls to the rest. No row shows cut.
 */
export function noteListHeight(): number {
  let top = T.size.listTop;
  let fit = top;
  let rows = 0;
  for (const item of groupedItems()) {
    top += itemHeight(item, false);
    if (top > MOST && rows > 0) break;
    if (item.kind !== "row") continue;
    fit = top;
    if (++rows === T.size.listRows) break;
  }
  return fit;
}

/** The rows; `compact` with a note open (titles only, a sidebar). */
export function NoteList(props: { compact: boolean }) {
  let scroll: ScrollRef | undefined;
  let offset = 0;
  let viewport = 0;
  const items = () => (props.compact ? plainItems() : groupedItems());
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
  // An arrow-key step (with a note open too: the next note opens) keeps the selected row in view, with its group's
  // header when it is the group's first, set at once as the to-do view does: a held key steps faster than a scroll
  // animation. A hover does not scroll. So does a note opened: the sidebar's rows are shorter, and the open one stays
  // in view.
  effect(() => {
    keySteps();
    void props.compact;
    untracked(() => {
      const compact = props.compact;
      const list = items();
      let top = T.size.listTop - 2;
      let above = 0;
      let first = true;
      for (const item of list) {
        const h = itemHeight(item, compact);
        if (item.kind === "row" && item.item.index === selected()) {
          const height = viewport || (compact ? T.size.listRows * T.size.sidebarRow : noteListHeight());
          const bottom = top + (compact ? T.size.sidebarRow : T.size.row);
          if (first) to(0);
          else if (top - above < offset) to(top - above);
          else if (bottom > offset + height) to(bottom - height);
          return;
        }
        if (item.kind === "row") first = false;
        above = item.kind === "day" ? h : 0;
        top += h;
      }
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
        <Each of={items()} key={(i) => (i.kind === "day" ? `d:${i.group}` : rowKey(i.item.row))}>
          {(item) => (
            <>
              <If when={asDay(item())}>{(day: () => DayItem) => <DayHeader group={day().group} next={day().next} />}</If>
              <If when={asRow(item())}>
                {(row: () => ListRowItem) => <ListRow row={row().row} index={row().index} leaving={row().leaving} compact={props.compact} />}
              </If>
            </>
          )}
        </Each>
      </View>
    </Scroll>
  );
}

type DayItem = Extract<ListItem, { kind: "day" }>;
const asDay = (i: ListItem) => (i.kind === "day" ? i : null);
const asRow = (i: ListItem) => (i.kind === "row" ? i.item : null);

/**
 * The list opening: an item waits its turn, `T.timing.stagger` after the row above (`place`: the row's place, which a
 * header shares with the row under it), then drops in while it fades in. One the list holds past what it shows, or a
 * search brings in later (made after the entrance's turn), shows at once, as the rows it joins: typing never replays
 * the entrance. With reduced motion it only fades in.
 */
function dropOnEntrance(opacity: AnimatedValue, offset: AnimatedValue, place: () => number) {
  // Hidden: the rows wait invisible, so the next summon never shows last time's rows for a frame before they drop in.
  effect(() => {
    if (stage() === "hidden") opacity.set(0);
  });
  const born = untracked(listEntrance);
  effect(() => {
    const entrance = listEntrance();
    if (!entrance || (entrance === born && !entering())) return;
    const index = untracked(place);
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
}

/** A date group's header: small, semibold and faint; the keys and the pointer pass over it. A header new while the
 * list shows (a note new in the folder starting today's group) fades in with the row it heads. */
function DayHeader(props: { group: DayGroup; next: number }) {
  const opacity = createAnimatedValue(1);
  const offset = createAnimatedValue(0);
  dropOnEntrance(opacity, offset, () => props.next);
  if (dropping()) {
    opacity.set(0);
    Animated.timing(opacity, { toValue: 1, duration: T.timing.dropFade, easing: "easeOut" }).start();
  }
  return (
    <View
      testID={`day:${props.group}`}
      role="header"
      class="flex-row items-end"
      style={{ height: T.size.daySection, paddingHorizontal: 14, paddingBottom: 5, opacity, transform: [{ translateY: offset }] }}
    >
      <Text class="font-semibold text-glass-muted" style={{ numberOfLines: 1, fontSize: T.type.meta }}>
        {dayLabel(props.group)}
      </Text>
    </View>
  );
}

/** A row of the list; `leaving` while a note moved to the trash plays its exit (it takes no input then). */
function ListRow(props: { row: Row; index: number; leaving: boolean; compact: boolean }) {
  const isSelected = () => !props.leaving && selected() === props.index;
  const opacity = createAnimatedValue(1);
  const offset = createAnimatedValue(0);
  const slide = createAnimatedValue(0);
  const scale = createAnimatedValue(1);
  const glow = createAnimatedValue(0);

  // The list opening: each row drops in 28 ms after the one above it.
  dropOnEntrance(opacity, offset, () => props.index);

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
  const card = () => props.row.kind === "summary" && !props.compact;
  const height = () => (props.compact ? T.size.sidebarRow : T.size.row);
  // Selected on macOS: a light accent fill, the title in the accent's ink; the rest keeps its colors, a shade deeper
  // where a theme's would read below WCAG AA on the fill (`selected-*`, app/ui/themes.ts). Today's card always has a fill.
  const accent = () => isSelected() && T.selection === "fill";
  const filled = () => accent() || card();
  const title = () => `${props.compact ? "" : "font-semibold "}${accent() ? "text-selected-ink" : "text-glass-fg"}`;
  const sub = () => (filled() ? "text-selected-muted" : "text-glass-muted");

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
        "bg-primary/12": accent(),
        // Today's card: a faint wash of the accent inside a hairline, deeper once selected.
        "bg-primary/6": card() && !accent(),
        "border border-glass-line": card(),
        "bg-glass-hover": isSelected() && T.selection !== "fill",
      }}
      style={{
        height: height(),
        marginBottom: card() ? T.size.cardGap : 0,
        gap: 10,
        paddingHorizontal: props.compact ? 10 : 14,
        borderRadius: card() ? T.radius.card : T.radius.row,
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
      <View class="flex-1" style={{ minWidth: 0, gap: props.compact ? 0 : 2 }}>
        <If when={props.row.kind === "summary"}>
          <Text class={title()} style={{ numberOfLines: 1, fontSize: T.type.row }}>
            {summaryTitle(summary())}
          </Text>
          <If when={!props.compact}>
            <SummaryLine summary={summary()} />
          </If>
        </If>
        <If when={note()}>
          {(row: () => NoteRow) => (
            <>
              {/* The title's line: the title gives way to the AI app, the padlock and the time at its end. */}
              <View class="flex-row items-center" style={{ gap: 8 }}>
                <View class="flex-1" style={{ minWidth: 0 }}>
                  <If
                    when={renaming() === row().meta.title}
                    else={
                      // The emoji leads the title and takes only its own width; the query marks the title's words only.
                      <Highlight
                        testID="note-title"
                        text={row().meta.title}
                        prefix={row().meta.icon}
                        terms={row().terms}
                        size={T.type.row}
                        class={title()}
                      />
                    }
                  >
                    <RenameField title={row().meta.title} class={title()} />
                  </If>
                </View>
                <If when={props.compact && row().meta.locked}>
                  <LockMark filled={accent()} />
                </If>
                <If when={!props.compact}>
                  <If when={row().meta.source}>{(agent) => <AgentMark name={agent()} filled={accent()} />}</If>
                  <If when={row().meta.locked}>
                    <LockMark filled={accent()} />
                  </If>
                  <Text
                    testID="note-time"
                    class={sub()}
                    style={{ numberOfLines: 1, fontSize: T.type.meta, fontVariant: ["tabular-nums"], flexShrink: 0 }}
                  >
                    {age(row().meta.modified, now())}
                  </Text>
                </If>
              </View>
              <If when={!props.compact}>
                <Highlight
                  testID="note-snippet"
                  text={row().meta.downloading ? t("list.downloading") : plainSnippet(row().snippet) || t("list.blank")}
                  terms={row().terms}
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
      <If when={card() && summary().total > 0}>
        <ProgressRing done={summary().total - summary().left} total={summary().total} />
      </If>
      {/* ⌘↩ makes the note while a search hit is selected (Return opens the hit); selected, the footer says Return. */}
      <If when={!props.compact && create() && !isSelected()}>
        <Keycaps keys={T.keys.create} />
      </If>
    </View>
  );
}

/** The AI app that wrote a note: a dot and its name, in the agents' orange. */
function AgentMark(props: { name: string; filled: boolean }) {
  return (
    <View testID="note-agent" class="flex-row items-center" style={{ gap: 4, flexShrink: 0, maxWidth: 120 }}>
      <View class="bg-agent" style={{ width: 6, height: 6, borderRadius: 3 }} />
      <Text class={props.filled ? "text-selected-agent" : "text-agent-ink"} style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
        {props.name}
      </Text>
    </View>
  );
}

/** A locked note's small padlock, in the title's line. */
function LockMark(props: { filled: boolean }) {
  return (
    <View testID="note-locked" accessible accessibilityLabel={t("lock.row")} style={{ flexShrink: 0 }}>
      <Icon name="lock" size={12} tint={props.filled ? token("selected-muted") : token("glass-muted")} />
    </View>
  );
}

/** The summary row's title: today's open to-dos; with none left, what is overdue (the row shows only with one of them). */
function summaryTitle(s: TodaySummary): string {
  return s.left ? tn("list.today", s.left) : tn("list.late_title", s.late);
}

/**
 * The summary card's second line: what is overdue (in the overdue red) and what comes next; with nothing left today,
 * how today stands under an overdue title.
 */
function summaryLine(s: TodaySummary): { late: string | null; rest: string } {
  if (!s.left) return { late: null, rest: s.late ? (s.total ? t("list.all_done") : t("list.today_none")) : t("list.see_all") };
  const late = s.late ? tn("list.late", s.late) : null;
  const next = s.next ? t("list.next", { time: hm(s.next.due), text: s.next.text }) : "";
  return { late, rest: late ? (next ? ` · ${next}` : "") : next || t("list.see_all") };
}

function SummaryLine(props: { summary: TodaySummary }) {
  const line = () => summaryLine(props.summary);
  return (
    <Text class="text-selected-muted" style={{ numberOfLines: 1, fontSize: T.type.snippet }}>
      <If when={line().late}>{(late) => <Text testID="summary-late" class="text-selected-late">{late()}</Text>}</If>
      {line().rest}
    </Text>
  );
}

/** How many of today's to-dos are done, as a ring that fills clockwise from the top, the number left inside. */
function ProgressRing(props: { done: number; total: number }) {
  const SIZE = 30;
  const STROKE = 3;
  return (
    <View
      testID="summary-ring"
      accessible
      accessibilityLabel={t("list.progress", { total: props.total, done: props.done })}
      class="items-center justify-center"
      style={{ width: SIZE, height: SIZE, flexShrink: 0 }}
    >
      <Canvas
        class="absolute inset-0"
        draw={(cx, size) => {
          const r = (Math.min(size.width, size.height) - STROKE) / 2;
          const c = size.width / 2;
          cx.lineWidth = STROKE;
          cx.lineCap = "round";
          cx.strokeStyle = token("glass-line");
          cx.beginPath();
          cx.arc(c, c, r, 0, Math.PI * 2);
          cx.stroke();
          if (props.done <= 0) return;
          const start = -Math.PI / 2;
          cx.strokeStyle = token("primary");
          cx.beginPath();
          cx.arc(c, c, r, start, start + (Math.PI * 2 * Math.min(props.done, props.total)) / props.total);
          cx.stroke();
        }}
      />
      <Text class="font-semibold text-glass-fg" style={{ fontSize: 10, fontVariant: ["tabular-nums"] }}>
        {props.total - props.done}
      </Text>
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
