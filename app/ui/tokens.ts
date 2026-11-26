// Jot's design tokens: every radius, size, type step, material, spring and
// key label in one place, grouped by platform. Colors live in the theme
// (`app/ui/theme.json`, light and dark), which classes and `token()` read; this
// file holds what the theme cannot (numbers, materials, motion, words).
//
// macOS is implemented; Windows and Linux carry the design's values so the
// same screens pick them up when those targets are built (their colors are
// the theme's for now: see `colors` below).
import { platform, token } from "nsh";
import { activeTheme, drawsSurface, solidTheme, tintedGlass } from "./themes";

/** A spring as SwiftUI states it: how long it takes and how much it bounces. */
export interface Spring {
  /** Seconds for one oscillation (SwiftUI's `response`). */
  response: number;
  /** 1 settles without overshoot; lower bounces (SwiftUI's `dampingFraction`). */
  damping: number;
}

/** What a platform changes of Jot's look and feel. */
export interface PlatformTokens {
  /** Corner radii, in points. */
  radius: {
    /** The summoned capsule (a full pill at its height). */
    capsule: number;
    /** The panel once it grows into the list or the editor. */
    panel: number;
    /** A list row: half the panel's. */
    row: number;
    /** The editor's paper: between the two. */
    paper: number;
    /** The time chip and the field's key hint. */
    chip: number;
    /** A to-do's checkbox: `null` is a circle (Apple), a number a rounded square. */
    checkbox: number | null;
    /** The action panel (⌘K) and one of its items. */
    actions: number;
    action: number;
  };
  /** Sizes, in points (the design's stage at 1160 points wide). */
  size: {
    /** The capsule's and the list's width. */
    panelWidth: number;
    /** The panel with a note open. */
    editorWidth: number;
    editorHeight: number;
    /** The search field's height (the capsule's). */
    field: number;
    /** Space between the field and the first row. */
    listTop: number;
    /** A note row in the list, and in the editor's sidebar. */
    row: number;
    sidebarRow: number;
    /** The sidebar's width with a note open. */
    sidebar: number;
    /** A to-do row and a group's header in the to-do view. */
    todoRow: number;
    groupHeader: number;
    /** The to-do view's tallest list before it scrolls. */
    todoMaxHeight: number;
    /** The key hints along the bottom. */
    footer: number;
    /** The action panel (⌘K): its width, its filter field, an item, a separator. */
    actionsWidth: number;
    actionsField: number;
    actionRow: number;
    actionSeparator: number;
    /** The paper's inset from the panel's edges. */
    inset: number;
    /** A row's icon tile. */
    rowIcon: number;
    /** The transparent margin around the panel inside its window (room for the spring's overshoot). */
    windowMargin: number;
    /** Where the panel's top sits: this share of the display's height from its top. */
    panelTop: number;
    /** The island open: Claude writing, and a reminder. */
    islandWidth: number;
    islandRemindWidth: number;
    islandHeight: number;
    /** The island's bottom corners open, and its idle notch's. */
    islandRadius: number;
    islandIdleRadius: number;
  };
  /**
   * The type ladder, in points. The panel follows Spotlight's: a regular-weight field at 20, rows at 14 with a
   * 12 snippet and 11 meta, weight kept for headers. The editor keeps its title at 29 and body at 16, its headings
   * of levels 1 to 3 at 1.5, 1.3 and 1.15 times the body (levels 4 to 6 are the body's size, bold), its code at 14.5.
   */
  type: {
    title: number;
    field: number;
    row: number;
    body: number;
    bodyLine: number;
    /** A note's headings of levels 1, 2 and 3. */
    headings: readonly [number, number, number];
    /** A note's code, inline and fenced, in the monospaced font (which runs larger than the body's at a size). */
    code: number;
    snippet: number;
    meta: number;
    todo: number;
    island: number;
    islandLabel: number;
  };
  /** The material of the floating layer (the panel, the field, the hint pills). */
  material: {
    /** `glass`: Liquid Glass with a blur to fall back to; `acrylic`: the window's backdrop; `solid`: an opaque popover surface. */
    kind: "glass" | "acrylic" | "solid";
    /** The blur radius and saturation of the fallback (and of acrylic). */
    blur: number;
    saturate: number;
  };
  /** The selection's look: a filled row (macOS), a bar at the row's start (Windows), a neutral fill (GNOME). */
  selection: "fill" | "bar" | "neutral";
  /** Springs (Windows and Linux: the same responses, never overshooting). */
  spring: {
    summon: Spring;
    expand: Spring;
    open: Spring;
    island: Spring;
    drop: Spring;
    collapse: Spring;
    /** The island opening and closing for an AI app's note: a softer open than `island`, under the glow fading in, and
     * a close that does not bounce, as the content has already lifted out. */
    islandWrite: Spring;
    islandWriteClose: Spring;
    /** The island's check popping in once an AI app's note is in: bouncy, as the avatar hops beside it. */
    pop: Spring;
    /** A to-do ticked: its checkbox pressed in and back, its fill growing from the center (bouncier), then its row
     * sliding out to the right. */
    tickPress: Spring;
    tickFill: Spring;
    tickSlide: Spring;
    /** A group's count flipping to its new number, and a due chip's label to its new time. */
    count: Spring;
    chip: Spring;
    /** The to-do view opening: each header and row rising into place. */
    rise: Spring;
    /** The reminder island: its label, title and checkbox rising in. */
    remindRise: Spring;
    /** A to-do moving to its new group once its due time changed. */
    regroup: Spring;
  };
  /** Rhythm, in milliseconds. */
  timing: {
    /** Each row's delay after the one before as the list opens. */
    stagger: number;
    /** From the capsule to the list. */
    expandAfter: number;
    /** Typing pauses this long before a time phrase becomes a chip. */
    chipAfter: number;
    /** The editor saves this long after the last keystroke. */
    saveAfter: number;
    /** "Saved" stays this long. */
    savedFor: number;
    /** The island stays open after Claude's note is in. */
    islandHold: number;
    /** How long the sheen sweeps the title of an AI app's note before the check: the island's writing phase. */
    islandSheen: number;
    /** One sweep of that sheen across the title. Longer than the phase, so it reads as one slow pass, not a loop. */
    islandSheenSweep: number;
    /** One turn of the colors flowing around the island while an AI app writes: slow enough to drift, not spin. */
    islandGlowTurn: number;
    /** The append notice goes away on its own. */
    noticeFor: number;
    /** "Moved to the trash" stays this long, and the undo key with it. */
    undoFor: number;
    /** While a note is downloading (iCloud Drive), the folder is read again this often: a file filling in place may
     * not reach the watcher. */
    downloadPoll: number;
    /** A to-do ticked: the check drawn from the left, the line struck through its text, the ring and the sparks
     * bursting out of the checkbox, then a pause before the row slides out while it fades. */
    tick: {
      checkAfter: number;
      check: number;
      strikeAfter: number;
      strike: number;
      ring: number;
      /** Each spark flies for this long, and up to `sparkSpread` longer. */
      spark: number;
      sparkSpread: number;
      /** From the line struck through to the row sliding out; its fade starts `fadeAfter` into the slide. */
      slideAfter: number;
      fadeAfter: number;
      fade: number;
    };
    /** A number or label flipping: the old one lifts out over `out`, the new one fades in over `in`. */
    flip: {
      countOut: number;
      countIn: number;
      chipOut: number;
      chipIn: number;
      labelOut: number;
      labelIn: number;
    };
    /** The to-do view opening: each item's fade (it rises on `spring.rise`, `stagger` after the one above). */
    riseFade: number;
    /** A to-do moving to its new group: its lifted look fades in over `liftIn`, and out over `liftOut` once it lands. */
    liftIn: number;
    liftOut: number;
    /** The reminder island. */
    remind: {
      /** The label, title and checkbox rise in this long after the bell starts falling, `riseStagger` apart, fading
       * in over `riseFade`. */
      riseAfter: number;
      riseStagger: number;
      riseFade: number;
      /** Once the bell lands: it swings over `swing` and its sound waves pulse out over `waves`. */
      swing: number;
      waves: number;
      /** While it waits: the checkbox breathes a ring out every `breathe`; the bell rings again `ringAfter` after it
       * landed, then every `ring` (its wiggle in the cycle's first `ringShare`). */
      breathe: number;
      ringAfter: number;
      ring: number;
      ringShare: number;
      /** The halo: a pulse over `halo`, twice `haloGap` apart `haloAfter` into the opening, then once per `ring`. */
      haloAfter: number;
      haloGap: number;
      halo: number;
      /** Unticked, the island closes after `hold`; ticked, after `doneHold`. */
      hold: number;
      doneHold: number;
    };
  };
  /** How keys are written (symbols on Apple platforms, words elsewhere), and the summon keys. */
  /** Keys as keycaps: one string per key, a combination as several (shown side by side, no "+"). */
  keys: {
    enter: readonly string[];
    create: readonly string[];
    esc: readonly string[];
    /** The double tap that summons Jot (in menus, and as keycaps at the field's end), and the modifier `Summon` listens for. */
    summon: string;
    summonCaps: readonly string[];
    doubleTap: "option" | "control";
    /** The fallback shortcut: in menus, as keycaps, and as `GlobalShortcut` takes it. */
    fallback: string;
    fallbackCaps: readonly string[];
    fallbackShortcut: string;
    /**
     * Moves the selected note to the trash: Raycast's ⌃X on macOS (no text key there), Ctrl+D on Windows and
     * Linux (File Explorer's, and no text key in an input); as keycaps and as `keymap` takes it.
     */
    trash: readonly string[];
    trashShortcut: string;
    /** Whether the trash key also works with the note's text focused: Ctrl+D there selects the next occurrence. */
    trashInText: boolean;
    /** Takes the last note back from the trash while "Moved to the trash" shows (else the field's own undo). */
    undo: readonly string[];
    undoShortcut: string;
    /** The action panel's key, and the actions' own keys, which work with the panel closed too (`keymap` keystrokes). */
    actions: string;
    reveal: string;
    rename: string;
    copyTitle: string;
    copyBody: string;
    /** The reminder time picker of the to-do in focus (Things' deadline key; no editor or panel key has it). */
    due: string;
  };
  /** Where notes live by default, relative to the home directory, and how the folder is shown. */
  folder: { path: string; shown: string };
  /** The theme's colors are macOS's; a platform whose palette differs names its overrides here once its target is built. */
  colors: null;
}

