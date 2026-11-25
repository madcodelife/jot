// The reminder time picker, one for the open note's time chip and the
// to-do view's due label (and ⇧⌘D / the action panel on either): a glass
// card like the action panel's, anchored to the chip or the label. Quick
// choices first, as Things, Reminders and Raycast offer them (in an hour,
// this evening, tomorrow morning, next Monday morning; past ones hidden),
// then a calendar and a time field for any time, set with ⌘↩, and "Remove
// Reminder" when there is one. It opens with the first choice focused:
// ↑↓ move among the choices, Return picks, Tab goes on to the calendar
// (its arrows move the day) and the time field, Escape closes.
import { Animated, createAnimatedValue, effect, keymap, localeSettings, Overlay, reduceMotion, signal, Text, token, untracked, View, type ViewRef } from "nsh";
import { Button, Calendar, TimeField, type CalendarEntry } from "nsh/base";
import { t } from "nsh/i18n";
import { closeDuePicker, duePicker, pickDue, type DuePickerState } from "../due";
import { shownLanguage } from "../i18n";
import { defaultTime } from "../settings";
import { now, opened, stage, todoMode } from "../store";
import { dueLabel, isoDay, parseDue, quickChoices, type QuickChoice } from "../time";
import { Icon } from "./icons";
import { springConfig } from "./motion";
import { Keycaps } from "./parts";
import { fade } from "./themes";
import { keyCaps, materialEdge, materialFill, materialStyle, T } from "./tokens";

/** A day of the calendar: its side, in points. */
const CELL = 28;
/**
 * The quick choices' column, and the calendar's (its seven days and its padding). The column fits the longest
 * label beside its time whole ("Tomorrow Morning", "Tomorrow 9:00 AM"): at 196 English ones were cut short.
 */
const LIST_WIDTH = 252;
const CALENDAR_PAD = 10;
const CALENDAR_WIDTH = 7 * CELL + CALENDAR_PAD * 2;

