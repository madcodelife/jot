// A note's version history in the panel ("Version History…", app/history.ts):
// on the left its earlier versions, newest first, each with when its text is
// from and a line of what differs from the note now; on the right the
// selected one's text, read-only, on the paper, with "Restore This Version".
// The arrows move the selection, Return restores, Escape goes back. A locked
// note's history can be read; restoring waits for the note to be unlocked.
import { effect, Scroll, Text, token, untracked, View, type ScrollRef } from "nsh";
import { t } from "nsh/i18n";
import type { NoteVersion } from "jot/native";
import { closeHistory, hintOf, restoreBlocked, restoreError, restoreSelected, selectedVersion, selectVersion, versions, versionSelected, versionSteps } from "../history";
import { history, now } from "../store";
import { versionTime } from "../time";
import { PushButton } from "./controls";
import { Icon } from "./icons";
import { KeyHint, Keycaps } from "./parts";
import { fade } from "./themes";
import { T } from "./tokens";

/** The list's head ("Version History") and a version's row. */
const HEAD = 34;
const ROW = T.size.row;
/** The paper's side margins, as the open note's. */
const PAPER_X = 37;

/** The view: the versions beside the selected one's text. */
export function HistoryView() {
  return (
    <If when={history()}>
      {(h) => (
        <View testID="history" class="flex-1 flex-row">
          <View style={{ width: T.size.sidebar }}>
            <View class="flex-row items-center" style={{ height: HEAD, gap: 6, paddingHorizontal: 16 }}>
              <Icon name="history" size={13} tint={token("glass-muted")} />
              <Text role="header" class="font-semibold text-glass-muted" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
                {t("history.title")}
              </Text>
            </View>
            <If
              when={versions().length > 0}
              else={
                <View testID="history-empty" style={{ gap: 4, paddingHorizontal: 16, paddingTop: 6 }}>
                  <Text class="text-glass-fg" style={{ fontSize: T.type.row }}>
                    {t("history.empty")}
                  </Text>
                  <Text class="text-glass-muted" style={{ fontSize: T.type.snippet, lineHeight: 17 }}>
                    {t("history.empty_hint")}
                  </Text>
                </View>
              }
            >
              <VersionList />
            </If>
          </View>
          <View class="flex-1" style={{ paddingLeft: T.size.inset * 2, paddingRight: T.size.inset, paddingBottom: T.size.inset }}>
            <VersionPaper title={h().title} />
          </View>
        </View>
      )}
    </If>
  );
}

/** The versions, newest first; the selected one kept in view as the arrows step. */
function VersionList() {
  let scroll: ScrollRef | undefined;
  let offset = 0;
  let viewport = 0;
  effect(() => {
    versionSteps();
    const index = untracked(versionSelected);
    if (!scroll || !viewport) return;
    const top = index * ROW;
    const bottom = top + ROW;
    let next = offset;
    if (top < offset) next = top;
    else if (bottom > offset + viewport) next = bottom - viewport;
    if (next === offset) return;
    offset = next;
    scroll.scrollTo({ y: next, animated: false });
  });
  return (
    <Scroll
      testID="history-versions"
      class="flex-1"
      ref={(r) => {
        scroll = r;
      }}
      onScroll={({ offset: at, size }) => {
        offset = at.y;
        viewport = size.height;
      }}
    >
      <View role="list" style={{ paddingHorizontal: 6, paddingBottom: 8 }}>
        <Each of={versions()} key={(v) => v.id}>
          {(version, index) => <VersionRow version={version()} index={index()} />}
        </Each>
      </View>
    </Scroll>
  );
}

