// The action panel (⌘K, or a right click on a row), as Raycast's: a glass
// card at the panel's bottom right with a filter field of its own, the
// actions of the row in focus below it (the shared list in `app/actions`),
// each with its keys. ↑↓ choose, Return runs, Escape or ⌘K again closes,
// typing filters.
import { Animated, computed, createAnimatedValue, effect, keymap, reduceMotion, Text, token, untracked, View } from "nsh";
import { Input } from "nsh/base";
import { t } from "nsh/i18n";
import { actionQuery, actionSelected, actionsTarget, closeActions, filteredActions, runAction, type Action } from "../app/actions";
import { focusRequest, stage } from "../app/store";
import { springConfig } from "./motion";
import { Keycaps } from "./parts";
import { fade } from "./themes";
import { T, materialFill, materialStyle } from "./tokens";

/** The panel's items for the target and filter (a separator before the destructive ones). */
const items = computed<Action[]>(() => {
  const target = actionsTarget();
  return target ? filteredActions(target, actionQuery()) : [];
});

/** How tall the action panel is for `list`. */
export function actionsHeight(list: readonly Action[]): number {
  const separators = list.some((a) => a.destructive) && list.some((a) => !a.destructive) ? 1 : 0;
  const body = list.length ? list.length * T.size.actionRow + separators * T.size.actionSeparator : T.size.actionRow;
  return T.size.actionsField + 1 + body + 12;
}

/** The panel, placed by the caller (`left`, `top`); it closes when the panel hides. */
export function ActionPanel(props: { left: number; top: number; returnFocus: "field" | "editor" }) {
  const opacity = createAnimatedValue(0);
  const scale = createAnimatedValue(0.96);
  const lift = createAnimatedValue(6);

  effect(() => {
    if (stage() === "hidden") closeActions();
  });
  // In: a quick fade with the panel's summon spring; with reduced motion, the fade alone.
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

  const close = () => {
    closeActions();
    focusRequest.set({ target: props.returnFocus });
  };
  const run = (item: Action | undefined) => {
    if (!item) return;
    // The action may want the focus itself (rename, the reminder time picker); the field gets it otherwise.
    if (item.id !== "rename" && item.id !== "due") focusRequest.set({ target: props.returnFocus });
    runAction(item);
  };
  const step = (delta: number) => {
    const count = untracked(items).length;
    if (count) actionSelected.set((untracked(actionSelected) + delta + count) % count);
  };
  // Newer than the panel's bindings, so these win while the action panel shows.
  keymap.bind(
    {
      escape: close,
      [T.keys.actions]: close,
      up: () => step(-1),
      down: () => step(1),
    },
    { when: "always", repeat: true },
  );
  // Typing filters: the first match is selected.
  effect(() => {
    actionQuery();
    untracked(() => actionSelected.set(0));
  });

  return (
    <>
      {/* A press anywhere else closes it, as a menu. */}
      <View testID="actions-backdrop" class="absolute inset-0" style={{ backgroundColor: "transparent" }} onPress={close} />
      <View
        testID="actions"
        role="menu"
        accessibilityLabel={t("actions.label")}
        class={`absolute ${materialFill()} border border-glass-edge ${fade()}`}
        style={{
          ...materialStyle(),
          left: props.left,
          top: props.top,
          width: T.size.actionsWidth,
          height: actionsHeight(items()),
          borderRadius: T.radius.actions,
          borderCurve: "continuous",
          overflow: "hidden",
          boxShadow: [{ x: 0, y: 12, blur: 32, color: token("glass-shadow") }],
          opacity,
          transform: [{ translateY: lift }, { scale }],
        }}
      >
        <View class="justify-center border-b border-glass-line" style={{ height: T.size.actionsField, paddingHorizontal: 14 }}>
          <Input
            testID="actions-filter"
            class="text-glass-fg"
            style={{ fontSize: T.type.snippet + 1, backgroundColor: "transparent" }}
            value={actionQuery()}
            placeholder={t("actions.filter")}
            accessibilityLabel={t("actions.filter")}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            submitBehavior="submit"
            onChange={({ value }) => actionQuery.set(value)}
            onSubmit={() => run(untracked(items)[untracked(actionSelected)])}
          />
        </View>
        <View style={{ padding: 6 }}>
          <If
            when={items().length > 0}
            else={
              <View class="justify-center" style={{ height: T.size.actionRow, paddingHorizontal: 10 }}>
                <Text class="text-glass-muted" style={{ fontSize: T.type.snippet }}>
                  {t("actions.none")}
                </Text>
              </View>
            }
          >
            <Each of={items()} key={(a) => a.id}>
              {(item, index) => (
                <>
                  <If when={item().destructive && index() > 0}>
                    <View class="bg-glass-line" style={{ height: 1, marginVertical: (T.size.actionSeparator - 1) / 2, marginHorizontal: 8 }} />
                  </If>
                  <ActionRow item={item()} index={index()} onRun={() => run(item())} />
                </>
              )}
            </Each>
          </If>
        </View>
      </View>
    </>
  );
}

function ActionRow(props: { item: Action; index: number; onRun: () => void }) {
  const isSelected = () => actionSelected() === props.index;
  const onAccent = () => isSelected() && T.selection === "fill";
  const ink = () => (onAccent() ? "text-on-accent" : props.item.destructive ? "text-danger" : "text-glass-fg");
  return (
    <View
      testID={`action:${props.item.id}`}
      role="menuitem"
      accessibilityState={{ selected: isSelected() }}
      onPress={props.onRun}
      onMouseEnter={() => actionSelected.set(props.index)}
      class="flex-row items-center"
      classList={{
        "bg-primary": onAccent() && !props.item.destructive,
        "bg-danger": onAccent() && !!props.item.destructive,
        "bg-glass-hover": isSelected() && T.selection !== "fill",
      }}
      style={{ height: T.size.actionRow, gap: 10, paddingHorizontal: 10, borderRadius: T.radius.action, borderCurve: "continuous" }}
    >
      <Text class={`flex-1 ${ink()}`} style={{ numberOfLines: 1, fontSize: T.type.snippet + 0.5 }}>
        {props.item.label}
      </Text>
      <Keycaps keys={props.item.keys} onAccent={onAccent()} />
    </View>
  );
}
