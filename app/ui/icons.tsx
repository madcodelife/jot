// The icons Jot draws: Lucide's, from `nsh-icon-lucide`, drawn by nsh-icon's
// `<Icon>` in the text color, so they follow the theme's tokens and the
// appearance. Only the icons named here go into the bundle.
import type { JSX, TextStyle } from "nsh";
import { Icon as NshIcon } from "nsh-icon";
import {
  AlarmClock,
  Bell,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CloudDownload,
  Contrast,
  Copy,
  ExternalLink,
  Lock,
  Mic,
  Option,
  Pin,
  Search,
  Settings,
  SmilePlus,
  Sparkles,
  Trash2,
} from "nsh-icon-lucide";

const ICONS = {
  search: Search,
  spark: Sparkles,
  check: Check,
  bell: Bell,
  alarm: AlarmClock,
  mic: Mic,
  // A note iCloud Drive is downloading.
  cloud: CloudDownload,
  // A locked note.
  lock: Lock,
  // A pinned note.
  pin: Pin,
  // The open note's "Add Emoji".
  smile: SmilePlus,
  gear: Settings,
  option: Option,
  appearance: Contrast,
  copy: Copy,
  external: ExternalLink,
  trash: Trash2,
  chevron: ChevronRight,
  chevrons: ChevronsUpDown,
} as const;

/** The icons Jot draws. */
export type IconName = keyof typeof ICONS;

/** An icon `size` points square in `tint` (a color, as `token()` gives it). */
export function Icon(props: { name: IconName; size?: number; tint: string; opacity?: number }): JSX.Element {
  // The icon paints in the text color (`currentColor`), which any view takes
  // from `color`, though only a text's style declares it.
  const style = (): TextStyle => ({ pointerEvents: "none", color: props.tint, opacity: props.opacity ?? 1 });
  return <NshIcon icon={ICONS[props.name]} size={props.size ?? 16} style={style()} />;
}