/** A version: when its text is from, and what differs from the note now. */
function VersionRow(props: { version: NoteVersion; index: number }) {
  const isSelected = () => versionSelected() === props.index;
  // Selected on macOS: a light accent fill, the time in the accent's ink, as the list's rows.
  const accent = () => isSelected() && T.selection === "fill";
  const time = () => versionTime(props.version.modified, now());
  return (
    <View
      testID={`version:${props.index}`}
      role="button"
      accessibilityLabel={t("history.row", { time: time() })}
      accessibilityState={{ selected: isSelected() }}
      onPress={() => selectVersion(props.index)}
      class="flex-row items-center"
      classList={{ "bg-primary/12": accent(), "bg-glass-hover": isSelected() && T.selection !== "fill" }}
      style={{ height: ROW, paddingHorizontal: 10, borderRadius: T.radius.row, borderCurve: "continuous" }}
    >
      <If when={T.selection === "bar" && isSelected()}>
        <View class="absolute bg-primary" style={{ left: 2, top: ROW / 2 - 8, width: 3, height: 16, borderRadius: 2 }} />
      </If>
      <View class="flex-1" style={{ minWidth: 0, gap: 2 }}>
        <Text
          testID="version-time"
          class={accent() ? "text-selected-ink" : "text-glass-fg"}
          style={{ numberOfLines: 1, fontSize: T.type.row, fontVariant: ["tabular-nums"] }}
        >
          {time()}
        </Text>
        <Text testID="version-hint" class={accent() ? "text-selected-muted" : "text-glass-muted"} style={{ numberOfLines: 1, fontSize: T.type.snippet }}>
          {hintOf(props.version)}
        </Text>
      </View>
    </View>
  );
}

/** The selected version's text on the paper, read-only, and what can be done with it. */
function VersionPaper(props: { title: string }) {
  return (
    <View testID="history-paper" class={`flex-1 bg-paper ${fade()}`} style={{ borderRadius: T.radius.paper, borderCurve: "continuous", overflow: "hidden" }}>
      <If
        when={selectedVersion()}
        else={
          <View class="flex-1 items-center justify-center" style={{ paddingHorizontal: PAPER_X }}>
            <Text class="text-paper-muted text-center" style={{ fontSize: T.type.snippet, lineHeight: 17 }}>
              {t("history.empty_paper", { title: props.title })}
            </Text>
          </View>
        }
      >
        {(version) => (
          <>
            <View style={{ paddingTop: 26, paddingHorizontal: PAPER_X, paddingBottom: 12, gap: 6 }}>
              <Text testID="history-time" role="header" class="font-bold text-paper-fg" style={{ numberOfLines: 1, fontSize: T.type.field }}>
                {versionTime(version().modified, now())}
              </Text>
              <Text class="text-paper-muted" style={{ numberOfLines: 1, fontSize: T.type.meta }}>
                {t("history.of", { title: props.title })}
              </Text>
            </View>
            <Scroll class="flex-1">
              <Text
                testID="history-text"
                class="text-paper-fg"
                style={{ fontSize: T.type.body, lineHeight: T.type.bodyLine, paddingHorizontal: PAPER_X, paddingBottom: 16 }}
              >
                {version().body || t("list.blank")}
              </Text>
            </Scroll>
            <View class="flex-row items-center" style={{ gap: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
              <If when={restoreError()}>
                {(error) => (
                  <Text testID="history-error" role="alert" class="text-late" style={{ numberOfLines: 2, fontSize: T.type.meta, flexShrink: 1 }}>
                    {error()}
                  </Text>
                )}
              </If>
              <If when={restoreError() ? null : restoreBlocked()}>
                {(why) => (
                  <View testID="history-locked" class="flex-row items-center" style={{ gap: 5, flexShrink: 1 }}>
                    <Icon name="lock" size={12} tint={token("paper-muted")} />
                    <Text class="text-paper-muted" style={{ numberOfLines: 1, fontSize: T.type.meta, flexShrink: 1 }}>
                      {why()}
                    </Text>
                  </View>
                )}
              </If>
              <View class="flex-1" />
              <Back />
              <PushButton testID="history-restore" label={t("history.restore")} primary disabled={restoreBlocked() !== null} onPress={() => restoreSelected()} />
              <If when={restoreBlocked() === null}>
                <Keycaps keys={T.keys.enter} />
              </If>
            </View>
          </>
        )}
      </If>
    </View>
  );
}

/** Escape, back where the history opened: pressable too. */
function Back() {
  return (
    <View testID="history-back" role="button" accessibilityLabel={t("history.back")} onPress={() => closeHistory()} class="active:opacity-70">
      <KeyHint label={t("history.back")} keys={T.keys.esc} />
    </View>
  );
}