/** The picker while it shows (placed in the panel's window, over everything). */
export function DuePicker() {
  return <If when={duePicker()}>{(state) => <Picker state={state()} />}</If>;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hm24 = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** `day` (`YYYY-MM-DD`) at `time` (`HH:mm`), local. */
function at(day: string, time: string): Date {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

function Picker(props: { state: DuePickerState }) {
  const today = new Date(untracked(now));
  const current = parseDue(props.state.due);
  const morning = untracked(defaultTime);
  const choices = quickChoices(today, morning);
  // The calendar and the time start at the time the to-do has, else at the next morning to come.
  const start = current ?? (at(isoDay(today), morning) > today ? at(isoDay(today), morning) : at(isoDay(new Date(today.getTime() + 86_400_000)), morning));
  const day = signal(isoDay(start));
  const time = signal(hm24(start));
  const hourCycle = untracked(localeSettings).hourCycle;
  const twelve = hourCycle === "h12" || hourCycle === "h11";

  /** The rows ↑↓ move among: the quick choices, then "Remove Reminder" when there is one. */
  const rows: (QuickChoice | "remove")[] = [...choices, ...(current ? (["remove"] as const) : [])];
  const refs: (ViewRef | undefined)[] = [];
  const focused = signal<number | null>(null);

  const run = (row: QuickChoice | "remove") => pickDue(row === "remove" ? null : row.at);
  const setCustom = () => pickDue(at(untracked(day), untracked(time)));

  // In: the action panel's motion, a quick fade with the summon spring; with reduced motion, the fade alone.
  const opacity = createAnimatedValue(0);
  const scale = createAnimatedValue(0.96);
  const lift = createAnimatedValue(-4);
  effect(() => {
    untracked(() => {
      if (reduceMotion()) {
        scale.set(1);
        lift.set(0);
        Animated.timing(opacity, { toValue: 1, duration: 120, easing: "easeOut" }).start();
        return;
      }
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 120, easing: "easeOut" }),
        Animated.spring(scale, { toValue: 1, ...springConfig(T.spring.summon) }),
        Animated.spring(lift, { toValue: 0, ...springConfig(T.spring.summon) }),
      ]).start();
    });
  });

  // Newer than the panel's keys, so these win while the picker shows: Escape closes it (not the note), ⌘↩ sets
  // the calendar's day at the field's time (not the caret's tick).
  keymap.bind({ escape: () => closeDuePicker(), "mod+enter": setCustom }, { when: "always" });
  // While a row has the focus, ↑↓ move it (wrapping) and Return picks it; in the calendar the arrows are its own.
  effect(() => {
    const index = focused();
    if (index === null) return;
    const move = (delta: number) => refs[(index + delta + rows.length) % rows.length]?.focus();
    const stop = keymap.bind({ up: () => move(-1), down: () => move(1), enter: () => run(rows[index]) }, { when: "always", repeat: true });
    return stop;
  });

  // The panel hides, the note closes or another opens, the to-do view goes: the picker goes with them.
  const from = { stage: untracked(stage), note: untracked(opened)?.token, todos: untracked(todoMode) };
  effect(() => {
    if (stage() !== from.stage || opened()?.token !== from.note || todoMode() !== from.todos) untracked(closeDuePicker);
  });

  const weekStart = untracked(localeSettings).firstDayOfWeek % 7;

  return (
    <Overlay
      anchor={props.state.anchor ?? undefined}
      placement="bottom"
      align={props.state.target.kind === "todo" ? "end" : "start"}
      offset={6}
      // Inside the panel, as far from its edges as the paper is: the window around it is only the shadow's room.
      margin={T.size.windowMargin + T.size.inset}
      onPressOutside={() => closeDuePicker()}
      onCancel={() => closeDuePicker()}
      // Nothing to anchor to (the chip's box was not to be had): at the panel's foot, as the notices are.
      style={props.state.anchor ? undefined : { left: 0, right: 0, bottom: T.size.windowMargin + 14, alignItems: "center" }}
    >
      <View
        testID="due-picker"
        role="dialog"
        accessibilityLabel={t("due.title")}
        class={`flex-row ${materialFill()} ${materialEdge()} ${fade()}`}
        style={{
          ...materialStyle(),
          borderRadius: T.radius.actions,
          borderCurve: "continuous",
          overflow: "hidden",
          boxShadow: [{ x: 0, y: 12, blur: 32, color: token("glass-shadow") }],
          opacity,
          transform: [{ translateY: lift }, { scale }],
        }}
      >
        {/* The choices: what the to-do has, the quick times, and "Remove Reminder" at the foot. */}
        <View style={{ width: LIST_WIDTH, padding: 6 }}>
          <View style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, gap: 3 }}>
            <Text class="font-semibold text-glass-muted" style={{ fontSize: T.type.meta }}>
              {t("due.title")}
            </Text>
            <Text
              testID="due-current"
              class={current ? "font-semibold text-due" : "text-glass-muted"}
              style={{ numberOfLines: 1, fontSize: T.type.snippet, fontVariant: ["tabular-nums"] }}
            >
              {current ? dueLabel(current, null, today) : t("due.none")}
            </Text>
          </View>
          <Each of={choices} key={(c) => c.id}>
            {(choice, index) => (
              <ChoiceRow
                testID={`due-quick:${choice().id}`}
                label={t(`due.quick.${choice().id}`)}
                detail={dueLabel(choice().at, null, today)}
                chosen={current?.getTime() === choice().at.getTime()}
                focused={focused() === index()}
                nodeRef={(r) => {
                  refs[index()] = r;
                  if (index() === 0) setTimeout(() => r.focus(), 0);
                }}
                onFocus={() => focused.set(index())}
                onBlur={() => focused.update((f) => (f === index() ? null : f))}
                onPress={() => run(choice())}
              />
            )}
          </Each>
          <View class="flex-1" style={{ minHeight: 8 }} />
          <If when={current}>
            <ChoiceRow
              testID="due-remove"
              label={t("due.remove")}
              destructive
              focused={focused() === choices.length}
              nodeRef={(r) => {
                refs[choices.length] = r;
                if (!choices.length) setTimeout(() => r.focus(), 0);
              }}
              onFocus={() => focused.set(choices.length)}
              onBlur={() => focused.update((f) => (f === choices.length ? null : f))}
              onPress={() => run("remove")}
            />
          </If>
        </View>
        <View class="bg-glass-line" style={{ width: 1 }} />
        {/* Any time: a day of the calendar at the field's time, set with the button or ⌘↩. */}
        <View style={{ width: CALENDAR_WIDTH, padding: CALENDAR_PAD, paddingBottom: 8 }}>
          <Calendar
            testID="due-calendar"
            value={day()}
            onChange={({ value }) => {
              if (typeof value === "string") day.set(value);
            }}
            firstDayOfWeek={weekStart}
            disabledMatcher={{ before: isoDay(today) }}
            previousAccessibilityLabel={t("due.previous_month")}
            nextAccessibilityLabel={t("due.next_month")}
            headerStyle={{ marginBottom: 6, justifyContent: "space-between", alignItems: "center" }}
            itemClass="group active:opacity-70"
            renderItem={(item) => <CalendarCell item={item} />}
          />
          <View class="flex-row items-center border-t border-glass-line" style={{ gap: 8, marginTop: 8, paddingTop: 10 }}>
            <Text class="text-glass-muted" style={{ fontSize: T.type.meta }}>
              {t("due.time")}
            </Text>
            <TimeField
              testID="due-time"
              value={time()}
              hourCycle={twelve ? "h12" : "h23"}
              onChange={({ value }) => time.set(value)}
              accessibilityLabel={t("due.time")}
              class="flex-row items-center bg-glass-fg/7 border border-glass-line"
              style={{ height: 26, paddingHorizontal: 6, borderRadius: 7, borderCurve: "continuous" }}
              segmentClass="text-glass-fg focus:bg-primary focus:text-on-accent"
              segmentStyle={{ fontSize: T.type.snippet, fontVariant: ["tabular-nums"], paddingHorizontal: 2, borderRadius: 4 }}
              separatorClass="text-glass-muted"
              separatorStyle={{ fontSize: T.type.snippet }}
            />
            <View class="flex-1" />
            <Button
              testID="due-set"
              accessibilityLabel={t("due.set")}
              onPress={setCustom}
              class="flex-row items-center bg-primary active:opacity-80 focus-visible:border-on-accent border border-transparent"
              style={{ height: 26, gap: 6, paddingLeft: 10, paddingRight: 4, borderRadius: 7, borderCurve: "continuous" }}
            >
              <Text class="font-medium text-on-accent" style={{ fontSize: T.type.snippet }}>
                {t("due.set")}
              </Text>
              <Keycaps keys={keyCaps("mod+enter")} onAccent />
            </Button>
          </View>
        </View>
      </View>
    </Overlay>
  );
}

