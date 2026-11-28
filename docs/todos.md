# To-dos and reminders

To-dos in the store (jot-store) and the reminder time picker in the app. Part of [the architecture](architecture.md).

## To-dos (store/src/todo.rs, part of jot-store)

A to-do is a Markdown task line in any note: `- [ ] text`, `- [x] text ✅ 2026-11-14`. A reminder time is written as
` ⏰ YYYY-MM-DD HH:mm` (local time, no zone; the Obsidian Reminder plugin's form). Relative phrases are only an input
form: they are turned into this absolute form when a line is committed, never stored.

A repeating to-do has its rule after the time: `- [ ] 交房租 ⏰ 2026-12-01 09:00 🔁 every month` (Obsidian Tasks'
wording, in English whatever the language, so the file reads the same everywhere). Five rules only (store/src/repeat.rs):
`every day`, `every weekday` (Monday to Friday), `every week` (the weekday of its `⏰`), `every month` (the day of the
month of its `⏰`) and `every year`; anything else after `🔁` (`every 2 weeks`) stays part of the text. Checking off a
repeating to-do that has a time writes, in the same write, an open copy right above it (same indent, text and rule)
due at the rule's next time: the rule applied to its `⏰` until it is after now, so a daily to-do left for a week comes
back once, not seven times. The checked line keeps its rule, as Obsidian Tasks does. A month's 31st falls on a
shorter month's last day (31 January, then 28 February), and the copy after that follows the day it was written with
(28 March): the file holds no other day to go back to. A 29 February is 28 February in other years. A rule without a
time repeats nothing, and taking a to-do's time away takes its rule too.

```rust
pub use jiff::civil::DateTime;   // local wall-clock time

pub struct Todo {
    pub note: String,            // the note's title
    pub line: usize,             // 0-based line in the note's body
    pub text: String,            // the line's text without the box, the ⏰ and ✅ parts
    pub done: bool,
    pub due: Option<DateTime>,
    pub repeat: Option<Repeat>,  // 🔁 every …
    pub done_on: Option<jiff::civil::Date>,
}

pub enum Repeat { Day, Weekday, Week, Month, Year }
impl Repeat {
    pub fn name(self) -> &'static str;                  // "day", "weekday", … (jot-mcp's `repeat`, the app's)
    pub fn from_name(name: &str) -> Option<Repeat>;
    /// The next time after `now`, by the rule from `due` (at least one step).
    pub fn next(self, due: DateTime, now: DateTime) -> Option<DateTime>;
    pub fn align(self, at: DateTime) -> DateTime;       // every weekday: a weekend's time on Monday
    /// A rule given without a time: today at `time`, or the rule's next once past (aligned).
    pub fn first(self, now: DateTime, time: jiff::civil::Time) -> DateTime;
}
impl Display for Repeat { /* "every month" */ }

/// The open line that follows `line`, a repeating to-do with a time, once checked off at `now` (`None` for any
/// other line): what `set_todo_done` writes above the checked line, and the editor too (`When.nextLine`).
pub fn repeated_line(line: &str, now: DateTime) -> Option<String>;

impl Store {
    /// Every to-do in every note; open ones first, by due time (none last), then by note `modified`.
    pub fn todos(&self) -> Result<Vec<Todo>, StoreError>;
    /// Checks or unchecks the to-do at `line` of `note`, if that line's text is still `text`
    /// (else `StoreError::Changed`); checking adds ` ✅ <today>`, unchecking removes it. Checking a repeating
    /// to-do with a time also writes its next one (`repeated_line`) right above it; it is then at `line + 1`.
    pub fn set_todo_done(&self, note: &str, line: usize, text: &str, done: bool, now: DateTime) -> Result<NoteMeta, StoreError>;
    /// Sets (`Some`) or clears (`None`) the reminder of the to-do at `line` of `note`, if that line's text is
    /// still `text` (else `StoreError::Changed`): a time it has is replaced where it is written (its rule kept), a
    /// new one goes at the end (before a rule and a done stamp); clearing it clears the rule too. The reminder time
    /// picker of the to-do view and `reschedule_todo` write with it.
    pub fn set_todo_due(&self, note: &str, line: usize, text: &str, due: Option<DateTime>) -> Result<NoteMeta, StoreError>;
    /// Sets or clears the rule the same way: replaced where it is, a new one right after the time. The picker's
    /// "Remove Repeat" in the to-do view writes with it.
    pub fn set_todo_repeat(&self, note: &str, line: usize, text: &str, repeat: Option<Repeat>) -> Result<NoteMeta, StoreError>;
    /// Appends `- [ ] text[ ⏰ due][ 🔁 every <rule>]` to `note` (default "待办", created as needed, with `source`).
    pub fn add_todo(&self, note: Option<&str>, text: &str, due: Option<DateTime>, repeat: Option<Repeat>, source: Source) -> Result<Todo, StoreError>;
}

pub mod when {                   // store/src/when/: mod.rs (driver, labels), zh.rs, en.rs, ja.rs
    /// The first time phrase in `text`, in any of the languages, mixed or not (zh-Hans / zh-Hant: 今天 / 明天 /
    /// 后天 / 後天, 周一…周日 / 週一, 下周五 / 下週五, 11月20日, 20号 / 20號, 9点 / 9點, 下午3点, 半小时后 / 半小時後;
    /// en: today / tomorrow / the day after tomorrow, mon…sun / monday…sunday, next friday, nov 20 / 20 nov / 11/20,
    /// 9am / 3:30 pm / 15:00 / noon, tonight, this afternoon, in 30 min / in half an hour / in 2 hours; ja: 今日 /
    /// 明日 / 明後日, 月曜…日曜 / 月曜日, 来週の金曜, 11月20日, 20日, 9時 / 9時半 / 午後3時, 30分後 / 2時間後),
    /// numbers in Chinese numerals / kanji as speech-to-text writes them (九点, 三点半, 十一点四十五, 十二点零五,
    /// 三点一刻, 十一月二十号, 二十号, 半个小时后, 九時, 三時半; a numeral hour on its own is no time when it reads as
    /// something else: 一点 without minutes, 第三点, 三点意见, 一時停止), as a byte range, the time, and a short
    /// label in `options.lang`. An hour without a part of the day or am / pm (九点, 3点, 3:30, 三時, `at 4`):
    /// 1–6 is the afternoon's (13:00–18:00), 7–12, 0 and 13–23 as written (`03:00` with its leading zero too); then
    /// the next one from `now` (tomorrow once past), with or without a date. A rule (`Repeat`) goes with a time
    /// right before or after it (only spaces between): zh 每天 / 每日, 每个工作日 / 工作日 (on its own, not
    /// 下个工作日), 每周 / 每星期 / 每礼拜, 每周一…每周日 (the weekday its first date), 每月, 每月1号, 每年;
    /// en every day / every weekday / every week / every monday / every month / every year; ja 毎日, 平日, 毎週,
    /// 毎週月曜 / 毎月曜, 毎月, 毎月1日, 毎年. Nothing else is a rule (每两周, 每周末, 每月底, every 2 weeks,
    /// every weekend, 毎週末). A rule without a time is first due today at `default_time` (a part of the day alone,
    /// 每天晚上, at its hour), or at the rule's next once that is past; every weekday's falls on a weekday.
    pub fn parse_with(text: &str, now: DateTime, options: &Options) -> Option<When>;
    /// `parse_with` with `Options::default()` (a date alone is 09:00, the label zh-Hans).
    pub fn parse(text: &str, now: DateTime) -> Option<When>;
    pub struct When { pub range: std::ops::Range<usize>, pub at: DateTime, pub label: String, pub repeat: Option<Repeat> }
    pub struct Options { pub default_time: jiff::civil::Time /* a date alone; 09:00 */, pub lang: Lang /* ZhHans */ }
    /// The label's language: zh-Hans "明天 09:00" / "周五 15:00" / "11月20日 09:00", zh-Hant "後天 09:00" /
    /// "週五 15:00", en "Tomorrow 9:00 AM" / "Fri 3:00 PM" / "Nov 20 9:00 AM", ja "明日 9:00" / "金曜 15:00" /
    /// "11月20日 9:00". Today / tomorrow / (the day after, where the language has a word) / the weekday within the
    /// coming week / the month and day; a rule after ` · ` ("明天 09:00 · 每天", "Tomorrow 9:00 AM · Daily").
    pub enum Lang { ZhHans, ZhHant, En, Ja }
    impl Lang { pub fn from_locale(locale: &str) -> Lang; }  // "zh-TW" / "zh-Hant" → ZhHant, other zh → ZhHans, ja, else En
    /// A to-do line with its phrase replaced by ` ⏰ YYYY-MM-DD HH:mm` (and ` 🔁 every <rule>` for a rule; whatever
    /// the language), or None when it has none / is not an open to-do. A to-do with a time takes only a phrase with
    /// a rule (the rule added, the time the phrase's if it says one, else the one it has); one with a time and a
    /// rule takes none. The time and rule written are blanked out first, so `09:00` is no phrase.
    pub fn normalize_line_with(line: &str, now: DateTime, options: &Options) -> Option<String>;
    pub fn normalize_line(line: &str, now: DateTime) -> Option<String>;   // with Options::default()
}
```
`StoreError` gains `Changed`.

## The reminder time picker (app/due.ts, app/ui/DuePicker.tsx)

One picker for the open note and the to-do view: an `Overlay` in the panel's window, anchored to the time chip
(`EditorRef.rangeBounds` of the `⏰` range gives its box in the window; the line's end for a to-do without a time) or
to the to-do row's due label (a `ViewRef`). It opens from a press on the chip (`onTextPress`) or the label, from
⇧⌘D (`T.keys.due`, Things' deadline key, free in the editor and the panel; Ctrl+Shift+D elsewhere) and from the
action panel ("Reminder Time…", in the note while the caret is on an open to-do; on a to-do row "Reminder Time…" /
"Add Reminder…" and "Remove Reminder"). Quick choices first (in an hour, this evening 20:00, tomorrow and next Monday
at the settings' time for a date alone; those past or repeated left out: `quickChoices` in app/time.ts), then
`Calendar` and `TimeField`, set with the button or ⌘↩, then "Remove Repeat" (a repeating to-do's; its rule shows
under the time it has) and "Remove Reminder" (which takes the rule too). It opens with the first choice focused:
↑↓ move among the choices, Return picks, Tab reaches the calendar and the field, Escape closes (its keys are bound
after the panel's, so they win). The open note writes through `editor.edit` (the changed part of the line only:
undo takes it back in one step and the caret stays; `withDue` and `withoutRepeat` in app/tasks.ts mirror
`set_todo_due` and `set_todo_repeat`); the to-do view through `Notes.setTodoDue` / `Notes.setTodoRepeat`, its row following to its new group, still selected (lifted over the rows it passes
while it moves: [the to-do view's motion](app.md#the-to-do-views-motion-appuitodoviewtsx-appuipartstsx)).

## Repeating to-dos in the app

- The open note: a repeat reads as a chip of its words in the language shown ("↻ 每月", "↻ Monthly") while no caret
  or selection touches it, and as written (`🔁 every month`) where one does; a press on it opens the picker. A rule
  being typed ("每月1号", "every monday 9am") lights up with its time as the live chip, also on a to-do that has a
  time already (blanked out first, as the store reads it), and becomes the file's form as the caret leaves the line.
- Ticking a repeating to-do in the note (its box or ⌘↩) writes its next one above it in the same edit, which one undo
  takes back: `When.nextLine` is the store's `repeated_line`, so the editor and the store write the same line. Return
  on a repeating to-do keeps its time and rule on it, as it keeps its time.
- The to-do view's chip shows the rule after the time (a repeat icon and "每月"); ticked, the row slides out as any
  other (it is the line below by then) and the next one shows in its group. The island, the AI apps
  (`complete_todo`) and the to-do view check off through the store, which writes the next one.
- A quick note that says a rule (`每天早上8点吃药`) files a repeating to-do.
