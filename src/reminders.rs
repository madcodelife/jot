//! `Reminders`: fires at the to-dos' due times while the app runs.
//!
//! One thread per started `Reminders` sleeps until the earliest open to-do
//! comes due, then sends the to-dos due by then to the engine thread
//! (`relay`), which calls the app's listener. The thread keeps the open
//! to-dos in memory and reads the folder again only when the folder watcher
//! says it changed, so it neither polls nor rereads the notes while it waits.
//!
//! Sleep: the waits are measured on a clock that stops while the Mac
//! sleeps, so a wait is never longer than [`MAX_WAIT`]; after each one the
//! thread compares how far the wall clock moved with how long it waited. A
//! jump (the Mac slept, the clock was set) makes what came due meanwhile one
//! `missed: true` event.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use jiff::civil::DateTime;
use jiff::tz::TimeZone;
use jiff::{SignedDuration, Timestamp};
use jot_store::{Store, Watcher};
use nsh_core::prelude::*;
use tokio::sync::mpsc::UnboundedSender;

use crate::notes::{Notes, Todo, store_error};
use crate::relay::relay;

/// The longest wait before the thread checks the wall clock again: how
/// late a reminder that came due during the Mac's sleep can be noticed.
const MAX_WAIT: Duration = Duration::from_secs(60);
/// How far the wall clock may move past the waited time before the thread
/// calls it a jump (sleep, a clock change) rather than drift.
const JUMP: Duration = Duration::from_secs(10);

/// Calls the app at the open to-dos' due times while the app runs.
#[class]
pub struct Reminders {
    store: Store,
    /// Snoozed to-dos, shared with the thread (kept across `start`s).
    snoozes: Arc<Mutex<Vec<Snooze>>>,
    /// Wakes the thread; dropping it (and the watcher's clone) ends it.
    control: Option<Sender<Message>>,
    /// Tells the thread when the folder changed.
    watcher: Option<Watcher>,
}

#[class]
impl Reminders {
    /// Reminders for the to-dos of `notes`' folder; nothing fires until
    /// `start`.
    pub fn new(notes: &Notes) -> Self {
        Reminders {
            store: notes.store().clone(),
            snoozes: Arc::default(),
            control: None,
            watcher: None,
        }
    }

    /// Calls `onDue` when open to-dos come due: once per due time with
    /// every to-do due then, and once after the Mac wakes with every to-do
    /// that came due while it slept (`missed: true`). To-dos already due
    /// when it starts do not fire. Replaces the listener of an earlier
    /// call.
    pub fn start(
        &mut self,
        #[args(event)] on_due: Callback<DueEvent>,
        cx: CallCx<'_>,
    ) -> Result<(), JsError> {
        // The old thread ends once both of its senders are gone.
        self.control = None;
        self.watcher = None;
        let events = relay(cx, move |event| on_due.post(event));
        let (control, messages) = mpsc::channel();
        let rescan = control.clone();
        let watcher = self
            .store
            .watch(move || {
                let _ = rescan.send(Message::Rescan);
            })
            .map_err(|e| store_error(e, "cannot watch the notes folder for reminders"))?;
        let store = self.store.clone();
        let snoozes = self.snoozes.clone();
        thread::Builder::new()
            .name("jot-reminders".into())
            .spawn(move || run(&store, &messages, &snoozes, &events))
            .map_err(|e| JsError::Error(format!("cannot start the reminders' thread: {e}")))?;
        self.control = Some(control);
        self.watcher = Some(watcher);
        Ok(())
    }

    /// Fires the to-do at `line` of `note` again `minutes` from now (more
    /// than 0), if it is still open then. Kept in memory only: quitting
    /// the app forgets it.
    pub fn snooze(&mut self, note: String, line: u32, minutes: f64) -> Result<(), JsError> {
        if !(minutes.is_finite() && minutes > 0.0) {
            return Err(JsError::Range(format!(
                "Reminders.snooze: `minutes` is more than 0, got {minutes}"
            )));
        }
        let at = SignedDuration::try_from_secs_f64(minutes * 60.0)
            .ok()
            .and_then(|later| now().checked_add(later).ok())
            .ok_or_else(|| {
                JsError::Range(format!("Reminders.snooze: {minutes} minutes is too far"))
            })?;
        let line = line as usize;
        {
            let mut snoozes = self.snoozes.lock().unwrap_or_else(PoisonError::into_inner);
            snoozes.retain(|s| !(s.note == note && s.line == line));
            snoozes.push(Snooze { note, line, at });
        }
        if let Some(control) = &self.control {
            let _ = control.send(Message::Wake);
        }
        Ok(())
    }
}

/// To-dos that came due.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct DueEvent {
    /// The to-dos, by due time.
    pub todos: Vec<Todo>,
    /// Whether they came due while the Mac slept (or the clock jumped), so
    /// the app shows one summary ("2 missed reminders") instead of each.
    pub missed: bool,
}