const APPLE_TYPE = {
  title: 29,
  field: 20,
  row: 14,
  body: 16,
  bodyLine: 26,
  headings: [24, 21, 18.5] as const,
  code: 14.5,
  snippet: 12,
  meta: 11,
  todo: 14,
  island: 18,
  islandLabel: 12,
};

const SIZE = {
  panelWidth: 534,
  editorWidth: 812,
  editorHeight: 499,
  field: 65,
  listTop: 9,
  row: 48,
  sidebarRow: 40,
  sidebar: 255,
  todoRow: 36,
  groupHeader: 26,
  todoMaxHeight: 387,
  footer: 48,
  actionsWidth: 300,
  actionsField: 42,
  actionRow: 32,
  actionSeparator: 9,
  inset: 8,
  rowIcon: 28,
  windowMargin: 24,
  panelTop: 0.17,
  islandWidth: 441,
  islandRemindWidth: 371,
  islandHeight: 93,
  islandRadius: 39,
  islandIdleRadius: 14,
};

const TIMING = {
  stagger: 28,
  expandAfter: 140,
  chipAfter: 800,
  saveAfter: 300,
  savedFor: 1400,
  islandHold: 1600,
  islandSheen: 1300,
  islandSheenSweep: 1600,
  islandGlowTurn: 2600,
  noticeFor: 5000,
  undoFor: 5000,
  downloadPoll: 2000,
  tick: {
    checkAfter: 90,
    check: 260,
    strikeAfter: 60,
    strike: 260,
    ring: 520,
    spark: 560,
    sparkSpread: 160,
    slideAfter: 320,
    fadeAfter: 60,
    fade: 240,
  },
  flip: { countOut: 120, countIn: 140, chipOut: 140, chipIn: 140, labelOut: 130, labelIn: 260 },
  riseFade: 220,
  liftIn: 180,
  liftOut: 220,
  remind: {
    riseAfter: 240,
    riseStagger: 70,
    riseFade: 240,
    swing: 1100,
    waves: 700,
    breathe: 1800,
    ringAfter: 1800,
    ring: 2600,
    ringShare: 0.3,
    haloAfter: 360,
    haloGap: 520,
    halo: 900,
    hold: 8000,
    doneHold: 1100,
  },
};

