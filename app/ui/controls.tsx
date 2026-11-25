// The settings window's controls, macOS 26's in look: a switch, a pop-up
// button, a push button and a time field. Each
// is an `nsh/base` component (behavior, focus, keys, accessibility), drawn
// from the `sys-*` tokens, which no Jot theme overrides: they follow the
// appearance, in the system's accent, as macOS's own settings do (a
// `primary` push button too: the settings are the system's, the themes only
// dress the panel). Motion is the app's springs (`app/ui/motion.ts`).
import { createAnimatedValue, effect, Text, token, untracked, View, type JSX } from "nsh";
import { Button, Select, Switch, TimeField } from "nsh/base";
import { Icon, type IconName } from "./icons";
import { springTo } from "./motion";
import { fade } from "./themes";
import { T } from "./tokens";

/** The type of the settings: macOS's 13-point controls, 11-point captions. */
export const FORM = { label: 13, hint: 11, control: 13, height: 24, radius: 6 } as const;

/**
 * A switch as macOS 26's settings draw one (measured): a 36 × 16 track, a white 21 × 12 capsule knob 2 in from its
 * top and bottom and 1.5 from its ends that springs across, the track a faint fill of the label color when off and
 * the system's accent when on.
 */
export function MacSwitch(props: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string; testID?: string }) {
  const travel = 36 - 2 * 1.5 - 21;
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
      trackStyle={{ width: 36, height: 16, borderRadius: 8, paddingVertical: 2, paddingHorizontal: 1.5 }}
      thumbStyle={{
        width: 21,
        height: 12,
        borderRadius: 6,
        backgroundColor: token("sys-thumb"),
        boxShadow: [{ x: 0, y: 0.5, blur: 1.5, color: "#00000033" }],
        transform: [{ translateX: x }],
      }}
    />
  );
}

/**
 * A pop-up button as macOS 26's settings draw one (measured): the choice in plain text, no plate and no edge, then a
 * 20-point gray circle (a push button's fill) with dark up-and-down chevrons. Its menu marks the choice with a check,
 * as macOS's do.
 */
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
      popupClass="bg-sys-menu border border-sys-menu-edge"
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
        <View class="flex-row items-center" style={{ height: FORM.height, gap: 11, paddingRight: 3 }}>
          <Text class="text-sys-fg" style={{ fontSize: FORM.control, numberOfLines: 1 }}>
            {title()}
          </Text>
          <View class={`items-center justify-center bg-sys-push ${fade()}`} style={{ width: 20, height: 20, borderRadius: 10 }}>
            <Icon name="chevrons" size={13} tint={token("sys-push-fg")} />
          </View>
        </View>
      }
    />
  );
}

/**
 * A push button as macOS 26 draws one in its settings (measured from AppKit's and SwiftUI's own): 24 high, a plain
 * 6-point circular corner, no edge, a light fill of the label color (8%, darker pressed, fainter disabled) and no hover
 * change. `primary` is the default button: filled with the system's accent, its label white; disabled, it is gray like
 * any other. The keyboard's ring hugs it, in the system's focus color.
 */
export function PushButton(props: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  primary?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const ink = () => (props.disabled ? "sys-push-disabled-fg" : props.primary ? "sys-on-accent" : "sys-push-fg");
  const inkClass = () => (props.disabled ? "text-sys-push-disabled-fg" : props.primary ? "text-sys-on-accent" : "text-sys-push-fg");
  return (
    <Button
      testID={props.testID}
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityLabel={props.accessibilityLabel}
      class={`flex-row items-center justify-center disabled:bg-sys-push-disabled ${fade()} ${
        props.primary ? "bg-sys-accent active:bg-sys-accent-pressed" : "bg-sys-push active:bg-sys-push-pressed"
      }`}
      focusVisibleStyle={{ outlineStyle: "solid", outlineWidth: 3, outlineOffset: 0, outlineColor: token("sys-focus") }}
      style={{ height: FORM.height, gap: 5, paddingHorizontal: 12, borderRadius: FORM.radius }}
    >
      <If when={props.icon}>{(name) => <Icon name={name()} size={13} tint={token(ink())} />}</If>
      <Text class={inkClass()} style={{ fontSize: FORM.control, numberOfLines: 1 }}>
        {props.label}
      </Text>
    </Button>
  );
}

/**
 * A time of day typed or stepped (`HH:mm`) in a text field's outline, as macOS's time field: no fill, a faint edge,
 * the segment being edited on the selected-content blue. (macOS puts a stepper inside the field; NSH's `TimeField`
 * has no place for one, and the arrow keys step the segment.)
 */
export function TimeInput(props: { value: string; onChange: (value: string) => void; label: string; hourCycle: "h12" | "h23"; testID?: string }) {
  return (
    <TimeField
      testID={props.testID}
      value={props.value}
      hourCycle={props.hourCycle}
      onChange={({ value }) => props.onChange(value)}
      accessibilityLabel={props.label}
      class={`flex-row items-center bg-sys-input border border-sys-input-edge ${fade()}`}
      style={{ height: FORM.height, paddingHorizontal: 7, borderRadius: FORM.radius }}
      segmentClass="text-sys-fg focus:bg-sys-selected-content focus:text-sys-on-accent"
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
