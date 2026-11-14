// The settings window's controls, macOS 26's in look: a switch, a capsule
// segmented control, a pop-up button, a push button and a time field. Each
// is an `nsh/base` component (behavior, focus, keys, accessibility), drawn
// from the theme's tokens, so they follow the appearance and the theme's
// accent. Motion is the app's springs (`ui/motion.ts`).
import { createAnimatedValue, effect, Text, token, untracked, View, type JSX } from "nsh";
import { Button, Select, Switch, Tab, Tabs, TimeField } from "nsh/base";
import { Icon, type IconName } from "./icons";
import { springTo } from "./motion";
import { fade } from "./themes";
import { T } from "./tokens";

/** The type of the settings: macOS's 13-point controls, 11-point captions. */
export const FORM = { label: 13, hint: 11, control: 13, height: 24, radius: 6 } as const;

/** A switch: 34 × 20, a white knob that springs across, the track in the accent when on. */
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
      trackClass={`bg-switch-off checked:bg-primary transition-colors ${fade()}`}
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

/** A capsule segmented control: a sunk track, the selected segment a raised thumb that springs to it (macOS 26). */
export function Segmented<V extends string>(props: {
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  testID?: string;
}) {
  return (
    <Tabs
      testID={props.testID}
      accessibilityLabel={props.label}
      class={`flex-row bg-control ${fade()}`}
      style={{ height: FORM.height, padding: 2, borderRadius: FORM.height / 2 }}
      indicatorClass={`bg-thumb border border-group-edge ${fade()}`}
      indicatorStyle={{
        top: 2,
        bottom: 2,
        borderRadius: (FORM.height - 4) / 2,
        boxShadow: [{ x: 0, y: 1, blur: 3, color: "#00000026" }],
      }}
    >
      <Each of={[...props.options]} key={(o) => o.value}>
        {(option) => (
          <Tab
            testID={props.testID ? `${props.testID}:${option().value}` : undefined}
            selected={props.value === option().value}
            onPress={() => {
              if (option().value !== props.value) props.onChange(option().value);
            }}
            class="items-center justify-center"
            style={{ paddingHorizontal: 12, minWidth: 64 }}
          >
            <Text
              class={props.value === option().value ? "text-window-fg font-medium" : "text-window-muted"}
              style={{ fontSize: 12, numberOfLines: 1 }}
            >
              {option().label}
            </Text>
          </Tab>
        )}
      </Each>
    </Tabs>
  );
}

/** A pop-up button: the choice and a pair of chevrons; its menu marks the choice with a check, as macOS's do. */
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
      popupClass="bg-window border border-window-line"
      popupStyle={{
        padding: 5,
        minWidth: 180,
        borderRadius: 10,
        borderCurve: "continuous",
        boxShadow: [{ x: 0, y: 10, blur: 30, color: "#0000003d" }],
      }}
      itemClass="text-window-fg focus:bg-primary focus:text-on-accent"
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
          class={`flex-row items-center bg-control border border-window-line hover:bg-window-line ${fade()}`}
          style={{ height: FORM.height, gap: 6, paddingLeft: 10, paddingRight: 5, borderRadius: FORM.radius, borderCurve: "continuous" }}
        >
          <Text class="text-window-fg" style={{ fontSize: FORM.control, numberOfLines: 1 }}>
            {title()}
          </Text>
          <Icon name="chevrons" size={13} tint={token("window-muted")} />
        </View>
      }
    />
  );
}

/** A push button, its label (and an icon) in the window's text color; `primary` fills it with the accent. */
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
        props.primary ? "bg-primary border-primary active:opacity-80" : "bg-control border-window-line hover:bg-window-line active:opacity-70"
      }`}
      disabledStyle={{ opacity: 0.4 }}
      style={{ height: FORM.height, gap: 5, paddingHorizontal: 10, borderRadius: FORM.radius, borderCurve: "continuous" }}
    >
      <If when={props.icon}>
        {(name) => <Icon name={name()} size={13} tint={props.primary ? token("on-accent") : token("window-fg")} />}
      </If>
      <Text class={props.primary ? "text-on-accent font-medium" : "text-window-fg"} style={{ fontSize: FORM.control, numberOfLines: 1 }}>
        {props.label}
      </Text>
    </Button>
  );
}

/** A time of day typed or stepped (`HH:mm`), the segment being edited in the accent. */
export function TimeInput(props: { value: string; onChange: (value: string) => void; label: string; hourCycle: "h12" | "h23"; testID?: string }) {
  return (
    <TimeField
      testID={props.testID}
      value={props.value}
      hourCycle={props.hourCycle}
      onChange={({ value }) => props.onChange(value)}
      accessibilityLabel={props.label}
      class={`flex-row items-center bg-control border border-window-line ${fade()}`}
      style={{ height: FORM.height, paddingHorizontal: 7, borderRadius: FORM.radius, borderCurve: "continuous" }}
      segmentClass="text-window-fg focus:bg-primary focus:text-on-accent"
      segmentStyle={{ fontSize: FORM.control, fontVariant: ["tabular-nums"], paddingHorizontal: 2, borderRadius: 3 }}
      separatorClass="text-window-muted"
      separatorStyle={{ fontSize: FORM.control }}
    />
  );
}

/** A small caption under a row's label. */
export function Hint(props: { children: JSX.Element; tone?: "muted" | "late" }) {
  return (
    <Text class={props.tone === "late" ? "text-late" : "text-window-muted"} style={{ fontSize: FORM.hint, lineHeight: 14 }}>
      {props.children}
    </Text>
  );
}
