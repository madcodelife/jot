// The emoji picker of a note: NSH's `EmojiPicker`, in the theme's colors.
// From the list ("Set Emoji…" on a row, no note open) it takes the list's
// place in the panel, as the action panel's own content would, the note it is
// for at its top; from the open note's header (or a row of the sidebar beside
// it) it is a glass card like the action panel's, under the title and its
// date, or under the row. Typing searches, the arrows move the highlight,
// Return or a press makes the emoji the note's; Escape clears the search, then
// closes it (back to the list), as a press outside the card does. The notes'
// own emoji come first ("Used in your notes"); a note with one has "Remove
// Emoji" too.
import { Animated, cleanup, createAnimatedValue, effect, keymap, Overlay, reduceMotion, signal, Text, token, untracked, View, type ViewRef } from "nsh";
import { Button, EmojiPicker, type EmojiGroupLabels } from "nsh/base";
import { t } from "nsh/i18n";
import { cancelEmoji, emojiPicking, focusRequest, iconOf, opened, pickEmoji, removeEmoji, stage, usedIcons, type EmojiPlace } from "../store";
import { springConfig } from "./motion";
import { KeyHint } from "./parts";
import { fade } from "./themes";
import { materialEdge, materialFill, materialStyle, T } from "./tokens";

/** The newest emoji shown: macOS 14.4's font draws Emoji 15.1; newer ones would show as boxes there. */
const EMOJI_VERSION = "15.1";

/** The card (under the open note's title, or a row of the sidebar): its cells, their rows, and how tall its list is. */
const CARD = { cell: 36, columns: 8, pad: 8, height: 240 };
const CARD_WIDTH = CARD.cell * CARD.columns + CARD.pad * 2;

/**
 * The panel's own picker (the list's place): its head (the note, Remove, Escape), and the picker under it, its rows
 * as wide as the panel's, the cells inset as the rows' words are.
 */
const PANE = { head: 44, cell: 38, columns: 13, height: 300 };
const PANE_PAD = (T.size.panelWidth - 2 - PANE.cell * PANE.columns) / 2;
/** How tall the picker in the list's place is: the panel grows or shrinks to it, as it does to its rows. */
export const emojiPaneHeight = PANE.head + PANE.height;
/** The picker has the list's place in the panel now ("Set Emoji…" from the list). Tracked. */
export const emojiInPanel = () => emojiPicking()?.place === "list" && stage() === "list";

/** What each note's card is anchored to: its row in the sidebar, and the open note's title with its date. */
const anchors = new Map<string, ViewRef>();
const anchorKey = (place: EmojiPlace, title: string) => `${place}\u0000${title}`;

/** The `ref` of a view the card of `title` opens under, in its `place`. */
export function emojiAnchor(place: Exclude<EmojiPlace, "list">, title: string) {
  return (r: ViewRef | undefined) => {
    if (r) anchors.set(anchorKey(place, title), r);
  };
}

const GROUPS = ["recent", "smileysEmotion", "peopleBody", "animalsNature", "foodDrink", "travelPlaces", "activities", "objects", "symbols", "flags"] as const;

/** The picker in the list's place, while "Set Emoji…" from the list is open (Panel.tsx shows it). */
export function EmojiPane() {
  return <If when={emojiPicking()}>{(state) => <Pane title={state().title} />}</If>;
}

/** The card, while a note's emoji is being chosen from its header or the sidebar (placed in the panel's window, over everything). */
export function EmojiPopover() {
  return <If when={emojiPicking()?.place !== "list" ? emojiPicking() : null}>{(state) => <Card title={state().title} place={state().place} />}</If>;
}

/** What the pane and the card share: the search, the motion in, Escape, and closing with the panel or the note. */
function picking(place: EmojiPlace) {
  const query = signal("");
  const labels = Object.fromEntries(GROUPS.map((g) => [g, t(`emoji.groups.${g}`)])) as EmojiGroupLabels;

  // In: the action panel's motion, a quick fade with the summon spring; with reduced motion, the fade alone.
  const opacity = createAnimatedValue(0);
  const scale = createAnimatedValue(place === "list" ? 0.98 : 0.96);
  const lift = createAnimatedValue(place === "list" ? 6 : -4);
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

  // Newer than the panel's Escape (which steps back), for when the search field has not the focus: the search, then
  // the picker only.
  keymap.bind(
    "escape",
    () => {
      if (untracked(query)) query.set("");
      else cancelEmoji();
    },
    { when: "always" },
  );

  // Closed (an emoji chosen, removed, Escape, a press outside): the search field has the keys again; the open note's
  // text takes them back itself (Paper.tsx).
  cleanup(() => {
    if (place !== "paper") focusRequest.set({ target: "field" });
  });

  // The panel hides, the note closes or another opens: the picker goes with them.
  const from = { stage: untracked(stage), note: untracked(opened)?.token };
  effect(() => {
    if (stage() !== from.stage || opened()?.token !== from.note) untracked(cancelEmoji);
  });

  return { query, labels, opacity, scale, lift };
}

