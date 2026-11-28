import { expect, open, test } from "nsh/test";
import { Notes } from "jot/native";
import { STAND_INS } from "./native";

/** Searches `query` in a panel on `dir`, opens the first row with Return and types "x" in the note. */
async function openAndType(dir: string, query: string) {
  const app = await open("../App.tsx", { platform: "macos", width: 1200, height: 800, reducedMotion: true, locale: "en", storage: { "jot.dir": dir },
    modules: { "jot/native": { ...STAND_INS } } });
  await app.waitFor("id:search");
  await app.type("id:search", query);
  await app.submit("id:search");
  await app.wait(500);
  await app.keyboard.press("x");
  await app.wait(1400);
}

test("A search's hit in a note's body opens with the first query term there selected", async () => {
  const dir = `/tmp/jot-jump-${Date.now()}`;
  const filler = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
  new Notes(dir).create("Server notes", `${filler}\nthe NGINX config lives in /etc\nnginx again`);
  // "server" is in the title only; "nginx" is the first term the body has: its first occurrence, whatever its case.
  await openAndType(dir, "server nginx");
  const body = new Notes(dir).read("Server notes")?.body ?? "";
  expect(body).toContain("the x config lives in /etc\nnginx again");
});

test("A title's hit, as written or by pinyin, opens as before: nothing selected", async () => {
  const dir = `/tmp/jot-jump-title-${Date.now()}`;
  const notes = new Notes(dir);
  notes.create("Nginx", "nginx here");
  notes.create("服务器", "fwq list");
  // The "x" went in beside the text, not over a term.
  await openAndType(dir, "nginx");
  const nginx = new Notes(dir).read("Nginx")?.body ?? "";
  expect(nginx).toContain("nginx here");
  expect(nginx.trim().length).toBe("nginx here".length + 1);
  await openAndType(dir, "fwq");
  const server = new Notes(dir).read("服务器")?.body ?? "";
  expect(server).toContain("fwq list");
  expect(server.trim().length).toBe("fwq list".length + 1);
});