/// What wakes the thread before its deadline.
enum Message {
    /// The folder changed: read the to-dos again.
    Rescan,
    /// A snooze was added: look at the deadline again.
    Wake,
}

/// A to-do snoozed until `at`.
#[derive(Debug, Clone, PartialEq)]
struct Snooze {
    note: String,
    line: usize,
    at: DateTime,
}

/// The thread: waits for the next due time, sends what came due, until
/// every sender of `messages` is gone or the engine stops listening.
fn run(
    store: &Store,
    messages: &Receiver<Message>,
    snoozes: &Mutex<Vec<Snooze>>,
    events: &UnboundedSender<DueEvent>,
) {
    let mut todos = open_todos(store).unwrap_or_default();
    let mut fired_up_to = now();
    loop {
        let next = next_due(&todos, &lock(snoozes), fired_up_to);
        let (wall, clock) = (SystemTime::now(), Instant::now());
        let first = match next {
            Some(at) => messages.recv_timeout(until(at).min(MAX_WAIT)),
            // Nothing to wait for: only a change or a snooze can add some.
            None => messages.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        let mut rescan = match first {
            Ok(Message::Rescan) => true,
            Ok(Message::Wake) | Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => return,
        };
        loop {
            match messages.try_recv() {
                Ok(Message::Rescan) => rescan = true,
                Ok(Message::Wake) => {}
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }
        let missed = jumped(wall, clock);
        let now = now();
        // What came due is judged by the to-dos as they were until now
        // (the watcher keeps them current): a to-do written just now with
        // a time already past does not fire.
        let due = take_due(&todos, &mut lock(snoozes), fired_up_to, now);
        fired_up_to = now;
        if !due.is_empty() {
            let todos = due.into_iter().map(Todo::from).collect();
            if events.send(DueEvent { todos, missed }).is_err() {
                // The engine stopped listening (its VM went).
                return;
            }
        }
        if rescan {
            if let Some(fresh) = open_todos(store) {
                drop_rescheduled(&mut lock(snoozes), &todos, &fresh);
                todos = fresh;
            }
        }
    }
}

/// The open to-dos of the folder, or `None` when it cannot be read (the
/// thread keeps what it had).
fn open_todos(store: &Store) -> Option<Vec<jot_store::Todo>> {
    let mut todos = store.todos().ok()?;
    todos.retain(|todo| !todo.done);
    Some(todos)
}

/// The earliest time something fires after `after`: an open to-do's due
/// time or a snooze.
fn next_due(todos: &[jot_store::Todo], snoozes: &[Snooze], after: DateTime) -> Option<DateTime> {
    let due = todos
        .iter()
        .filter_map(|todo| todo.due)
        .filter(|due| *due > after);
    let snoozed = snoozes.iter().map(|s| s.at);
    due.chain(snoozed).min()
}

/// The open to-dos due in `(after, now]`, and those whose snooze ended by
/// `now` (removed from `snoozes`; a snooze whose to-do is gone or checked
/// is dropped), each once, by due time.
fn take_due(
    todos: &[jot_store::Todo],
    snoozes: &mut Vec<Snooze>,
    after: DateTime,
    now: DateTime,
) -> Vec<jot_store::Todo> {
    let mut due: Vec<jot_store::Todo> = todos
        .iter()
        .filter(|todo| todo.due.is_some_and(|at| after < at && at <= now))
        .cloned()
        .collect();
    let mut ended = Vec::new();
    snoozes.retain(|snooze| {
        let keep = snooze.at > now;
        if !keep {
            ended.push(snooze.clone());
        }
        keep
    });
    for snooze in ended {
        let found = todos
            .iter()
            .find(|todo| todo.note == snooze.note && todo.line == snooze.line);
        if let Some(todo) = found {
            if !due
                .iter()
                .any(|d| d.note == todo.note && d.line == todo.line)
            {
                due.push(todo.clone());
            }
        }
    }
    due.sort_by_key(|todo| todo.due);
    due
}

/// Drops the snoozes of to-dos whose time changed between `before` and
/// `after` (the user picked a new one, or removed it): the new time is the
/// reminder now, which the rescan's to-dos fire at.
fn drop_rescheduled(
    snoozes: &mut Vec<Snooze>,
    before: &[jot_store::Todo],
    after: &[jot_store::Todo],
) {
    let due = |todos: &[jot_store::Todo], snooze: &Snooze| {
        todos
            .iter()
            .find(|todo| todo.note == snooze.note && todo.line == snooze.line)
            .map(|todo| (todo.text.clone(), todo.due))
    };
    snoozes.retain(|snooze| match (due(before, snooze), due(after, snooze)) {
        (Some((text, was)), Some((same, now))) => text != same || was == now,
        _ => true,
    });
}

/// Whether the wall clock moved further than the time waited since
/// `wall` / `clock` were read: the Mac slept, or the clock was set.
fn jumped(wall: SystemTime, clock: Instant) -> bool {
    let moved = SystemTime::now().duration_since(wall).unwrap_or_default();
    moved > clock.elapsed() + JUMP
}

/// The time left until local time `at`, zero once it passed.
fn until(at: DateTime) -> Duration {
    let Ok(zoned) = at.to_zoned(TimeZone::system()) else {
        return MAX_WAIT;
    };
    let left = zoned.timestamp().duration_since(Timestamp::now());
    Duration::try_from(left).unwrap_or(Duration::ZERO)
}

/// The local wall-clock time.
fn now() -> DateTime {
    jiff::Zoned::now().datetime()
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use jiff::civil::date;

    use super::*;

    fn todo(note: &str, line: usize, due: Option<DateTime>) -> jot_store::Todo {
        jot_store::Todo {
            note: note.into(),
            line,
            text: format!("{note} {line}"),
            done: false,
            due,
            done_on: None,
        }
    }

    #[test]
    fn fires_what_came_due_since_the_last_look() {
        let nine = date(2026, 11, 14).at(9, 0, 0, 0);
        let ten = date(2026, 11, 14).at(10, 0, 0, 0);
        let todos = [
            todo("a", 0, Some(nine)),
            todo("a", 1, Some(ten)),
            todo("b", 0, None),
        ];
        let mut snoozes = Vec::new();
        assert_eq!(
            next_due(&todos, &snoozes, nine - SignedDuration::from_mins(1)),
            Some(nine)
        );
        assert_eq!(next_due(&todos, &snoozes, nine), Some(ten));
        let due = take_due(
            &todos,
            &mut snoozes,
            nine - SignedDuration::from_secs(1),
            nine,
        );
        assert_eq!(due, vec![todos[0].clone()]);
        // Already past when looked at: nothing again.
        assert!(
            take_due(
                &todos,
                &mut snoozes,
                nine,
                nine + SignedDuration::from_mins(5)
            )
            .is_empty()
        );
        // Both after a long sleep.
        assert_eq!(
            take_due(
                &todos,
                &mut snoozes,
                nine - SignedDuration::from_mins(1),
                ten
            )
            .len(),
            2
        );
    }

    #[test]
    fn snoozes_fire_once_while_the_todo_is_open() {
        let nine = date(2026, 11, 14).at(9, 0, 0, 0);
        let later = nine + SignedDuration::from_mins(10);
        let todos = [todo("a", 0, Some(nine))];
        let mut snoozes = vec![
            Snooze {
                note: "a".into(),
                line: 0,
                at: later,
            },
            Snooze {
                note: "gone".into(),
                line: 3,
                at: later,
            },
        ];
        assert_eq!(next_due(&todos, &snoozes, nine), Some(later));
        assert!(
            take_due(
                &todos,
                &mut snoozes,
                nine,
                later - SignedDuration::from_secs(1)
            )
            .is_empty()
        );
        assert_eq!(snoozes.len(), 2);
        let due = take_due(&todos, &mut snoozes, nine, later);
        assert_eq!(due, vec![todos[0].clone()]);
        assert!(snoozes.is_empty());
    }

    #[test]
    fn a_new_time_replaces_the_snooze() {
        let nine = date(2026, 11, 14).at(9, 0, 0, 0);
        let snoozed = nine + SignedDuration::from_mins(10);
        let friday = date(2026, 11, 20).at(15, 0, 0, 0);
        let before = [todo("a", 0, Some(nine)), todo("b", 0, Some(nine))];
        let mut snoozes = vec![
            Snooze {
                note: "a".into(),
                line: 0,
                at: snoozed,
            },
            Snooze {
                note: "b".into(),
                line: 0,
                at: snoozed,
            },
        ];
        // `a` moved to Friday; `b` kept its time (another line of its note changed).
        let after = [todo("a", 0, Some(friday)), todo("b", 0, Some(nine))];
        drop_rescheduled(&mut snoozes, &before, &after);
        assert_eq!(snoozes.len(), 1);
        assert_eq!(snoozes[0].note, "b");
        // The new time is what fires: not at the snooze's end, at Friday's.
        assert_eq!(next_due(&after[..1], &snoozes[..0], nine), Some(friday));
        assert!(take_due(&after[..1], &mut Vec::new(), nine, snoozed).is_empty());
        assert_eq!(
            take_due(&after[..1], &mut Vec::new(), nine, friday),
            vec![after[0].clone()]
        );

        // Its time removed: the snooze goes too, and nothing fires.
        let cleared = [todo("b", 0, None)];
        drop_rescheduled(&mut snoozes, &after, &cleared);
        assert!(snoozes.is_empty());
        assert_eq!(next_due(&cleared, &snoozes, nine), None);
    }
}
