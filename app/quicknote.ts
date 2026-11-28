// A quick note said anywhere (the double press of ⌥ held): where it is
// filed. With a time in it, a to-do that reminds then (in the to-do note),
// repeating when it says so ("每天9点吃药"); without, a line in the inbox
// note with the time it was said. Pure: the notes, the inbox's name and the
// time phrases' options come in, so tests call it on a folder of their own.
import { When, type Notes, type WhenOptions } from "jot/native";

/** Where a quick note went. */
export type Filed =
  | { kind: "todo"; text: string; label: string; note: string }
  | { kind: "inbox"; text: string; note: string };

/** Words people put before a reminder that the to-do does not need ("提醒我交房租" is "交房租"). */
const LEAD_IN = /^(?:请|請)?(?:提醒我|提醒|记得|記得|别忘了|別忘了|remind me to|remind me|don't forget to|リマインド|忘れずに)[\s,，、:：]*/i;
/** Punctuation the phrase leaves at either end ("明天，交房租。" → "交房租"). */
const EDGES = /^[\s,，、.。:：;；!！?？]+|[\s,，、.。:：;；!！?？]+$/g;

/** `HH:mm`, 24-hour, as the inbox's lines start. */
export const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** The to-do's text: the phrase taken out, the lead-in and stray punctuation gone; the whole text when nothing is left. */
export function todoText(text: string, start: number, end: number): string {
  const rest = `${text.slice(0, start)} ${text.slice(end)}`.replace(/\s+/g, " ").replace(EDGES, "");
  const bare = rest.replace(LEAD_IN, "").replace(EDGES, "");
  return bare || rest || text.trim();
}

/** Files `text` in `notes`: a to-do when it says a time (`When.parse` reads one), else a line of `inbox`. Throws what the store throws. */
export function fileQuickNote(notes: Notes, text: string, options: { inbox: string; when: WhenOptions; now: Date }): Filed {
  const said = text.trim();
  const match = When.parse(said, options.when);
  if (match) {
    const todo = notes.addTodo(todoText(said, match.start, match.end), match.due, null, match.repeat ?? null);
    return { kind: "todo", text: todo.text, label: match.label, note: todo.note };
  }
  const meta = notes.append(options.inbox, `- ${clock(options.now)} ${said}`);
  return { kind: "inbox", text: said, note: meta.title };
}
