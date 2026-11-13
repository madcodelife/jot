// Jot's design tokens: every radius, size, type step, material, spring and
// key label in one place, grouped by platform. Colors live in the theme
// (`ui/theme.json`, light and dark), which classes and `token()` read; this
// file holds what the theme cannot (numbers, materials, motion, words).
//
// macOS is implemented; Windows and Linux carry the design's values so the
// same screens pick them up when those targets are built (their colors are
// the theme's for now: see `colors` below).
import { platform } from "nsh";

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
  /** The type ladder, in points (the design's: title 29, field 22, row and body 16, snippet 13, meta 12). */
  type: {
    title: number;
    field: number;
    row: number;
    body: number;
    bodyLine: number;
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
    /** The append notice goes away on its own. */
    noticeFor: number;
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
  };
  /** Where notes live by default, relative to the home directory, and how the folder is shown. */
  folder: { path: string; shown: string };
  /** The theme's colors are macOS's; a platform whose palette differs names its overrides here once its target is built. */
  colors: null;
}

const APPLE_TYPE = {
  title: 29,
  field: 22,
  row: 16,
  body: 16,
  bodyLine: 26,
  snippet: 13,
  meta: 12,
  todo: 14.5,
  island: 18,
  islandLabel: 12,
};

const SIZE = {
  panelWidth: 534,
  editorWidth: 812,
  editorHeight: 499,
  field: 65,
  listTop: 9,
  row: 52,
  sidebarRow: 46,
  sidebar: 255,
  todoRow: 40,
  groupHeader: 26,
  todoMaxHeight: 387,
  footer: 39,
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
  noticeFor: 5000,
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
};

const macos: PlatformTokens = {
  radius: { capsule: 33, panel: 28, row: 14, paper: 20, chip: 999, checkbox: null },
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
  },
  folder: { path: "Documents/Jot", shown: "~/Documents/Jot" },
  colors: null,
};

const windows: PlatformTokens = {
  radius: { capsule: 8, panel: 8, row: 4, paper: 4, chip: 4, checkbox: 4 },
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
  },
  folder: { path: "Documents\\Jot", shown: "Documents\\Jot" },
  colors: null,
};

const linux: PlatformTokens = {
  radius: { capsule: 12, panel: 12, row: 6, paper: 8, chip: 999, checkbox: 6 },
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
  },
  folder: { path: "Documents/Jot", shown: "~/Documents/Jot" },
  colors: null,
};

/** The tokens of the platform Jot runs on (macOS's on any other). */
export const T: PlatformTokens = platform.os === "windows" ? windows : platform.os === "linux" ? linux : macos;

/** Liquid Glass draws on macOS 26 and later; earlier systems get the blur and the translucent fill. */
export const nativeGlass = platform.os === "macos" && Number.parseInt(platform.version, 10) >= 26;

/** The floating layer's material as style keys: the glass (or its fallback), its edge. */
export function materialStyle() {
  if (T.material.kind === "glass") {
    return {
      glassEffect: "regular" as const,
      backdropFilter: `blur(${T.material.blur}px) saturate(${T.material.saturate}%)`,
    };
  }
  if (T.material.kind === "acrylic") {
    return { backdropFilter: `blur(${T.material.blur}px) saturate(${T.material.saturate}%)` };
  }
  return {};
}

/** The fill drawn under the material: none over native glass (it hides the effect), the translucent tint elsewhere. */
export const materialFill = nativeGlass ? "bg-transparent" : "bg-glass-fill";
