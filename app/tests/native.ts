// The stand-ins every test gives `jot/native`, so no test reaches the machine's own Jot: the double press stands in as
// granted, nothing reads or writes `~/Library/Application Support/Jot` (the AI apps' setting, `ai.json`, and
// their activity log, `activity.jsonl`), the system lets apps play interface sounds, whatever this Mac's setting,
// and nothing asks Apple Notes for the user's notes (the import is there, and fails). A test that needs one of these
// spreads its own after them (app/tests/island.test.tsx gives a log of its own).
export const STAND_INS = {
  "Summon.isTrusted": true,
  "Summon.requestTrust": null,
  "Summon.onDoubleTap": null,
  "AiAccess.allowsTrashAndRewrite": false,
  "AiAccess.set": null,
  "ActivityLog.path": null,
  "SoundEffects.systemAllows": true,
  "AppleNotes.available": true,
  "AppleNotes.import": async () => {
    throw new Error("not in tests");
  },
};
