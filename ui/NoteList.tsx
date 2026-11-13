// The list under the search field: today's to-dos, the notes that match,
// and "new note" for a title no note has. With a note open the same rows
// narrow into a sidebar of titles. Rows drop in one after another as the
// list opens; filtering and the arrow keys change it without motion.
import { Animated, computed, createAnimatedValue, effect, reduceMotion, Text, token, untracked, View } from "nsh";
import { activate, allTodos, arriving, listEntrance, now, rows, selected, stage, type Row } from "../app/store";
import { plainSnippet } from "../app/tasks";
import { age, hm, todaySummary, type TodaySummary } from "../app/time";
import { Icon, type IconName } from "./icons";
import { springConfig } from "./motion";
import { Highlight, Keycaps } from "./parts";
import { T } from "./tokens";

type NoteRow = Extract<Row, { kind: "note" }>;
type CreateRow = Extract<Row, { kind: "create" }>;

const rowKey = (r: Row) => (r.kind === "note" ? `n:${r.meta.title}` : r.kind);

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

  // The list opening: each row drops in 28 ms after the one above it.
  effect(() => {
    if (!listEntrance()) return;
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

  // A note Claude just wrote: a ring in Claude's orange that fades.
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
      onPress={() => activate(props.index)}
      onMouseEnter={() => {
        if (untracked(stage) !== "editor") selected.set(props.index);
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
        class="absolute inset-0 border-2 border-claude"
        style={{ borderRadius: T.radius.row, opacity: glow, pointerEvents: "none" }}
      />
      <If when={T.selection === "bar" && isSelected()}>
        <View class="absolute bg-primary" style={{ left: 2, top: height() / 2 - 8, width: 3, height: 16, borderRadius: 2 }} />
      </If>
      <RowIcon row={props.row} onAccent={onAccent()} />
      <View class="flex-1" style={{ minWidth: 0 }}>
        <If when={props.row.kind === "summary"}>
          <Text class={`font-semibold ${title()}`} style={{ numberOfLines: 1, fontSize: T.type.row }}>
            {summary().left ? `今天 ${summary().left} 件待办` : "今天没有待办"}
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
              <Highlight
                text={row().meta.title}
                terms={row().terms}
                selected={onAccent()}
                size={T.type.row}
                class={`font-semibold ${title()}`}
              />
              <If when={!props.compact}>
                <Highlight
                  text={plainSnippet(row().snippet) || "空白笔记"}
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
              <Text class={`font-medium ${title()}`} style={{ numberOfLines: 1, fontSize: T.type.row }}>
                {`新建「${row().title}」`}
              </Text>
              <If when={!props.compact}>
                <Text class={sub()} style={{ numberOfLines: 1, fontSize: T.type.snippet }}>
                  回车直接开始写
                </Text>
              </If>
            </>
          )}
        </If>
      </View>
      <If when={!props.compact}>
        <If when={props.row.kind === "summary"}>
          <Dots done={summary().dots} onAccent={onAccent()} />
        </If>
        <If when={note()}>
          {(row: () => NoteRow) => (
            <View class="flex-row items-center" style={{ gap: 6 }}>
              <If when={row().meta.source === "claude"}>
                <Text class={onAccent() ? "text-on-accent-muted" : "text-claude"} style={{ fontSize: T.type.meta }}>
                  Claude
                </Text>
              </If>
              <Text class={sub()} style={{ fontSize: T.type.meta, fontVariant: ["tabular-nums"] }}>
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

/** The row's icon tile: a document, Claude's spark, the to-do list, or a plus. */
function RowIcon(props: { row: Row; onAccent: boolean }) {
  const claude = () => props.row.kind === "note" && props.row.meta.source === "claude";
  const tile = () =>
    props.onAccent
      ? "bg-on-accent-fill"
      : claude()
        ? "bg-claude/20"
        : props.row.kind === "summary"
          ? "bg-primary/15"
          : "bg-glass-hover";
  const tint = () =>
    props.onAccent
      ? token("on-accent")
      : claude()
        ? token("claude")
        : props.row.kind === "summary"
          ? token("primary")
          : token("glass-fg");
  const name = (): IconName =>
    props.row.kind === "summary" ? "list" : props.row.kind === "create" ? "plus" : claude() ? "spark" : "doc";
  return (
    <View
      class={`items-center justify-center ${tile()}`}
      style={{ width: T.size.rowIcon, height: T.size.rowIcon, borderRadius: T.radius.row / 2, borderCurve: "continuous" }}
    >
      <Icon name={name()} size={16} tint={tint()} />
    </View>
  );
}

/** The summary row's second line: what is overdue, and what comes next. */
function summaryLine(s: TodaySummary): string {
  if (!s.left) return s.late ? `${s.late} 件已过期` : "今天的都做完了";
  const parts: string[] = [];
  if (s.late) parts.push(`${s.late} 件已过期`);
  if (s.next) parts.push(`下一件 ${hm(s.next.due)} ${s.next.text}`);
  return parts.join(" · ") || `回车查看全部待办`;
}

/** Today's to-dos as dots: filled for the done ones. */
function Dots(props: { done: boolean[]; onAccent: boolean }) {
  const filled = () => (props.onAccent ? "bg-on-accent" : "bg-primary");
  const empty = () => (props.onAccent ? "border border-on-accent-muted" : "border border-glass-muted");
  return (
    <View
      class="flex-row items-center"
      style={{ gap: 4 }}
      accessibilityLabel={`今天 ${props.done.length} 件，做完 ${props.done.filter(Boolean).length} 件`}
    >
      <Each of={props.done} key="index">
        {(done) => <View class={done() ? filled() : empty()} style={{ width: 7, height: 7, borderRadius: 3.5 }} />}
      </Each>
    </View>
  );
}
