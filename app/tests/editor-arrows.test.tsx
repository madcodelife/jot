import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

// The panel is a window of its own: the editor's keys have to work there too.
test("the arrow keys move the caret in the opened note", async () => {
  const dir = `/tmp/jot-arrows-${Date.now()}`;
  new Notes(dir).create("arrows", "abc\ndef\nghi");
  const app = await open("../App.tsx", { platform: "macos", width: 1200, height: 800, reducedMotion: true, locale: "zh-CN", storage: { "jot.dir": dir },
    modules: { "jot/native": { ...STAND_INS } } });
  await app.waitFor("id:search");
  await app.type("id:search", "arrows");
  await app.submit("id:search");
  await app.wait(500);
  for (const key of ["down", "1", "right", "2", "up", "3"]) await app.keyboard.press(key);
  await app.wait(1400);
  expect(new Notes(dir).read("arrows")?.body).toBe("abc3\n1d2ef\nghi");
});