/** One of the choices: its words and the time it means, in the action panel's rows' look; the keyboard's row filled. */
function ChoiceRow(props: {
  testID: string;
  label: string;
  detail?: string;
  chosen?: boolean;
  destructive?: boolean;
  focused: boolean;
  nodeRef: (r: ViewRef) => void;
  onFocus: () => void;
  onBlur: () => void;
  onPress: () => void;
}) {
  const onAccent = () => props.focused && T.selection === "fill";
  const ink = () => (onAccent() ? "text-on-accent" : props.destructive ? "text-danger" : "text-glass-fg");
  return (
    <View
      testID={props.testID}
      ref={props.nodeRef}
      role="menuitem"
      accessibilityLabel={props.detail ? `${props.label}, ${props.detail}` : props.label}
      accessibilityState={{ selected: props.focused, checked: props.chosen }}
      onPress={props.onPress}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      class="flex-row items-center"
      classList={{
        "bg-primary": onAccent() && !props.destructive,
        "bg-danger": onAccent() && !!props.destructive,
        "bg-glass-hover": props.focused && T.selection !== "fill",
        "hover:bg-glass-hover": !props.focused,
      }}
      style={{ height: T.size.actionRow, gap: 8, paddingHorizontal: 10, borderRadius: T.radius.action, borderCurve: "continuous" }}
    >
      <If when={T.selection === "bar" && props.focused}>
        <View class="absolute bg-primary" style={{ left: 2, top: T.size.actionRow / 2 - 7, width: 3, height: 14, borderRadius: 2 }} />
      </If>
      <Text class={`flex-1 ${ink()}`} style={{ numberOfLines: 1, fontSize: T.type.snippet + 0.5 }}>
        {props.label}
      </Text>
      <If when={props.chosen}>
        <Icon name="check" size={12} tint={onAccent() ? token("on-accent") : token("primary")} />
      </If>
      <If when={props.detail}>
        {(detail) => (
          <Text class={onAccent() ? "text-on-accent-muted" : "text-glass-muted"} style={{ numberOfLines: 1, fontSize: T.type.meta, fontVariant: ["tabular-nums"] }}>
            {detail()}
          </Text>
        )}
      </If>
    </View>
  );
}

