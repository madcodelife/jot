// The to-do view ("待办" or "/todo" in the field): every open to-do by
// group (overdue, today, tomorrow, later, no time), each with its note and
// its due time. Ticking one shows it checked for a moment, then its row
// folds away (the store animates the fold).
import { Scroll, Text, token, View } from "nsh";
import type { Todo } from "jot/native";
import { activate, checking, checkTodo, now, selected, todoItems, type TodoItem } from "../app/store";
import { t } from "nsh/i18n";
import { dueLabel, groupLabel, parseDue, type TodoGroup } from "../app/time";
import { Icon } from "./icons";
import { TodoCheck } from "./parts";
import { T } from "./tokens";

type HeaderItem = Extract<TodoItem, { kind: "header" }>;
type TodoRowItem = Extract<TodoItem, { kind: "todo" }>;

/** How tall the to-do view is for its items (it scrolls past `T.size.todoMaxHeight`). */
export function todoViewHeight(items: readonly TodoItem[]): number {
  if (!items.length) return 93;
  const content = items.reduce((h, i) => h + (i.kind === "header" ? T.size.groupHeader : T.size.todoRow), 7);
  return Math.min(content, T.size.todoMaxHeight);
}

/** The view. */
export function TodoView() {
  return (
    <If
      when={todoItems().length > 0}
      else={
        <View testID="todos-empty" class="items-center justify-center" style={{ height: 93 }}>
          <Text class="text-glass-muted" style={{ fontSize: 14.5 }}>
            {t("todo.empty")}
          </Text>
        </View>
      }
    >
      <Scroll testID="todos" class="flex-1">
        <View style={{ paddingTop: 7, paddingHorizontal: 8 }}>
          <Each of={todoItems()} key={(i) => (i.kind === "header" ? `h:${i.group}` : i.key)}>
            {(item) => (
              <>
                <If when={asHeader(item())}>{(h: () => HeaderItem) => <GroupHeader group={h().group} count={h().count} />}</If>
                <If when={asTodo(item())}>{(t: () => TodoRowItem) => <TodoRow item={t()} />}</If>
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

function GroupHeader(props: { group: TodoGroup; count: number }) {
  return (
    <View
      role="header"
      class="flex-row items-end"
      style={{ height: T.size.groupHeader, gap: 7, paddingHorizontal: 14, paddingBottom: 4 }}
    >
      <Text class={`font-semibold ${props.group === "late" ? "text-late" : "text-glass-muted"}`} style={{ fontSize: 12 }}>
        {groupLabel(props.group)}
      </Text>
      <Text
        class={props.group === "late" ? "text-late" : "text-glass-muted"}
        style={{ fontSize: 12, fontVariant: ["tabular-nums"] }}
      >
        {String(props.count)}
      </Text>
    </View>
  );
}

function TodoRow(props: { item: TodoRowItem }) {
  const todo = () => props.item.todo;
  const isSelected = () => selected() === props.item.index;
  const onAccent = () => isSelected() && T.selection === "fill";
  const ticking = () => checking().has(props.item.key);
  return (
    <View
      testID={`todo:${todo().text}`}
      role="button"
      accessibilityLabel={t("todo.row", { text: todo().text, note: todo().note })}
      accessibilityState={{ selected: isSelected() }}
      onPress={() => activate(props.item.index)}
      onMouseEnter={() => selected.set(props.item.index)}
      class="flex-row items-center"
      classList={{
        "bg-primary": onAccent(),
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
        onAccent={onAccent()}
      />
      <View class="flex-1 flex-row items-baseline" style={{ minWidth: 0, gap: 9 }}>
        <Text
          class={`font-medium ${onAccent() ? "text-on-accent" : "text-glass-fg"}`}
          style={{ numberOfLines: 1,
            flexShrink: 1,
            fontSize: 15,
            textDecorationLine: ticking() ? "line-through" : "none",
            opacity: ticking() ? 0.6 : 1,
          }}
        >
          {todo().text}
        </Text>
        <Text class={onAccent() ? "text-on-accent-muted" : "text-glass-muted"} style={{ numberOfLines: 1, fontSize: 12, flexShrink: 0 }}>
          {todo().note}
        </Text>
      </View>
      <DueChip todo={todo()} group={props.item.group} onAccent={onAccent()} />
    </View>
  );
}

/** A to-do's due time as a small chip (red once it is past); nothing without one. */
export function DueChip(props: { todo: Todo; group: TodoGroup | null; onAccent: boolean; size?: number }) {
  const due = () => parseDue(props.todo.due);
  const late = () => !props.todo.done && (due()?.getTime() ?? Infinity) < now();
  const fill = () => (props.onAccent ? "bg-on-accent-fill" : late() ? "bg-late/13" : "bg-due/13");
  const ink = () => (props.onAccent ? "text-on-accent" : late() ? "text-late" : "text-due");
  const tint = () => (props.onAccent ? token("on-accent") : late() ? token("late") : token("due"));
  const size = () => props.size ?? 12;
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
          <Text class={`font-semibold ${ink()}`} style={{ fontSize: size(), fontVariant: ["tabular-nums"] }}>
            {dueLabel(d(), props.group, new Date(now()))}
          </Text>
        </View>
      )}
    </If>
  );
}