/** Fluent and libadwaita do not overshoot: the same responses at damping 1. */
const flat = (s: Record<keyof PlatformTokens["spring"], Spring>) =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, damping: 1 }])) as PlatformTokens["spring"];

const SPRINGS: PlatformTokens["spring"] = {
  summon: { response: 0.32, damping: 0.77 },
  expand: { response: 0.39, damping: 0.74 },
  open: { response: 0.39, damping: 0.74 },
  island: { response: 0.36, damping: 0.64 },
  drop: { response: 0.31, damping: 0.63 },
  collapse: { response: 0.32, damping: 0.77 },
  islandWrite: { response: 0.46, damping: 0.7 },
  islandWriteClose: { response: 0.36, damping: 0.95 },
  pop: { response: 0.42, damping: 0.5 },
  tickPress: { response: 0.34, damping: 0.5 },
  tickFill: { response: 0.3, damping: 0.42 },
  tickSlide: { response: 0.38, damping: 0.9 },
  count: { response: 0.32, damping: 0.6 },
  chip: { response: 0.3, damping: 0.62 },
  rise: { response: 0.42, damping: 0.8 },
  remindRise: { response: 0.45, damping: 0.8 },
  regroup: { response: 0.5, damping: 0.82 },
};

const macos: PlatformTokens = {
  radius: { capsule: 33, panel: 28, row: 14, paper: 20, chip: 999, checkbox: null, actions: 18, action: 9 },
  size: SIZE,
  type: APPLE_TYPE,
  material: { kind: "glass", blur: 28, saturate: 175 },
  selection: "fill",
  spring: SPRINGS,
  timing: TIMING,
  keys: {
    enter: ["↩"],
    create: ["⌘", "↩"],
    esc: ["esc"],
    summon: "⌥ ⌥",
    summonCaps: ["⌥", "⌥"],
    doubleTap: "option",
    fallback: "⌃⌥J",
    fallbackCaps: ["⌃", "⌥", "J"],
    fallbackShortcut: "ctrl+alt+j",
    trash: ["⌃", "X"],
    trashShortcut: "ctrl+x",
    trashInText: true,
    undo: ["⌘", "Z"],
    undoShortcut: "mod+z",
    actions: "mod+k",
    reveal: "mod+shift+f",
    rename: "mod+r",
    copyTitle: "mod+shift+c",
    copyBody: "mod+shift+a",
    due: "mod+shift+d",
  },
  folder: { path: "Documents/Jot", shown: "~/Documents/Jot" },
  colors: null,
};

