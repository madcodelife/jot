# To-dos and reminders

To-dos in the store (jot-store) and the reminder time picker in the app. Part of [the architecture](architecture.md).

## To-dos (store/src/todo.rs, part of jot-store)

A to-do is a Markdown task line in any note: `- [ ] text`, `- [x] text ✅ 2026-11-14`. A reminder time is written as
` ⏰ YYYY-MM-DD HH:mm` (local time, no zone; the Obsidian Reminder plugin's form). Relative phrases are only an input
form: they are turned into this absolute form when a line is committed, never stored.

```rust
pub use jiff::civil::DateTime;   // local wall-clock time

pub struct Todo {
    pub note: String,            // the note's title
    pub line: usize,             // 0-based line in the note's body
    pub text: String,            // the line's text without the box, the ⏰ and ✅ parts
    pub done: bool,
    pub due: Option<DateTime>,
    pub done_on: Option<jiff::civil::Date>,
}

impl Store {
    /// Every to-do in every note; open ones first, by due time (none last), then by note `modified`.
    pub fn todos(&self) -> Result<Vec<Todo>, StoreError>;
    /// Checks or unchecks the to-do at `line` of `note`, if that line's text is still `text`
    /// (else `StoreError::Changed`); checking adds ` ✅ <today>`, unchecking removes it.
    pub fn set_todo_done(&self, note: &str, line: usize, text: &str, done: bool, today: jiff::civil::Date) -> Result<NoteMeta, StoreError>;
    /// Sets (`Some`) or clears (`None`) the reminder of the to-do at `line` of `note`, if that line's text is
    /// still `text` (else `StoreError::Changed`): a time it has is replaced where it is written, a new one goes at
    /// the end (before a done stamp). The reminder time picker of the to-do view and `reschedule_todo` write with it.
    pub fn set_todo_due(&self, note: &str, line: usize, text: &str, due: Option<DateTime>) -> Result<NoteMeta, StoreError>;
    /// Appends `- [ ] text[ ⏰ due]` to `note` (default "待办", created as needed, with `source`).
    pub fn add_todo(&self, note: Option<&str>, text: &str, due: Option<DateTime>, source: Source) -> Result<Todo, StoreError>;
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
    /// the next one from `now` (tomorrow once past), with or without a date.
    pub fn parse_with(text: &str, now: DateTime, options: &Options) -> Option<When>;
    /// `parse_with` with `Options::default()` (a date alone is 09:00, the label zh-Hans).
    pub fn parse(text: &str, now: DateTime) -> Option<When>;
    pub struct When { pub range: std::ops::Range<usize>, pub at: DateTime, pub label: String }
    pub struct Options { pub default_time: jiff::civil::Time /* a date alone; 09:00 */, pub lang: Lang /* ZhHans */ }
    /// The label's language: zh-Hans "明天 09:00" / "周五 15:00" / "11月20日 09:00", zh-Hant "後天 09:00" /
    /// "週五 15:00", en "Tomorrow 9:00 AM" / "Fri 3:00 PM" / "Nov 20 9:00 AM", ja "明日 9:00" / "金曜 15:00" /
    /// "11月20日 9:00". Today / tomorrow / (the day after, where the language has a word) / the weekday within the
    /// coming week / the month and day.
    pub enum Lang { ZhHans, ZhHant, En, Ja }
    impl Lang { pub fn from_locale(locale: &str) -> Lang; }  // "zh-TW" / "zh-Hant" → ZhHant, other zh → ZhHans, ja, else En
    /// A to-do line with its phrase replaced by ` ⏰ YYYY-MM-DD HH:mm` (whatever the language), or None when it
    /// has none / is not an open to-do.
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
`Calendar` and `TimeField`, set with the button or ⌘↩, then "Remove Reminder". It opens with the first choice focused:
↑↓ move among the choices, Return picks, Tab reaches the calendar and the field, Escape closes (its keys are bound
after the panel's, so they win). The open note writes through `editor.edit` (the changed part of the line only:
undo takes it back in one step and the caret stays; `withDue` in app/tasks.ts mirrors `set_todo_due`); the to-do
view through `Notes.setTodoDue`, its row following to its new group, still selected.
