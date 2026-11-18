// The settings window's controls, macOS 26's in look: a switch, a pop-up
// button, a push button and a time field. Each
// is an `nsh/base` component (behavior, focus, keys, accessibility), drawn
// from the `sys-*` tokens, which no Jot theme overrides: they follow the
// appearance, in the system's accent, as macOS's own settings do. Only a
// `primary` push button (the panel's Undo) takes the theme's accent. Motion
// is the app's springs (`ui/motion.ts`).
import { createAnimatedValue, effect, Text, token, untracked, View, type JSX } from "nsh";
import { Button, Select, Switch, TimeField } from "nsh/base";
import { Icon, type IconName } from "./icons";
import { springTo } from "./motion";
import { fade } from "./themes";
import { T } from "./tokens";

/** The type of the settings: macOS's 13-point controls, 11-point captions. */
export const FORM = { label: 13, hint: 11, control: 13, height: 24, radius: 6 } as const;

/** A switch: 34 × 20, a white knob that springs across, the track in the system's accent when on. */
export function MacSwitch(props: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string; testID?: string }) {
  const travel = 14;
  const x = createAnimatedValue(props.checked ? travel : 0);
  effect(() => {
    const to = props.checked ? travel : 0;
    untracked(() => springTo(x, to, T.spring.summon));
  });
  return (
    <Switch
      testID={props.testID}
      checked={props.checked}
      disabled={props.disabled}
      accessibilityLabel={props.label}
      onChange={({ checked }) => props.onChange(checked)}
      hitSlop={6}
      disabledStyle={{ opacity: 0.4 }}
      trackClass={`bg-sys-switch-off checked:bg-sys-accent transition-colors ${fade()}`}
      trackStyle={{ width: 34, height: 20, borderRadius: 10, padding: 2 }}
      thumbStyle={{
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: "#ffffff",
        boxShadow: [{ x: 0, y: 1, blur: 2.5, color: "#0000003d" }],
        transform: [{ translateX: x }],
      }}
    />
  );
}

/** A pop-up button: the choice and a pair of chevrons on an accent plate; its menu marks the choice with a check, as macOS's do. */
export function PopupButton<V extends string>(props: {
  items: readonly { value: V; title: string }[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  testID?: string;
}) {
  const title = () => props.items.find((i) => i.value === props.value)?.title ?? "";
  return (
    <Select
      testID={props.testID}
      items={props.items.map((i) => ({ value: i.value, title: i.title }))}
      value={props.value}
      onChange={({ value }) => {
        if (value !== null) props.onChange(value as V);
      }}
      accessibilityLabel={props.label}
      offset={4}
      align="end"
      popupClass="bg-sys-group border border-sys-line"
      popupStyle={{
        padding: 5,
        minWidth: 180,
        borderRadius: 10,
        borderCurve: "continuous",
        boxShadow: [{ x: 0, y: 10, blur: 30, color: "#0000003d" }],
      }}
      itemClass="text-sys-fg focus:bg-sys-accent focus:text-white"
      itemStyle={{ height: 24, paddingHorizontal: 8, borderRadius: 5, fontSize: FORM.control, justifyContent: "center" }}
      renderItem={(item) => (
        <View class="flex-row items-center" style={{ gap: 6 }}>
          {/* A text check, not an icon: it takes the row's color, white on the highlighted row. */}
          <Text class="font-semibold" style={{ width: 14, fontSize: 12 }}>
            {item.value === props.value ? "✓" : ""}
          </Text>
          <Text style={{ fontSize: FORM.control, numberOfLines: 1 }}>{item.title}</Text>
        </View>
      )}
      trigger={
        <View
          class={`flex-row items-center bg-sys-button border border-sys-button-edge hover:opacity-90 ${fade()}`}
          style={{ height: FORM.height - 2, gap: 6, paddingLeft: 9, paddingRight: 3, borderRadius: FORM.radius, borderCurve: "continuous", boxShadow: [{ x: 0, y: 0.5, blur: 1, color: "#00000014" }] }}
        >
          <Text class="text-sys-fg" style={{ fontSize: FORM.control, numberOfLines: 1 }}>
            {title()}
          </Text>
          <View class="items-center justify-center bg-sys-accent" style={{ width: 16, height: 16, borderRadius: 4 }}>
            <Icon name="chevrons" size={12} tint="#ffffff" />
          </View>
        </View>
      }
    />
  );
}

/** A push button, its label (and an icon) in the window's text color; `primary` fills it with the theme's accent. */
export function PushButton(props: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  primary?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Button
      testID={props.testID}
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityLabel={props.accessibilityLabel}
      class={`flex-row items-center border ${fade()} ${
        props.primary ? "bg-primary border-primary active:opacity-80" : "bg-sys-button border-sys-button-edge hover:opacity-90 active:opacity-70"
      }`}
      disabledStyle={{ opacity: 0.4 }}
      style={{ height: FORM.height, gap: 5, paddingHorizontal: 10, borderRadius: FORM.radius, borderCurve: "continuous" }}
    >
      <If when={props.icon}>
        {(name) => <Icon name={name()} size={13} tint={props.primary ? token("on-accent") : token("sys-fg")} />}
      </If>
      <Text class={props.primary ? "text-on-accent font-medium" : "text-sys-fg"} style={{ fontSize: FORM.control, numberOfLines: 1 }}>
        {props.label}
      </Text>
    </Button>
  );
}

/** A time of day typed or stepped (`HH:mm`), the segment being edited in the system's accent. */
export function TimeInput(props: { value: string; onChange: (value: string) => void; label: string; hourCycle: "h12" | "h23"; testID?: string }) {
  return (
    <TimeField
      testID={props.testID}
      value={props.value}
      hourCycle={props.hourCycle}
      onChange={({ value }) => props.onChange(value)}
      accessibilityLabel={props.label}
      class={`flex-row items-center bg-sys-button border border-sys-button-edge ${fade()}`}
      style={{ height: FORM.height - 2, paddingHorizontal: 7, borderRadius: FORM.radius, borderCurve: "continuous" }}
      segmentClass="text-sys-fg focus:bg-sys-accent focus:text-white"
      segmentStyle={{ fontSize: FORM.control, fontVariant: ["tabular-nums"], paddingHorizontal: 2, borderRadius: 3 }}
      separatorClass="text-sys-muted"
      separatorStyle={{ fontSize: FORM.control }}
    />
  );
}

/** A small caption under a row's label. */
export function Hint(props: { children: JSX.Element; tone?: "muted" | "late" }) {
  return (
    <Text class={props.tone === "late" ? "text-sys-red" : "text-sys-muted"} style={{ fontSize: FORM.hint, lineHeight: 14 }}>
      {props.children}
    </Text>
  );
}