const titles = new Map<string, Intl.DateTimeFormat>();
/** A formatter in the language shown, made once per language and options. */
function format(options: Intl.DateTimeFormatOptions) {
  const language = shownLanguage();
  const key = `${language}|${JSON.stringify(options)}`;
  let f = titles.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(language, options);
    titles.set(key, f);
  }
  return f;
}

/**
 * A calendar item on the glass: the month's title ("2026年11月", "November 2026") centered between ghost arrows,
 * one-letter weekdays, and days as Apple's calendars draw them: today's number in the accent, the chosen day
 * filled with it, the other months' days muted, past days faint; the pointer's day on the hover fill, the
 * keyboard's ringed. The year toggle draws nothing: the title opens the month view, which pages through years.
 */
function CalendarCell(props: { item: CalendarEntry }) {
  const item = props.item;
  const kind = item.kind;
  if (kind === "previous" || kind === "next") {
    return (
      <View
        class="items-center justify-center group-hover:bg-glass-hover group-disabled:opacity-40 group-focus-visible:border-primary border border-transparent"
        style={{ width: CELL, height: CELL, borderRadius: T.radius.action, borderCurve: "continuous" }}
      >
        <View style={{ transform: [{ rotate: kind === "previous" ? "180deg" : "0deg" }] }}>
          <Icon name="chevron" size={13} tint={token("glass-fg")} />
        </View>
      </View>
    );
  }
  if (kind === "monthToggle") {
    return (
      <Text
        class="font-semibold text-glass-fg group-selected:text-accent-ink"
        style={{ width: 5 * CELL, textAlign: "center", fontSize: T.type.snippet }}
      >
        {format({ year: "numeric", month: "long" }).format(new Date(item.year, item.month - 1, 1))}
      </Text>
    );
  }
  if (kind === "yearToggle") return <View style={{ width: 0, height: 0 }} />;
  if (kind === "weekday") {
    return (
      <Text class="text-glass-muted" style={{ width: CELL, textAlign: "center", fontSize: 11, paddingBottom: 2 }}>
        {/* 2026-11-15 is a Sunday: `value` counts from it. */}
        {format({ weekday: "narrow" }).format(new Date(2026, 10, 15 + item.value))}
      </Text>
    );
  }
  if (kind === "month" || kind === "year") {
    return (
      <View
        class="items-center justify-center group-hover:bg-glass-hover group-aria-selected:bg-primary group-disabled:opacity-40"
        style={{ minWidth: (7 * CELL) / (kind === "month" ? 3 : 5), height: CELL + 4, marginTop: 4, borderRadius: T.radius.action, borderCurve: "continuous" }}
      >
        <Text class="text-glass-fg group-aria-selected:text-on-accent" style={{ fontSize: T.type.snippet }}>
          {kind === "month" ? format({ month: "short" }).format(new Date(2026, item.value - 1, 1)) : String(item.value)}
        </Text>
      </View>
    );
  }
  const ink = item.today ? "text-accent-ink font-semibold" : item.outside ? "text-glass-muted" : "text-glass-fg";
  return (
    <View
      class={
        "items-center justify-center border border-transparent group-hover:bg-glass-hover group-aria-selected:bg-primary " +
        "group-focus-visible:border-primary group-disabled:bg-transparent"
      }
      style={{ width: CELL, height: CELL, borderRadius: CELL / 2 }}
    >
      <Text
        class={`${ink} group-aria-selected:text-on-accent group-aria-selected:font-semibold group-disabled:opacity-40`}
        style={{ fontSize: T.type.snippet, fontVariant: ["tabular-nums"] }}
      >
        {String(item.value)}
      </Text>
    </View>
  );
}
