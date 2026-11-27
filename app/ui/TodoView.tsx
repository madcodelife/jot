// The to-do view ("待办" or "/todo" in the field): every open to-do by
// group (overdue, today, tomorrow, later, no time), each with its note and
// its due time. Its headers and rows rise in one after another as it opens.
// Ticking one bursts its checkbox, strikes its text through and slides its
// row out, then the row folds away (the store times the fold) and its
// group's count flips. Pressing the due time (or the alarm a selected row
// without one shows) opens the reminder time picker; a new time flips the
// chip and lifts the row into its new group.
import { Animated, cleanup, computed, createAnimatedValue, effect, reduceMotion, Scroll, Text, token, untracked, View, type ScrollRef, type ViewRef } from "nsh";
import type { Todo } from "jot/native";
import { clearTodoAnchor, openTodoDue, regrouping, setTodoAnchor } from "../due";
import { activate, checking, checkTodo, entering, keySteps, listEntrance, now, selected, stage, todoItems, type TodoItem } from "../store";
import { t } from "nsh/i18n";
import { dueLabel, groupLabel, parseDue, type TodoGroup } from "../time";
import { Icon } from "./icons";
import { fadeTo, springConfig } from "./motion";
import { DRAW, FlipText, StrikeLine, TodoCheck, type Flip } from "./parts";
import { T } from "./tokens";

type HeaderItem = Extract<TodoItem, { kind: "header" }>;
type TodoRowItem = Extract<TodoItem, { kind: "todo" }>;

/** How tall the to-do view is for its items (it scrolls past `T.size.todoMaxHeight`). */
export function todoViewHeight(items: readonly TodoItem[]): number {
  if (!items.length) return 93;
  const content = items.reduce((h, i) => h + (i.kind === "header" ? T.size.groupHeader : T.size.todoRow), 7);
  return Math.min(content, T.size.todoMaxHeight);
}

/** Where the to-do with `index` starts in the scroll's content, and whether its group's header sits right above it. */
function rowTop(items: readonly TodoItem[], index: number): { top: number; header: boolean } | null {
  let top = 7;
  let header = false;
  for (const item of items) {
    if (item.kind === "todo" && item.index === index) return { top, header };
    header = item.kind === "header";
    top += header ? T.size.groupHeader : T.size.todoRow;
  }
  return null;
}

/** The view. */
export function TodoView() {
  let scroll: ScrollRef | undefined;
  let offset = 0;
  let viewport = 0;
  // An arrow-key step keeps the selected row in view (with its group's header when it is the group's first),
  // set at once as Raycast's and Spotlight's lists do: a held key steps faster than a scroll animation.
  effect(() => {
    keySteps();
    const items = untracked(todoItems);
    const row = rowTop(items, untracked(selected));
    if (!row || !scroll) return;
    const height = viewport || todoViewHeight(items);
    const top = row.header ? row.top - T.size.groupHeader : row.top;
    const bottom = row.top + T.size.todoRow;
    let next = offset;
    if (top < offset) next = top <= 7 + T.size.groupHeader ? 0 : top;
    else if (bottom > offset + height) next = bottom - height;
    if (next === offset) return;
    offset = next;
    scroll.scrollTo({ y: next, animated: false });
  });
  return (
    <If
      when={todoItems().length > 0}
      else={
        <View testID="todos-empty" class="items-center justify-center" style={{ height: 93 }}>
          <Text class="text-glass-muted" style={{ fontSize: T.type.todo }}>
            {t("todo.empty")}
          </Text>
        </View>
      }
    >
      <Scroll
        testID="todos"
        class="flex-1"
        ref={(r) => {
          scroll = r;
        }}
        onScroll={({ offset: at, size }) => {
          offset = at.y;
          viewport = size.height;
        }}
      >
        <View style={{ paddingTop: 7, paddingHorizontal: 8 }}>
          <Each of={todoItems()} key={(i) => (i.kind === "header" ? `h:${i.group}` : i.key)}>
            {(item, index) => (
              <>
                <If when={asHeader(item())}>
                  {(h: () => HeaderItem) => <GroupHeader group={h().group} count={h().count} index={index()} />}
                </If>
                <If when={asTodo(item())}>{(t: () => TodoRowItem) => <TodoRow item={t()} index={index()} />}</If>
              </>
            )}
          </Each>
        </View>
      </Scroll>
    </If>
  );
}

const asHeader = (i: TodoItem) => (i.kind === "header" ? i : null);
const asTodo = (i: TodoItem) => (i.kind === "todo" ? i : null);

/** How far each item of the to-do view rises from as the view opens, in points. */
const RISE_FROM = 10;

/**
 * The to-do view opening: the item at `index` (headers count) waits its turn, `T.timing.stagger` after the one above,
 * then rises in while it fades in. An item made later (a search, a tick, a new time) shows at once, as the items it
 * joins: nothing but the opening replays it. With reduced motion it only fades in.
 */