const windows: PlatformTokens = {
  radius: { capsule: 8, panel: 8, row: 4, paper: 4, chip: 4, checkbox: 4, actions: 8, action: 4 },
  size: SIZE,
  type: APPLE_TYPE,
  material: { kind: "acrylic", blur: 30, saturate: 125 },
  selection: "bar",
  spring: flat(SPRINGS),
  timing: TIMING,
  keys: {
    enter: ["Enter"],
    create: ["Ctrl", "Enter"],
    esc: ["Esc"],
    summon: "Ctrl Ctrl",
    summonCaps: ["Ctrl", "Ctrl"],
    doubleTap: "control",
    fallback: "Ctrl+Alt+J",
    fallbackCaps: ["Ctrl", "Alt", "J"],
    fallbackShortcut: "ctrl+alt+j",
    trash: ["Ctrl", "D"],
    trashShortcut: "ctrl+d",
    trashInText: false,
    undo: ["Ctrl", "Z"],
    undoShortcut: "mod+z",
    actions: "mod+k",
    reveal: "mod+shift+f",
    rename: "mod+r",
    copyTitle: "mod+shift+c",
    copyBody: "mod+shift+a",
    due: "mod+shift+d",
  },
  folder: { path: "Documents\\Jot", shown: "Documents\\Jot" },
  colors: null,
};