/** The picker itself, as wide as `columns` cells of `cell`, `pad` on each side. */
function Picker(props: { query: () => string; onQuery: (q: string) => void; labels: EmojiGroupLabels; cell: number; columns: number; pad: number; height: number }) {
  return (
    <EmojiPicker
      style={{ height: props.height }}
      query={props.query()}
      onQueryChange={({ query }) => props.onQuery(query)}
      recent={usedIcons()}
      groupLabels={props.labels}
      columns={props.columns}
      emojiVersion={EMOJI_VERSION}
      placeholder={t("emoji.search")}
      accessibilityLabel={t("emoji.list")}
      searchAccessibilityLabel={t("emoji.search")}
      autoFocus
      onSelect={({ emoji }) => pickEmoji(emoji)}
      onCancel={() => cancelEmoji()}
      searchBarClass="flex-row items-center bg-glass-fg/7"
      searchBarStyle={{ marginHorizontal: props.pad, marginTop: 4, height: 30, paddingHorizontal: 10, borderRadius: T.radius.action, borderCurve: "continuous" }}
      searchClass="flex-1 text-glass-fg"
      searchStyle={{ fontSize: T.type.snippet + 1, backgroundColor: "transparent" }}
      rowStyle={{ paddingHorizontal: props.pad }}
      groupClass="font-semibold text-glass-muted"
      groupStyle={{ fontSize: T.type.meta, paddingHorizontal: props.pad + 4, paddingTop: 10, paddingBottom: 4 }}
      itemClass="items-center justify-center hover:bg-glass-hover focus:bg-glass-hover"
      itemStyle={{ width: props.cell, height: props.cell, fontSize: 22, borderRadius: T.radius.action, borderCurve: "continuous" }}
      empty={
        <Text class="text-glass-muted" style={{ fontSize: T.type.snippet, textAlign: "center", paddingVertical: 24 }}>
          {t("emoji.none")}
        </Text>
      }
    />
  );
}

/** "Remove Emoji", in the danger's color. */
function RemoveButton(props: { title: string }) {
  return (
    <Button
      testID="emoji-remove"
      accessibilityLabel={t("emoji.remove_label", { title: props.title })}
      class="hover:bg-glass-hover active:opacity-70"
      style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: T.radius.action, borderCurve: "continuous" }}
      onPress={() => removeEmoji(props.title)}
    >
      <Text class="text-danger" style={{ fontSize: T.type.snippet + 0.5 }}>
        {t("emoji.remove")}
      </Text>
    </Button>
  );
}

/** The list's place: whose emoji it is at the top (with Remove and Escape), the picker under it. */
function Pane(props: { title: string }) {
  const { query, labels, opacity, scale, lift } = picking("list");
  const note = () => {
    const icon = iconOf(props.title);
    return icon ? `${icon} ${props.title}` : props.title;
  };
  return (
    <View
      testID="emoji-picker"
      role="dialog"
      accessibilityLabel={t("emoji.label", { title: props.title })}
      class="flex-1"
      style={{ opacity, transform: [{ translateY: lift }, { scale }] }}
    >
      <View class="flex-row items-center" style={{ height: PANE.head, gap: 8, paddingLeft: 22, paddingRight: PANE_PAD - 2 }}>
        <Text class="text-glass-muted" style={{ fontSize: T.type.meta, flexShrink: 0 }}>
          {t("emoji.heading")}
        </Text>
        <Text testID="emoji-note" class="font-semibold text-glass-fg" style={{ numberOfLines: 1, fontSize: T.type.snippet + 1, flexShrink: 1 }}>
          {note()}
        </Text>
        <View class="flex-1" />
        <If when={iconOf(props.title)}>
          <RemoveButton title={props.title} />
        </If>
        <KeyHint label={t("emoji.back")} keys={T.keys.esc} />
      </View>
      <Picker query={query} onQuery={(q) => query.set(q)} labels={labels} cell={PANE.cell} columns={PANE.columns} pad={PANE_PAD} height={PANE.height} />
    </View>
  );
}

/** The card under the open note's title and date, or under a row of the sidebar. */
function Card(props: { title: string; place: EmojiPlace }) {
  const { query, labels, opacity, scale, lift } = picking(props.place);
  const anchor = anchors.get(anchorKey(props.place, props.title));
  return (
    <Overlay
      anchor={anchor}
      placement="bottom"
      align="start"
      offset={6}
      // Inside the panel, as far from its edges as the paper is: the window around it is only the shadow's room.
      margin={T.size.windowMargin + T.size.inset}
      // No `onCancel`: Escape is the search field's (it clears the search, then the picker's `onCancel` closes it).
      onPressOutside={() => cancelEmoji()}
      // Nothing to anchor to: at the panel's foot, as the notices are.
      style={anchor ? undefined : { left: 0, right: 0, bottom: T.size.windowMargin + 14, alignItems: "center" }}
    >
      <View
        testID="emoji-picker"
        role="dialog"
        accessibilityLabel={t("emoji.label", { title: props.title })}
        class={`${materialFill()} ${materialEdge()} ${fade()}`}
        style={{
          ...materialStyle(),
          width: CARD_WIDTH,
          paddingTop: CARD.pad - 4,
          borderRadius: T.radius.actions,
          borderCurve: "continuous",
          overflow: "hidden",
          boxShadow: [{ x: 0, y: 12, blur: 32, color: token("glass-shadow") }],
          opacity,
          transform: [{ translateY: lift }, { scale }],
        }}
      >
        <Picker query={query} onQuery={(q) => query.set(q)} labels={labels} cell={CARD.cell} columns={CARD.columns} pad={CARD.pad} height={CARD.height} />
        <If when={iconOf(props.title)}>
          {(emoji) => (
            <View class="flex-row items-center border-t border-glass-line" style={{ height: T.size.actionRow + 8, paddingHorizontal: CARD.pad, gap: 8 }}>
              <Text style={{ fontSize: 18, marginLeft: 4 }}>{emoji()}</Text>
              <View class="flex-1" />
              <RemoveButton title={props.title} />
            </View>
          )}
        </If>
      </View>
    </Overlay>
  );
}