function useEntrance(index: () => number) {
  const opacity = createAnimatedValue(1);
  const rise = createAnimatedValue(0);
  // Hidden: the items wait invisible, so the next summon never shows last time's for a frame before they rise in.
  effect(() => {
    if (stage() === "hidden") opacity.set(0);
  });
  const born = untracked(listEntrance);
  effect(() => {
    const entrance = listEntrance();
    if (!entrance || (entrance === born && !entering())) return;
    const delay = untracked(index) * T.timing.stagger;
    opacity.set(0);
    if (reduceMotion()) {
      void fadeTo(opacity, 1, T.timing.riseFade, delay);
      return;
    }
    rise.set(RISE_FROM);
    const coming = Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: T.timing.riseFade, easing: "easeOut" }),
        Animated.spring(rise, { toValue: 0, ...springConfig(T.spring.rise) }),
      ]),
    ]);
    coming.start();
    return () => coming.stop();
  });
  return { opacity, rise };
}

/** A group's count flips as it changes: the old number lifts out, the new one springs up from below. */
const COUNT_FLIP: Flip = { lift: 6, out: T.timing.flip.countOut, rise: 8, in: T.timing.flip.countIn, spring: T.spring.count };

function GroupHeader(props: { group: TodoGroup; count: number; index: number }) {
  const entrance = useEntrance(() => props.index);
  return (
    <View
      role="header"
      class="flex-row items-end"
      style={{
        height: T.size.groupHeader,
        gap: 7,
        paddingHorizontal: 14,
        paddingBottom: 4,
        opacity: entrance.opacity,
        transform: [{ translateY: entrance.rise }],
      }}
    >
      <Text class={`font-semibold ${props.group === "late" ? "text-late" : "text-glass-muted"}`} style={{ fontSize: T.type.meta }}>
        {groupLabel(props.group)}
      </Text>
      <FlipText
        text={String(props.count)}
        flip={COUNT_FLIP}
        class={props.group === "late" ? "text-late" : "text-glass-muted"}
        style={{ fontSize: T.type.meta, fontVariant: ["tabular-nums"] }}
      />
    </View>
  );
}

/** A ticked row slides this far right as it goes, in points; its text and note dim to `TICK_DIM`. */
const TICK_SLIDE = 60;
const TICK_DIM = 0.45;

function TodoRow(props: { item: TodoRowItem; index: number }) {
  const todo = () => props.item.todo;
  const isSelected = () => selected() === props.item.index;
  // Selected on macOS: a light accent fill, the text in the accent's ink, as the list's rows (`selected-*`).
  const accent = () => isSelected() && T.selection === "fill";
  const ticking = () => checking().has(props.item.key);
  const entrance = useEntrance(() => props.index);

  // Ticked: a line strikes the text through from its left while the text and the note dim; a pause, then the row
  // slides out to the right as it fades. The store folds it away once it has faded (`checkTodo`). With reduced
  // motion the line fades in and the row fades out where it is.
  const strike = createAnimatedValue(0);
  const dim = createAnimatedValue(1);
  const slide = createAnimatedValue(0);
  const leave = createAnimatedValue(1);
  effect(() => {
    if (!ticking()) return;
    const tick = T.timing.tick;
    const still = reduceMotion();
    const out = tick.strikeAfter + tick.strike + tick.slideAfter;
    const going = Animated.parallel([
      Animated.timing(strike, { toValue: 1, duration: tick.strike, delay: tick.strikeAfter, easing: still ? "easeOut" : DRAW }),
      Animated.timing(dim, { toValue: TICK_DIM, duration: tick.strike, delay: tick.strikeAfter, easing: "easeOut" }),
      Animated.timing(leave, { toValue: 0, duration: tick.fade, delay: out + tick.fadeAfter, easing: "easeOut" }),
      ...(still ? [] : [Animated.sequence([Animated.delay(out), Animated.spring(slide, { toValue: TICK_SLIDE, ...springConfig(T.spring.tickSlide) })])]),
    ]);
    going.start();
    return () => going.stop();
  });

  // A new time moves the row to its new group (`writeTodoDue`): it is lifted while it moves, above the rows it passes,
  // on a glass of its own with a soft shadow, which fade in as it leaves and out once it has landed.
  const moving = computed(() => {
    const r = regrouping();
    return r?.key === props.item.key ? r : null;
  });
  const raised = () => moving() !== null;
  const lift = createAnimatedValue(0);
  effect(() => {
    const r = moving();
    if (!r) {
      lift.set(0);
      return;
    }
    void fadeTo(lift, r.landed ? 0 : 1, r.landed ? T.timing.liftOut : T.timing.liftIn);
  });

  const ink = () => (accent() ? "text-selected-ink" : "text-glass-fg");
  return (
    <View
      style={{
        zIndex: ticking() || raised() ? 1 : 0,
        opacity: entrance.opacity.mul(leave),
        transform: [{ translateX: slide }, { translateY: entrance.rise }],
      }}
    >
      <If when={raised()}>
        <View
          class="absolute bg-glass-fill"
          style={{
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            borderRadius: T.radius.row,
            borderCurve: "continuous",
            opacity: lift,
            boxShadow: [{ x: 0, y: 8, blur: 24, color: token("glass-shadow") }],
          }}
        />
      </If>
      <View
        testID={`todo:${todo().text}`}
        role="button"
        accessibilityLabel={t("todo.row", { text: todo().text, note: todo().note })}
        accessibilityState={{ selected: isSelected() }}
        onPress={() => activate(props.item.index)}
        onMouseEnter={() => selected.set(props.item.index)}
        class="flex-row items-center"
        classList={{
          "bg-primary/12": accent(),
          "bg-glass-hover": isSelected() && T.selection !== "fill",
        }}
        style={{ height: T.size.todoRow, gap: 11, paddingHorizontal: 14, borderRadius: T.radius.row, borderCurve: "continuous" }}
      >
        <If when={T.selection === "bar" && isSelected()}>
          <View class="absolute bg-primary" style={{ left: 2, top: T.size.todoRow / 2 - 8, width: 3, height: 16, borderRadius: 2 }} />
        </If>
        <TodoCheck
          testID={`check:${todo().text}`}
          checked={ticking() || todo().done}
          label={t("todo.tick", { text: todo().text })}
          onCheck={() => checkTodo(todo())}
          size={18}
        />
        <View class="flex-1 flex-row items-baseline" style={{ minWidth: 0, gap: 9 }}>
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text class={ink()} style={{ numberOfLines: 1, fontSize: T.type.todo, opacity: dim }}>
              {todo().text}
            </Text>
            <StrikeLine progress={strike} class={accent() ? "bg-selected-ink" : "bg-glass-fg"} opacity={dim} />
          </View>
          <Text class={accent() ? "text-selected-muted" : "text-glass-muted"} style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 0, opacity: dim }}
          >
            {todo().note}
          </Text>
        </View>
        <DueButton item={props.item} selected={isSelected()} />
      </View>
    </View>
  );
}

