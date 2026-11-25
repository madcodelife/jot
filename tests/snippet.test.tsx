// The list's snippets: a note's preview (its body on one line, as the store
// makes it) or a search snippet, shown as words alone. Pure functions, no app.
import { expect, test } from "nsh/test";
import { plainSnippet } from "../app/tasks";

test("a code fence and its language go, the code's words stay", () => {
  expect(
    plainSnippet("发布 jot-mcp： ```sh cargo build --release -p jot-mcp claude mcp add jot -- ./target/release/jot-mcp ```"),
  ).toBe("发布 jot-mcp： cargo build --release -p jot-mcp claude mcp add jot -- ./target/release/jot-mcp");
});

test("list, quote and heading markers go", () => {
  expect(plainSnippet("> 慢慢来，比较快。")).toBe("慢慢来，比较快。");
  expect(plainSnippet("## 第一天 - 伏见稻荷，早上 7 点前到 - 午饭：锦市场 ## 第二天")).toBe(
    "第一天 伏见稻荷，早上 7 点前到 午饭：锦市场 第二天",
  );
  expect(plainSnippet("> - 引用里的列表 * 星号 + 加号")).toBe("引用里的列表 星号 加号");
});

test("task boxes stay as ○ and ✓; reminders and stamps go", () => {
  expect(plainSnippet("- 发布节奏改成两周一次 - [ ] 交设计稿反馈 ⏰ 2026-11-14 14:00 - [ ] 准备续签材料 ⏰ 2026-11-20 09:00")).toBe(
    "发布节奏改成两周一次 ○ 交设计稿反馈 ○ 准备续签材料",
  );
  expect(plainSnippet("- [x] 交水电费 ✅ 2026-11-12 - [X] 续签")).toBe("✓ 交水电费 ✓ 续签");
});

test("inline code, emphasis and links keep their text", () => {
  expect(plainSnippet("家里：`orange-cat-2024` 公司访客：`lb-guest`")).toBe("家里：orange-cat-2024 公司访客：lb-guest");
  expect(plainSnippet("看 [文档](https://example.com/a) 的 **重点** 和 ~~旧的~~")).toBe("看 文档 的 重点 和 旧的");
});

test("a search snippet's cut marks stay next to the text", () => {
  expect(plainSnippet("…- [ ] 买咖啡豆 - [x] 交水电费 ✅ 2026-11-1…")).toBe("…○ 买咖啡豆 ✓ 交水电费…");
  expect(plainSnippet("…> 比较快 ⏰ 2026-11-14 0…")).toBe("…比较快…");
});

test("lines are joined with a dot, empty ones dropped", () => {
  expect(plainSnippet("# 标题\n\n> 引用\n```\ncode\n```\n- a")).toBe("标题 · 引用 · code · a");
});

test("dashes, arrows and numbers inside the text stay", () => {
  expect(plainSnippet("2027-03 到期，a -> b，--dir，C# 1. 第一步")).toBe("2027-03 到期，a -> b，--dir，C# 1. 第一步");
});

test("a single star or underscore around words goes, as the double ones do; a lone one or an identifier's stays", () => {
  expect(plainSnippet("今天把 **Jot** 的编辑器走一遍，看看 *Markdown* 的每种元素")).toBe("今天把 Jot 的编辑器走一遍，看看 Markdown 的每种元素");
  expect(plainSnippet("_slowly_ is fine")).toBe("slowly is fine");
  expect(plainSnippet("x*y*z and snake_case_name")).toBe("x*y*z and snake_case_name");
});

test("a sign between numbers is no list marker, and a lone star or tilde pair is no emphasis", () => {
  expect(plainSnippet("面积 2 * 3 = 6，余 5 - 3，再 1 + 1")).toBe("面积 2 * 3 = 6，余 5 - 3，再 1 + 1");
  expect(plainSnippet("(2 + 3) * (4 - 1)")).toBe("(2 + 3) * (4 - 1)");
  expect(plainSnippet("2 ** 10 = 1024，约 ~~ 1000")).toBe("2 ** 10 = 1024，约 ~~ 1000");
  // Still markers: a list after a number's line, and one starting with a number.
  expect(plainSnippet("买 3 个 - 牛奶 - 2 盒鸡蛋")).toBe("买 3 个 牛奶 2 盒鸡蛋");
});
