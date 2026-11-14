import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
test("Return on a note puts the caret in its editor", async () => {
  const dir = `/tmp/jot-focus-${Date.now()}`;
  new Notes(dir).create("京都行程", "第一天");
  const app = await open("./App.tsx", { platform: "macos", width: 1200, height: 800, reducedMotion: true, locale: "zh-CN", storage: { "jot.dir": dir },
    modules: { "jot/native": { "Summon.isTrusted": true, "Summon.requestTrust": null, "Summon.onDoubleTap": null } } });
  await app.waitFor("id:search");
  await app.type("id:search", "京都");
  await app.submit("id:search");
  await app.wait(500);
  await app.keyboard.press("x");
  await app.wait(800);
  await app.wait(600);
  expect(new Notes(dir).read("京都行程")?.body).toContain("x");
});