/**
 * The row's due time as a button that opens the reminder time picker under it; without a time, an alarm that
 * adds one, shown while the row is selected (the picker opens there for ⌘K's "Add Reminder…" too).
 */
function DueButton(props: { item: TodoRowItem; selected: boolean }) {
  const todo = () => props.item.todo;
  const key = props.item.key;
  let label: ViewRef | undefined;
  cleanup(() => clearTodoAnchor(key, label));
  return (
    <View
      testID={`due:${todo().text}`}
      ref={(r) => {
        label = r;
        setTodoAnchor(key, r);
      }}
      role="button"
      accessibilityLabel={todo().due ? t("todo.due_change", { text: todo().text }) : t("actions.due_add")}
      tooltip={todo().due ? undefined : t("actions.due_add")}
      onPress={() => openTodoDue(todo())}
      hitSlop={4}
      class="active:opacity-70"
      style={{ borderRadius: T.radius.chip, borderCurve: "continuous" }}
    >
      <If
        when={todo().due}
        else={
          <If when={props.selected}>
            <View class="hover:bg-glass-hover" style={{ padding: 4, borderRadius: T.radius.chip }}>
              <Icon name="alarm" size={13} tint={token("glass-muted")} />
            </View>
          </If>
        }
      >
        <DueChip todo={todo()} group={props.item.group} />
      </If>
    </View>
  );
}

/** A due chip's label flips to a new time: the old one lifts out, the new one springs up from below. */
const CHIP_FLIP: Flip = { lift: 8, out: T.timing.flip.chipOut, rise: 8, in: T.timing.flip.chipIn, spring: T.spring.chip };

/** A to-do's due time as a small chip (red once it is past; its label flips to a new time); nothing without one. */
export function DueChip(props: { todo: Todo; group: TodoGroup | null; size?: number }) {
  const due = () => parseDue(props.todo.due);
  const late = () => !props.todo.done && (due()?.getTime() ?? Infinity) < now();
  const fill = () => (late() ? "bg-late/13" : "bg-due/13");
  const ink = () => (late() ? "text-late" : "text-due");
  const tint = () => (late() ? token("late") : token("due"));
  const size = () => props.size ?? T.type.meta;
  return (
    <If when={due()}>
      {(d: () => Date) => (
        <View
          class={`flex-row items-center ${fill()}`}
          style={{
            gap: size() * 0.28,
            paddingVertical: size() * 0.3,
            paddingHorizontal: size() * 0.55,
            borderRadius: T.radius.chip,
            borderCurve: "continuous",
          }}
          tooltip={t("todo.due_tip", { when: dueLabel(d(), null, new Date(now())) })}
        >
          <Icon name="alarm" size={size() * 1.05} tint={tint()} />
          <FlipText
            text={dueLabel(d(), props.group, new Date(now()))}
            flip={CHIP_FLIP}
            class={`font-medium ${ink()}`}
            style={{ fontSize: size(), fontVariant: ["tabular-nums"] }}
          />
        </View>
      )}
    </If>
  );
}
