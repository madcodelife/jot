// The AI apps Jot's MCP server is registered with: what the settings' AI page
// shows and does. The work (reading the apps' configuration, running
// `claude`) is `Connections` in `jot/native`; this keeps its answers.
import { signal, untracked, type Signal } from "nsh";
import { Connections, type AiClient } from "jot/native";

/** The apps and Jot's place in each, for the notes folder (`null` until first read). */
export const aiClients = signal<AiClient[] | null>(null);
/** The apps being connected or disconnected, by id. */
export const aiBusy = signal<Readonly<Record<string, true>>>({});
/** What went wrong with an app, by id, until it is tried again. */
export const aiErrors = signal<Readonly<Record<string, string>>>({});

/** Sets (or, `null`, clears) the entry `id` of the record signal `record`. */
function setEntry<T>(record: Signal<Readonly<Record<string, T>>>, id: string, value: T | null) {
  const next = { ...untracked(record) };
  if (value === null) delete next[id];
  else next[id] = value;
  record.set(next);
}

/** Puts `client` in place of its old self. */
const replace = (client: AiClient) => aiClients.set((untracked(aiClients) ?? []).map((c) => (c.id === client.id ? client : c)));

/** The sync under way: a read waits for it, so it never shows the apps as they were before it. */
let syncing: Promise<void> | null = null;
/** Each read or sync of the whole list takes the next number; only the newest one's answer is shown. */
let latest = 0;

/** Reads every app's state for the notes folder `dir` (after the sync under way, if any). */
export async function refreshClients(dir: string) {
  if (syncing) await syncing;
  const mine = ++latest;
  let clients: AiClient[];
  try {
    clients = await Connections.clients(dir);
  } catch {
    clients = [];
  }
  if (mine === latest) aiClients.set(clients);
}

/** Connects (or disconnects) the app `id` for the notes folder `dir`. */
export async function toggleClient(id: string, dir: string, on: boolean) {
  setEntry(aiBusy, id, true);
  setEntry(aiErrors, id, null);
  try {
    replace(await (on ? Connections.connect(id, dir) : Connections.disconnect(id, dir)));
  } catch (error) {
    setEntry(aiErrors, id, error instanceof Error ? error.message : String(error));
  } finally {
    setEntry(aiBusy, id, null);
  }
}

/** The notes folder is now `dir`: every connected app follows it (those Jot cannot write keep their error). A
 * read started meanwhile waits for it; one already under way is outdated, and the list is read again after. */
export function syncClients(dir: string): Promise<void> {
  const run = async () => {
    const mine = ++latest;
    try {
      const clients = await Connections.sync(dir);
      for (const client of clients) setEntry(aiErrors, client.id, client.error ?? null);
      if (mine === latest) aiClients.set(clients);
    } catch {
      // Read below.
    }
  };
  const done: Promise<void> = run().finally(() => {
    if (syncing === done) syncing = null;
  });
  syncing = done;
  return done.then(() => refreshClients(dir));
}
