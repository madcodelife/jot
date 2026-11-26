// The stand-ins every test gives `jot/native`, so no test reaches the machine's own Jot: the double press stands in as
// granted, and nothing reads or writes `~/Library/Application Support/Jot` (the AI apps' setting, `ai.json`, and
// their activity log, `activity.jsonl`). A test that needs one of these spreads its own after them
// (app/tests/island.test.tsx gives a log of its own).
export const STAND_INS = {
  "Summon.isTrusted": true,
  "Summon.requestTrust": null,
  "Summon.onDoubleTap": null,
  "AiAccess.allowsTrashAndRewrite": false,
  "AiAccess.set": null,
  "ActivityLog.path": null,
};