const linux: PlatformTokens = {
  radius: { capsule: 12, panel: 12, row: 6, paper: 8, chip: 999, checkbox: 6, actions: 12, action: 6 },
  size: SIZE,
  type: APPLE_TYPE,
  material: { kind: "solid", blur: 0, saturate: 100 },
  selection: "neutral",
  spring: flat(SPRINGS),
  timing: TIMING,
  keys: {
    enter: ["Enter"],
    create: ["Ctrl", "Enter"],
    esc: ["Esc"],
    summon: "Super+J",
    summonCaps: ["Super", "J"],
    doubleTap: "control",
    fallback: "Super+J",
    fallbackCaps: ["Super", "J"],
    fallbackShortcut: "super+j",
    trash: ["Ctrl", "D"],
    trashShortcut: "ctrl+d",
    trashInText: false,
    undo: ["Ctrl", "Z"],
    undoShortcut: "mod+z",
    actions: "mod+k",
    reveal: "mod+shift+f",
    rename: "mod+r",
    copyTitle: "mod+shift+c",
    copyBody: "mod+shift+a",
    due: "mod+shift+d",
  },
  folder: { path: "Documents/Jot", shown: "~/Documents/Jot" },
  colors: null,
};

/** The order Apple writes modifiers in (⌃⌥⇧⌘); elsewhere Ctrl, Alt, Shift. */
const MODIFIERS = ["ctrl", "alt", "shift", "mod"] as const;

/** A `keymap` keystroke as keycaps, one per key: `"mod+shift+f"` is ⇧ ⌘ F on Apple platforms, Ctrl Shift F elsewhere. */
export function keyCaps(keystroke: string): string[] {
  const parts = keystroke.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const apple = platform.os === "macos" || platform.os === "ios";
  const names: Record<(typeof MODIFIERS)[number], string> = apple
    ? { ctrl: "⌃", alt: "⌥", shift: "⇧", mod: "⌘" }
    : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", mod: "Ctrl" };
  const keys: Record<string, string> = apple
    ? { enter: "↩", escape: "esc", backspace: "⌫", delete: "⌦", up: "↑", down: "↓" }
    : { enter: "Enter", escape: "Esc", backspace: "Backspace", delete: "Delete", up: "↑", down: "↓" };
  const mods = MODIFIERS.filter((m) => parts.includes(m) || (m === "mod" && parts.includes("cmd")));
  // Ctrl and mod are one key off Apple platforms.
  const shown = [...new Set(mods.map((m) => names[m]))];
  return [...shown, keys[key] ?? key.toUpperCase()];
}

/** The tokens of the platform Jot runs on (macOS's on any other). */
export const T: PlatformTokens = platform.os === "windows" ? windows : platform.os === "linux" ? linux : macos;

/** Liquid Glass draws on macOS 26 and later; earlier systems get the blur and the translucent fill. */
export const nativeGlass = platform.os === "macos" && Number.parseInt(platform.version, 10) >= 26;

/** The floating layer's material as style keys: the glass (or its fallback), tinted as the theme says; none for a solid theme (high contrast). Reactive. */
export function materialStyle() {
  if (solidTheme()) return { glassEffect: "none" as const, backdropFilter: "none" };
  if (T.material.kind === "glass") {
    return {
      glassEffect: "regular" as const,
      ...(tintedGlass() ? { glassTintColor: token("glass-tint") } : {}),
      backdropFilter: `blur(${T.material.blur}px) saturate(${T.material.saturate}%)`,
    };
  }
  if (T.material.kind === "acrylic") {
    return { backdropFilter: `blur(${T.material.blur}px) saturate(${T.material.saturate}%)` };
  }
  return {};
}

/** The fill drawn with the material: the theme's own surface where it draws one (`drawsSurface`), else none, so the native glass shows. Reactive. */
export const materialFill = () => (drawsSurface(activeTheme(), nativeGlass) ? "bg-glass-fill" : "bg-transparent");

/**
 * The floating layer's rim: none on Liquid Glass, which draws its own lit edge (Spotlight has no other), a hairline
 * on the blur fallback and on a solid theme, where nothing else marks the edge. Reactive.
 */
export const materialEdge = () => (nativeGlass && !solidTheme() ? "" : "border border-glass-edge");
