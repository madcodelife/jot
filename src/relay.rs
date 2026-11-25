//! Values from other threads (the folder watcher, the reminders' thread,
//! AppKit's event monitors) brought back to the engine thread, where JS
//! callbacks can be posted.
//!
//! A `Callback` lives on the engine thread only, so the other thread sends
//! into a channel and a task of the core, started from the JS call, receives
//! and posts. Dropping every sender ends the task, which then drops what it
//! delivers to (the callback): replacing a listener is dropping the old
//! sender.

use nsh_core::prelude::*;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

/// A sender whose values reach `deliver` on the engine thread, in order,
/// for as long as a clone of it lives.
pub(crate) fn relay<T: Send + 'static>(
    cx: CallCx<'_>,
    mut deliver: impl FnMut(T) + 'static,
) -> UnboundedSender<T> {
    let (sender, mut receiver) = unbounded_channel();
    cx.start(async move {
        while let Some(value) = receiver.recv().await {
            deliver(value);
        }
    });
    sender
}
