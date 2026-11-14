// Small pieces the panel's rows share: a title or snippet with the query's
// terms highlighted, key hints, and the to-do checkbox.
import { computed, Text, View } from "nsh";
import { Checkbox } from "nsh/base";
import { Icon } from "./icons";
import { T } from "./tokens";
import { token } from "nsh";
import { t } from "nsh/i18n";

interface Segment {
  text: string;
  hit: boolean;
}

/** `text` cut into runs that match one of `terms` (case-insensitive) and runs that do not. */
function segments(text: string, terms: readonly string[]): Segment[] {
  const wanted = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (!wanted.length) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: Segment[] = [];
  let at = 0;
  while (at < text.length) {
    let best = -1;
    let length = 0;
    for (const t of wanted) {
      const i = lower.indexOf(t, at);
      if (i >= 0 && (best < 0 || i < best || (i === best && t.length > length))) {
        best = i;
        length = t.length;
      }
    }
    if (best < 0) break;
    if (best > at) out.push({ text: text.slice(at, best), hit: false });
    out.push({ text: text.slice(best, best + length), hit: true });
    at = best + length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** One line of text with the query's terms marked in highlighter yellow (on a selected row, white with the accent). */
export function Highlight(props: {
  text: string;
  terms: readonly string[];
  selected: boolean;
  class?: string;
  size: number;
  testID?: string;
}) {
  const parts = computed(() => segments(props.text, props.terms));
  return (
    <Text testID={props.testID} class={props.class} style={{ numberOfLines: 1, fontSize: props.size }}>
      {parts().map((p) =>
        p.hit ? <Text class={props.selected ? "bg-on-accent-mark text-primary" : "bg-mark text-mark-fg"}>{p.text}</Text> : p.text,
      )}
    </Text>
  );
}

/** One key as a keycap: a small rounded square with a faint fill and a hairline edge (Raycast's footer keys). */
export function Keycap(props: { label: string; onAccent?: boolean }) {
  return (
    <View
      class={`items-center justify-center border ${props.onAccent ? "bg-on-accent/15 border-on-accent/25" : "bg-glass-fg/7 border-glass-fg/10"}`}
      style={{ height: 20, minWidth: 20, paddingHorizontal: 5, borderRadius: 5, borderCurve: "continuous" }}
    >
      <Text class={props.onAccent ? "text-on-accent-muted" : "text-glass-muted"} style={{ fontSize: T.type.meta - 1, lineHeight: 14 }}>
        {props.label}
      </Text>
    </View>
  );
}

/** A combination's keys, a keycap each, side by side. */
export function Keycaps(props: { keys: readonly string[]; onAccent?: boolean }) {
  return (
    <View class="flex-row items-center" style={{ gap: 3 }} accessibilityLabel={props.keys.join(" ")}>
      <Each of={[...props.keys]} key="index">
        {(key) => <Keycap label={key()} onAccent={props.onAccent} />}
      </Each>
    </View>
  );
}

/** A footer action: what it does, then its keys (`打开 [↩]`); the main action's name in the primary text color. */
export function KeyHint(props: { label: string; keys: readonly string[]; main?: boolean }) {
  return (
    <View class="flex-row items-center" style={{ gap: 6 }}>
      <Text class={props.main ? "text-glass-fg" : "text-glass-muted"} style={{ fontSize: T.type.meta }}>
        {props.label}
      </Text>
      <Keycaps keys={props.keys} />
    </View>
  );
}

/** The short line between two footer actions. */
export function HintDivider() {
  return <View class="bg-glass-line" style={{ width: 1, height: 12 }} />;
}

/** A to-do's checkbox: a circle on Apple platforms (a rounded square elsewhere), filled with the accent once checked; on a selected row, white. */
export function TodoCheck(props: { checked: boolean; label: string; onCheck: () => void; size: number; onAccent?: boolean; testID?: string }) {
  const radius = () => T.radius.checkbox ?? props.size / 2;
  return (
    <Checkbox
      testID={props.testID}
      checked={props.checked}
      accessibilityLabel={props.label}
      hitSlop={6}
      onChange={({ checked }) => checked && props.onCheck()}
      indicatorStyle={{ width: props.size, height: props.size, borderRadius: radius(), borderWidth: 1.5 }}
      indicatorClass={
        props.onAccent
          ? "items-center justify-center border-on-accent-muted checked:border-on-accent checked:bg-on-accent"
          : "items-center justify-center border-glass-fg/40 checked:border-primary checked:bg-primary"
      }
      indicator={
        <If when={props.checked}>
          <Icon name="check" size={props.size * 0.72} tint={props.onAccent ? token("primary") : token("on-accent")} />
        </If>
      }
    />
  );
}

/** The summon keys at the field's end, as keycaps like the footer's: the double press, or the fallback shortcut while the permission is missing. */
export function SummonKeys(props: { trusted: boolean }) {
  const keys = () => (props.trusted ? T.keys.summonCaps : T.keys.fallbackCaps);
  return (
    <View accessibilityLabel={props.trusted ? t("search.summon_double", { key: T.keys.summonCaps[0] }) : t("search.summon_shortcut", { keys: T.keys.fallback })}>
      <Keycaps keys={keys()} />
    </View>
  );
}
