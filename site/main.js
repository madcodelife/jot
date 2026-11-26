// Jot's site: the language switch, the panel on the stage (⌥⌥, search, to-dos, AI apps writing in), the AI apps
// demo, the time phrases, the island, the themes and the lock. No dependencies.
(function () {
  "use strict";

  /* Themes: the app's own (app/ui/theme.json and themes.json), the keys the panel uses. */
  const THEME_KEYS = ["primary", "on-accent", "glass-fg", "glass-muted", "glass-line", "glass-hover", "glass-fill", "glass-edge", "glass-shadow", "agent", "agent-ink", "due", "late", "paper", "paper-fg", "paper-muted"];
  const THEMES = {"default":{"swatch":{"light":"#e9ebf1","dark":"#2a2c34"},"light":["#0064e1","#ffffff","#14151a","#14151aa8","#14151a1a","#14151a0f","#ffffffb3","#ffffff4d","#1e285038","#e8743b","#a64818","#0066cc","#a82020","#ffffff","#1a1b20","#6b707c"],"dark":["#0058d0","#ffffff","#f3f4f8","#f3f4f8a8","#ffffff1a","#ffffff12","#1c1d24b3","#ffffff24","#00000080","#f08a55","#f39a6a","#4ea1ff","#ff8f8f","#1b1c21","#eceef3","#8e93a1"]},"github":{"swatch":{"light":"#f6f8fa","dark":"#010409"},"light":["#0969da","#ffffff","#1f2328","#656d76","#1f23281a","#1f23280f","#f6f8faf0","#ffffff4d","#3e3e3e38","#bc4c00","#bc4c00","#0966d3","#c9212d","#ffffff","#1f2328","#656d76"],"dark":["#1d69df","#ffffff","#e6edf3","#7d8590","#e6edf31f","#e6edf314","#010409f0","#ffffff24","#00000080","#db6d28","#db6d28","#4493f8","#f85149","#0d1117","#e6edf3","#7d8590"]},"one":{"swatch":{"light":"#eaeaeb","dark":"#21252b"},"light":["#386ad5","#ffffff","#383a42","#666973","#383a421a","#383a420f","#eaeaebf0","#ffffff4d","#3a3a3b38","#c18401","#8d6001","#3462c6","#c61242","#fafafa","#383a42","#696c77"],"dark":["#61afef","#282c34","#b2b8c4","#8e939c","#b2b8c41f","#b2b8c414","#21252bf0","#ffffff24","#00000080","#d19a66","#d19a66","#61afef","#e78b92","#282c34","#b2b8c4","#8e939c"]},"dracula":{"swatch":{"light":"#f5f0dc","dark":"#21222c"},"light":["#644ac9","#ffffff","#1f1f1f","#6c664b","#1f1f1f1a","#1f1f1f0f","#f5f0dcf0","#ffffff4d","#3d3c3738","#a34d14","#a34d14","#644ac9","#bb3527","#fffbeb","#1f1f1f","#6c664b"],"dark":["#bd93f9","#282a36","#f8f8f2","#8390b7","#f8f8f21f","#f8f8f214","#21222cf0","#ffffff24","#00000080","#ffb86c","#ffb86c","#bd93f9","#ff7777","#282a36","#f8f8f2","#8390b7"]},"tokyo":{"swatch":{"light":"#d6d8df","dark":"#16161e"},"light":["#2959aa","#ffffff","#343b59","#5c5d69","#343b591a","#343b590f","#d6d8dff0","#ffffff4d","#36363838","#965027","#904d25","#2959aa","#8c4351","#e6e7ed","#343b59","#656773"],"dark":["#7aa2f7","#1a1b26","#c0caf5","#7b82a3","#c0caf51f","#c0caf514","#16161ef0","#ffffff24","#00000080","#ff9e64","#ff9e64","#7aa2f7","#f7768e","#1a1b26","#c0caf5","#7b82a3"]},"catppuccin":{"swatch":{"light":"#e6e9ef","dark":"#181825"},"light":["#8839ef","#ffffff","#484b64","#64677c","#484b641a","#484b640f","#e6e9eff0","#ffffff4d","#3a3a3c38","#fe640b","#b24608","#7c34d9","#bd0e33","#eff1f5","#484b64","#6a6d82"],"dark":["#cba6f7","#1e1e2e","#cdd6f4","#a6adc8","#cdd6f41f","#cdd6f414","#181825f0","#ffffff24","#00000080","#fab387","#fab387","#cba6f7","#f38ba8","#1e1e2e","#cdd6f4","#a6adc8"]},"gruvbox":{"swatch":{"light":"#f2e5bc","dark":"#1d2021"},"light":["#427b58","#ffffff","#3c3836","#70645a","#3c38361a","#3c38360f","#f2e5bcf0","#ffffff4d","#3c392f38","#af3a03","#af3a03","#3a6c4d","#9d0006","#fbf1c7","#3c3836","#776b60"],"dark":["#8ec07c","#282828","#ebdbb2","#9a8c7e","#ebdbb21f","#ebdbb214","#1d2021f0","#ffffff24","#00000080","#fe8019","#fe8019","#8ec07c","#fc7565","#282828","#ebdbb2","#9a8c7e"]},"contrast":{"swatch":{"light":"#ffffff","dark":"#000000"},"light":["#003eb8","#ffffff","#000000","#3a3a3a","#00000066","#0000001f","#ffffff","#000000","#00000059","#943600","#943600","#0036a3","#8a0009","#ffffff","#000000","#3a3a3a"],"dark":["#80b3ff","#000000","#ffffff","#d0d0d0","#ffffff73","#ffffff29","#000000","#ffffff","#000000","#ffa36b","#ffa36b","#8dbbff","#ff9090","#000000","#ffffff","#cfcfcf"]}};
  const THEME_NAMES = {
    default: ["Default", "默认"], github: "GitHub", one: "One", dracula: "Dracula", tokyo: "Tokyo Night",
    catppuccin: "Catppuccin", gruvbox: "Gruvbox", contrast: ["High Contrast", "高对比度"],
  };
  const VAR = {
    primary: "--p-primary", "on-accent": "--p-on", "glass-fg": "--p-fg", "glass-muted": "--p-muted",
    "glass-line": "--p-line", "glass-hover": "--p-hover", "glass-fill": "--p-fill", "glass-edge": "--p-edge",
    "glass-shadow": "--p-shadow", agent: "--p-agent", "agent-ink": "--p-agent-ink", due: "--p-due", late: "--p-late",
    paper: "--p-paper", "paper-fg": "--p-paper-fg", "paper-muted": "--p-paper-muted",
  };

  const root = document.documentElement;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const lang = () => root.dataset.lang;
  const t = (en, zh) => (lang() === "zh" ? zh : en);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const icon = (id, cls) => `<svg class="ic${cls ? " " + cls : ""}"><use href="#i-${id}"/></svg>`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Language. */
  const onLang = [];
  function setLang(l) {
    root.dataset.lang = l;
    root.lang = l === "zh" ? "zh-CN" : "en";
    store.set("jot-lang", l);
    onLang.forEach((f) => f());
  }
  $$("[data-lang-toggle]").forEach((b) => b.addEventListener("click", () => setLang(lang() === "zh" ? "en" : "zh")));

  /* Nav border once the page scrolls (an observer on the hero's top, not a scroll listener). */
  const navSentinel = document.createElement("div");
  navSentinel.style.cssText = "position:absolute;top:0;height:1px;width:1px";
  document.body.prepend(navSentinel);
  new IntersectionObserver(([e]) => $(".nav").classList.toggle("is-scrolled", !e.isIntersecting)).observe(navSentinel);

  /* Reveal on scroll. */
  const revealer = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); revealer.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px" });
  $$(".reveal").forEach((el) => revealer.observe(el));

  /* Copy and toast. */
  const toastEl = $("#toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 1800);
  }
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.classList.add("is-copied");
      b.querySelector("use").setAttribute("href", "#i-check");
      toast(t("Copied. Paste it into Terminal.", "已复制，去终端粘贴运行"));
      setTimeout(() => { b.classList.remove("is-copied"); b.querySelector("use").setAttribute("href", "#i-copy"); }, 1800);
    } catch (e) {
      toast(t("Select the command to copy it.", "复制失败，请手动选中命令"));
    }
  }));

  /* Time phrases: what Jot reads in a to-do, in English, Chinese and Japanese (a subset, for the page). */
  const pad = (n) => String(n).padStart(2, "0");
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  const num = (s) => (s == null ? NaN : /^\d+$/.test(s) ? +s : CN_NUM[s] != null ? CN_NUM[s] : NaN);
  const EN_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const ZH_DAYS = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const JA_DAYS = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  function weekday(now, wd, next) {
    const today = startOfDay(now);
    if (next) {
      const monday = addDays(today, -((today.getDay() + 6) % 7) + 7);
      return addDays(monday, (wd + 6) % 7);
    }
    return addDays(today, (wd - today.getDay() + 7) % 7);
  }

  function parseDue(text, now) {
    let s = " " + text + " ";
    let day = null; let hour = null; let min = 0; let exact = null;
    const take = (re, f) => {
      const m = s.match(re);
      if (!m) return false;
      if (f(m) === false) return false;
      s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
      return true;
    };
    // Relative: in 2 hours, 半小时后, 30分钟后, 2時間後.
    take(/\bin\s+(half an hour|an? hour|(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d))\b/i, (m) => {
      if (/half/i.test(m[1])) exact = new Date(+now + 30 * 6e4);
      else if (/^an? hour/i.test(m[1])) exact = new Date(+now + 36e5);
      else if (/^d/i.test(m[3])) day = addDays(now, +m[2]);
      else exact = new Date(+now + +m[2] * (/^h/i.test(m[3]) ? 36e5 : 6e4));
    }) ||
    take(/(半|[\d一二两三四五六七八九十]+)\s*(个)?(小时|分钟|天)后/, (m) => {
      if (m[1] === "半") { exact = new Date(+now + 30 * 6e4); return; }
      const n = num(m[1]);
      if (isNaN(n)) return false;
      if (m[3] === "天") day = addDays(now, n);
      else exact = new Date(+now + n * (m[3] === "小时" ? 36e5 : 6e4));
    }) ||
    take(/(\d+)\s*(時間|分)後/, (m) => { exact = new Date(+now + +m[1] * (m[2] === "分" ? 6e4 : 36e5)); });

    if (!exact) {
      // The day.
      take(/\b(day after tomorrow)\b/i, () => { day = addDays(now, 2); }) ||
      take(/\b(today|tonight)\b/i, (m) => { day = startOfDay(now); if (/night/i.test(m[1])) hour = 20; }) ||
      take(/\b(tomorrow|tmr)\b/i, () => { day = addDays(now, 1); }) ||
      take(/\b(next\s+)?(?:on\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i, (m) => { day = weekday(now, EN_DAYS.indexOf(m[2].toLowerCase()), !!m[1]); }) ||
      take(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(st|nd|rd|th)?\b/i, (m) => {
        day = new Date(now.getFullYear(), MONTHS.indexOf(m[1].toLowerCase()), +m[2]);
        if (day < startOfDay(now)) day.setFullYear(day.getFullYear() + 1);
      }) ||
      take(/大后天/, () => { day = addDays(now, 3); }) ||
      take(/后天|明後日|あさって/, () => { day = addDays(now, 2); }) ||
      take(/明天|明日|あした/, () => { day = addDays(now, 1); }) ||
      take(/今天|今日|今晚/, (m) => { day = startOfDay(now); if (m[0] === "今晚") hour = 20; }) ||
      take(/(下(?:个)?)?(?:周|星期|礼拜)([一二三四五六日天])/, (m) => { day = weekday(now, ZH_DAYS[m[2]], !!m[1]); }) ||
      take(/(来週)?\s*([日月火水木金土])曜日?/, (m) => { day = weekday(now, JA_DAYS[m[2]], !!m[1]); }) ||
      take(/(\d{1,2})月(\d{1,2})[日号]/, (m) => {
        day = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
        if (day < startOfDay(now)) day.setFullYear(day.getFullYear() + 1);
      }) ||
      take(/(\d{1,2})[日号](?![\d])/, (m) => {
        day = new Date(now.getFullYear(), now.getMonth(), +m[1]);
        if (day < startOfDay(now)) day.setMonth(day.getMonth() + 1);
      });

      // The time.
      take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => {
        hour = (+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0); min = +(m[2] || 0);
      }) ||
      take(/\b(?:at\s+)?noon\b/i, () => { hour = 12; min = 0; }) ||
      take(/\bat\s+(\d{1,2}):(\d{2})\b/i, (m) => { hour = +m[1]; min = +m[2]; }) ||
      take(/(上午|早上|早晨|中午|下午|傍晚|晚上)?\s*([\d一二两三四五六七八九十]{1,3})\s*[点點:：]\s*(半|\d{1,2})?\s*分?/, (m) => {
        let h = num(m[2]);
        if (isNaN(h) || h > 24) return false;
        if (/下午|傍晚|晚上/.test(m[1] || "") && h < 12) h += 12;
        if (m[1] === "中午" && h < 11) h += 12;
        hour = h; min = m[3] === "半" ? 30 : +(m[3] || 0);
      }) ||
      take(/(午前|午後)?\s*(\d{1,2})\s*時\s*(半|(\d{1,2})\s*分)?/, (m) => {
        let h = +m[2];
        if (m[1] === "午後" && h < 12) h += 12;
        hour = h; min = m[3] === "半" ? 30 : +(m[4] || 0);
      });
    }

    let due = exact;
    if (!due && (day || hour != null)) {
      if (hour == null) { hour = 9; min = 0; } // a date without a time means 9:00
      due = new Date((day || startOfDay(now)).getFullYear(), (day || now).getMonth(), (day || now).getDate(), hour, min);
      if (!day && due <= now) due = addDays(due, 1); // a time alone: the next one
      due.setHours(hour, min, 0, 0);
    }
    const rest = s.replace(/\s+/g, " ").replace(/\s+([,，。.])/g, "$1").trim();
    return { due, rest };
  }

  const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function dueLabel(d, now) {
    const days = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (days === 0) return t("Today ", "今天 ") + hm;
    if (days === 1) return t("Tomorrow ", "明天 ") + hm;
    if (days > 1 && days < 7) {
      return (lang() === "zh" ? "周" + "日一二三四五六"[d.getDay()] + " " : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " ") + hm;
    }
    return lang() === "zh" ? `${d.getMonth() + 1}月${d.getDate()}日 ${hm}` : `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ${d.getDate()} ${hm}`;
  }

  /* The panel's notes. */
  const NOTES = () => [
    { kind: "todos", title: t("3 to-dos today", "今天 3 条待办"), sub: t("1 overdue · Next: 17:00 Ship the onboarding redesign", "1 条过期 · 下一条：17:00 上线新版引导页") },
    { title: t("This week", "本周"), sub: t("Three things that matter, everything else can wait.", "只做三件要紧的事，其他的先放一放。"), when: t("2 min ago", "2 分钟前"),
      body: [["p", t("Three things that matter, everything else can wait.", "只做三件要紧的事，其他的先放一放。")], ["todo", t("Ship the onboarding redesign", "上线新版引导页"), "17:00"], ["todo", t("Call the landlord about the heating", "打电话给房东说暖气的事"), "18:30"], ["todo", t("Renew the passport", "续签护照")]] },
    { title: t("Design review", "设计评审"), sub: t("Summary of today's review of the new onboarding flow.", "今天评审新版引导流程的结论。"), src: "Claude", when: t("25 min ago", "25 分钟前"),
      body: [["p", t("Summary of today's review of the new onboarding flow.", "今天评审新版引导流程的结论。")], ["p", t("Keep the three-step layout; cut the welcome video.", "保留三步布局，去掉欢迎视频。")], ["todo", t("Sam: copy for the permission prompt", "Sam：权限弹窗的文案")]] },
    { title: "Homelab", sub: t("Ubuntu box. Host: nas.local, user admin, key in 1Password.", "Ubuntu 主机：nas.local，用户 admin，密钥在 1Password。"), when: t("Today 09:52", "今天 09:52"),
      body: [["p", t("Ubuntu box. Host: nas.local, user admin, key in 1Password.", "Ubuntu 主机：nas.local，用户 admin，密钥在 1Password。")], ["code", "ssh admin@nas.local"]] },
    { title: t("Deploy with Docker Compose", "用 Docker Compose 部署"), sub: t("The steps we used to deploy the API to staging.", "上次把 API 部署到预发环境的步骤。"), src: "Claude Code", when: t("Today 08:42", "今天 08:42"),
      body: [["p", t("The steps we used to deploy the API to staging.", "上次把 API 部署到预发环境的步骤。")], ["code", "docker compose -f compose.prod.yml up -d --build"]] },
    { title: t("Trip to Kyoto", "京都之行"), sub: t("Dec 12 to Dec 18, five nights in Higashiyama.", "12 月 12 日到 18 日，在东山住五晚。"), when: t("Today 06:02", "今天 06:02"),
      body: [["p", t("Dec 12 to Dec 18, five nights in Higashiyama.", "12 月 12 日到 18 日，在东山住五晚。")], ["todo", t("Book the ryokan", "订旅馆"), "21:00"]] },
    { title: t("Git snippets", "Git 片段"), sub: t("Undo the last commit, keep the changes: git reset --soft HEAD~1", "撤销上次提交，但保留改动：git reset --soft HEAD~1"), src: "Cursor", when: t("Yesterday", "昨天"),
      body: [["p", t("Undo the last commit, keep the changes:", "撤销上次提交，但保留改动：")], ["code", "git reset --soft HEAD~1"]] },
  ];
  const INCOMING = () => [
    { title: t("Standup notes", "站会记录"), sub: t("Shipped the panel fix. Next: reminders after the Mac wakes.", "面板的问题修好上线了，接下来做唤醒后补发提醒。"), src: "Claude", color: "#d97757" },
    { title: t("Date regex", "日期正则"), sub: t("\\d{4}-\\d{2}-\\d{2} matches 2026-11-26.", "\\d{4}-\\d{2}-\\d{2} 能匹配 2026-11-26。"), src: "Cursor", color: "#3d3d47" },
    { title: t("Release checklist", "发版清单"), sub: t("Bump the version, tag it, run package-macos.sh.", "改版本号、打 tag，再跑 package-macos.sh。"), src: "Codex", color: "#10a37f" },
  ];
  const TODOS = () => [
    { group: t("Overdue", "已过期"), late: true, items: [[t("Renew the passport", "续签护照"), t("This week", "本周"), t("Yesterday 09:00", "昨天 09:00")]] },
    { group: t("Today", "今天"), items: [[t("Ship the onboarding redesign", "上线新版引导页"), t("This week", "本周"), "17:00"], [t("Call the landlord about the heating", "打电话给房东说暖气的事"), t("This week", "本周"), "18:30"], [t("Book the ryokan", "订旅馆"), t("Trip to Kyoto", "京都之行"), "21:00"]] },
    { group: t("Tomorrow", "明天"), items: [[t("Review Maya's pull request", "看 Maya 的 PR"), t("This week", "本周"), "10:30"], [t("Send the weekly report", "给团队发周报"), t("This week", "本周"), "16:00"]] },
  ];

  /* The panel. */
  const stage = $("#stage");
  const panel = $("#panel");
  const body = $("#panel-body");
  const q = $("#q");
  const hintsEl = $("#hints");
  const keys = $$(".key");
  const P = { open: false, busy: false, view: "list", drawn: null, sel: 1, extra: [], made: [], done: new Set(), note: null, touched: false };

  function rows() {
    const all = NOTES();
    const lead = all.shift();
    const notes = [...P.made, ...P.extra, ...all];
    const query = q.value.trim().toLowerCase();
    if (!query) return [lead, ...notes];
    const hit = notes.filter((n) => (n.title + " " + n.sub).toLowerCase().includes(query));
    return hit.length ? hit : [{ kind: "create", title: q.value.trim() }];
  }

  function rowHTML(n, i, sel) {
    const cls = ["row", i === sel ? "is-sel" : "", n.fresh ? "is-new" : ""].join(" ");
    if (n.kind === "todos") {
      return `<div class="${cls}" data-i="${i}" style="--i:${i}"><span class="row-ic is-todo">${icon("list")}</span><span class="row-t"><div class="row-title">${esc(n.title)}</div><div class="row-sub">${esc(n.sub)}</div></span><span class="row-meta"><span class="dots"><i></i><i></i><i></i></span></span></div>`;
    }
    if (n.kind === "create") {
      return `<div class="${cls}" data-i="${i}" style="--i:0"><span class="row-ic">${icon("plus")}</span><span class="row-t"><div class="row-title">${t("Create", "新建")} “${esc(n.title)}”</div><div class="row-sub">${t("A new note with this title", "用这个标题新建笔记")}</div></span><span class="row-meta"></span></div>`;
    }
    const agent = !!n.src;
    return `<div class="${cls}" data-i="${i}" style="--i:${i}"><span class="row-ic${agent ? " is-agent" : ""}">${icon(agent ? "spark" : "doc")}</span><span class="row-t"><div class="row-title">${esc(n.title)}</div><div class="row-sub">${esc(n.sub)}</div></span><span class="row-meta">${agent ? `<span class="row-src">${esc(n.src)}</span>` : ""}<span>${esc(n.when || "")}</span></span></div>`;
  }

  function hints(list) {
    hintsEl.innerHTML = list.map(([label, k]) => `<span>${esc(label)} ${k.map((x) => `<kbd>${x}</kbd>`).join("")}</span>`).join("");
  }

  function fit() {
    const inner = body.firstElementChild;
    body.style.height = (inner ? Math.min(inner.scrollHeight, 410) + (P.view === "paper" ? 6 : 0) : 0) + "px";
  }

  function render() {
    if (!P.open) return;
    const query = q.value.trim();
    if (P.view !== "paper") P.view = /^(\/?todo|待办|\/待办)$/i.test(query) ? "todo" : "list";
    let html = "";
    if (P.view === "list") {
      const list = rows();
      P.sel = Math.max(0, Math.min(P.sel, list.length - 1));
      html = list.map((n, i) => rowHTML(n, i, P.sel)).join("");
      const create = list[0] && list[0].kind === "create";
      hints(create ? [[t("Create", "新建"), [icon("return")]]] : [[t("Open", "打开"), [icon("return")]], [t("Actions", "操作"), ["⌘", "K"]]]);
    } else if (P.view === "todo") {
      let i = 0;
      html = TODOS().map((g) => {
        const items = g.items.filter((it) => !P.done.has(it[0]));
        if (!items.length) return "";
        const head = `<div class="group${g.late ? " is-late" : ""}" style="--i:${i++}">${esc(g.group)} <b>${items.length}</b></div>`;
        return head + items.map((it) => `<div class="trow-p${i === 1 ? " is-sel" : ""}" style="--i:${i++}" data-todo="${esc(it[0])}"><button class="tick" type="button" aria-label="${t("Done", "完成")}">${icon("check")}</button><span class="trow-title">${esc(it[0])}</span><span class="trow-note">${esc(it[1])}</span><span class="pchip${g.late ? " is-late" : ""}">${icon("alarm")}${esc(it[2])}</span></div>`).join("");
      }).join("") || `<div class="group">${t("Nothing left. Nice.", "都做完了")}</div>`;
      hints([[t("Open Note", "打开笔记"), [icon("return")]], [t("Actions", "操作"), ["⌘", "K"]]]);
    } else {
      const n = P.note;
      const lines = (n.body || []).map((l) => {
        if (l[0] === "p") return `<p>${esc(l[1])}</p>`;
        if (l[0] === "code") return `<p><code>${esc(l[1])}</code></p>`;
        return `<p class="pl-todo"><i></i>${esc(l[1])}${l[2] ? ` <span class="pchip">${icon("alarm")}${esc(l[2])}</span>` : ""}</p>`;
      }).join("");
      html = `<div class="ppaper"><h4>${esc(n.title)}</h4>${n.src ? `<div class="psrc">${esc(n.src)}</div>` : ""}${n.isNew ? `<textarea placeholder="${t("Write something. It saves as you type.", "写点什么，会自动保存")}"></textarea>` : lines}</div>`;
      hints([[t("Back", "返回"), ["esc"]]]);
    }
    // Rows rise in only when a view first shows (the panel opening, the to-do view, a note); redrawing the same view
    // (typing, a note arriving, a tick) swaps the rows in place, or every keystroke would flash the whole list.
    const fresh = P.drawn !== P.view;
    P.drawn = P.view;
    body.innerHTML = `<div class="panel-in${fresh ? " is-fresh" : ""}">${html}</div>`;
    P.extra.forEach((n) => { n.fresh = false; });
    fit();
    if (P.view === "paper" && P.note.isNew) {
      const ta = $("textarea", body);
      ta.focus({ preventScroll: true });
      ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); back(); } });
    }
  }

  // Moving the selection only moves the highlight; the rows stay as they are.
  function select(i) {
    P.sel = i;
    $$(".row", body).forEach((r) => r.classList.toggle("is-sel", +r.dataset.i === i));
    const row = $(`.row[data-i="${i}"]`, body);
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  function back() {
    P.view = "list"; P.note = null; q.value = ""; P.sel = 1;
    render();
    q.focus({ preventScroll: true });
  }

  function activate(i) {
    const list = rows();
    const n = list[i];
    if (!n) return;
    if (n.kind === "todos") { q.value = t("todo", "待办"); render(); return; }
    if (n.kind === "create") {
      const note = { title: n.title, sub: t("Just now", "刚刚"), when: t("Just now", "刚刚"), isNew: true };
      P.made.unshift(note);
      P.view = "paper"; P.note = note;
      render();
      return;
    }
    P.view = "paper"; P.note = n;
    render();
  }

  async function pressKeys() {
    for (const k of keys) {
      k.classList.add("is-down", "is-lit");
      await wait(110);
      k.classList.remove("is-down");
      setTimeout(() => k.classList.remove("is-lit"), 600);
      await wait(70);
    }
  }

  async function summon(opts) {
    if (P.busy) return;
    if (P.open) { dismiss(); return; }
    P.busy = true;
    P.touched = P.touched || !opts.auto;
    await pressKeys();
    stage.dataset.state = "open";
    panel.hidden = false;
    panel.classList.remove("is-out", "is-open");
    panel.classList.add("is-in", "is-capsule");
    q.value = ""; P.view = "list"; P.drawn = null; P.sel = 1; P.extra = []; P.done.clear();
    q.placeholder = t("Search or create…", "搜索或新建…");
    if (!opts.auto) q.focus({ preventScroll: true });
    P.open = true;
    await wait(still.matches ? 0 : 260);
    panel.classList.remove("is-capsule");
    panel.classList.add("is-open");
    render();
    P.busy = false;
    scheduleAgents();
  }

  async function dismiss() {
    if (!P.open) return;
    P.open = false; P.busy = true;
    clearTimeout(agentTimer);
    $("#cursors").innerHTML = "";
    body.style.height = "0px";
    panel.classList.remove("is-open");
    panel.classList.add("is-capsule");
    await wait(still.matches ? 0 : 200);
    panel.classList.add("is-out");
    await wait(still.matches ? 0 : 240);
    panel.hidden = true;
    panel.classList.remove("is-in", "is-out");
    stage.dataset.state = "idle";
    if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
    P.busy = false;
  }

  keys.forEach((k) => k.addEventListener("click", () => { P.touched = true; summon({}); }));
  stage.addEventListener("click", (e) => {
    if (P.open && !panel.contains(e.target) && !e.target.closest(".key")) dismiss();
  });
  q.addEventListener("input", () => { P.sel = q.value.trim() ? 0 : 1; if (P.view === "paper") P.view = "list"; render(); });
  q.addEventListener("keydown", (e) => {
    const n = $$(".row", body).length;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); select((P.sel + 1) % n); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); select((P.sel - 1 + n) % n); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (P.view === "list") activate(P.sel);
      else if (P.view === "todo") { P.view = "paper"; P.note = NOTES()[1]; render(); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (P.view === "paper") back();
      else if (q.value) { q.value = ""; P.sel = 1; render(); }
      else dismiss();
    }
  });
  body.addEventListener("click", (e) => {
    const tick = e.target.closest(".tick");
    if (tick) {
      const row = tick.closest(".trow-p");
      tick.classList.add("is-on"); row.classList.add("is-ticked");
      setTimeout(() => row.classList.add("is-done"), 450);
      setTimeout(() => { P.done.add(row.dataset.todo); render(); }, 850);
      return;
    }
    const row = e.target.closest(".row");
    if (row) { P.sel = +row.dataset.i; activate(P.sel); }
  });
  body.addEventListener("mousemove", (e) => {
    const row = e.target.closest(".row");
    if (row && +row.dataset.i !== P.sel && P.view === "list") {
      $$(".row", body).forEach((r) => r.classList.toggle("is-sel", r === row));
      P.sel = +row.dataset.i;
    }
  });

  // ⌥ pressed twice, anywhere on the page (as in the app). Another key between the two presses cancels it.
  let lastAlt = 0; let altCount = 0;
  addEventListener("keydown", (e) => {
    if (e.key !== "Alt") { lastAlt = 0; return; }
    if (e.repeat) return;
    const now = performance.now();
    if (P.state !== "open" && !P.open) {
      const k = keys[altCount++ % 2];
      k.classList.add("is-down", "is-lit");
      setTimeout(() => k.classList.remove("is-down"), 120);
      setTimeout(() => k.classList.remove("is-lit"), 600);
    }
    if (now - lastAlt < 450) {
      lastAlt = 0;
      e.preventDefault();
      P.touched = true;
      const r = stage.getBoundingClientRect();
      if (r.bottom < 120 || r.top > innerHeight - 160) stage.scrollIntoView({ behavior: still.matches ? "auto" : "smooth", block: "center" });
      summon({});
    } else lastAlt = now;
  });
  addEventListener("keyup", (e) => { if (e.key === "Alt" && e.altKey === false) { /* released: wait for the next press */ } });

  // Played once by itself when the stage comes into view and nobody has touched it, so phones see it too.
  let autoTimer;
  new IntersectionObserver(([e]) => {
    clearTimeout(autoTimer);
    if (e.isIntersecting && !P.touched && !P.open) autoTimer = setTimeout(() => { if (!P.touched && !P.open) summon({ auto: true }); }, 3200);
  }, { threshold: 0.55 }).observe(stage);
  let stageSeen = false;
  new IntersectionObserver(([e]) => { stageSeen = e.isIntersecting; }, { threshold: 0.3 }).observe(stage);

  /* AI apps writing into the open panel: a named cursor flies in, a note arrives. */
  let agentTimer; let agentN = 0;
  function scheduleAgents() {
    clearTimeout(agentTimer);
    if (agentN >= INCOMING().length) return;
    agentTimer = setTimeout(agentVisit, agentN === 0 ? 2600 : 6500);
  }
  async function agentVisit() {
    if (!P.open || P.view !== "list" || q.value || document.hidden || !stageSeen || P.busy) { scheduleAgents(); return; }
    const a = INCOMING()[agentN];
    const sr = stage.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const cur = document.createElement("div");
    cur.className = "acur";
    cur.style.setProperty("--c", a.color);
    cur.innerHTML = `${icon("pointer")}<span>${esc(a.src)}</span>`;
    const fromLeft = agentN % 2 === 0;
    const sx = fromLeft ? -60 : sr.width + 20;
    const sy = sr.height * (0.55 + 0.2 * Math.random());
    cur.style.transform = `translate(${sx}px, ${sy}px)`;
    $("#cursors").append(cur);
    await wait(30);
    const tx = (pr.left - sr.left) + pr.width * (fromLeft ? 0.3 : 0.62);
    const ty = (pr.top - sr.top) + 66 + 54 + 20;
    if (!still.matches) cur.style.transform = `translate(${tx}px, ${ty}px)`;
    await wait(still.matches ? 0 : 1250);
    if (!P.open || P.view !== "list" || q.value) { cur.remove(); scheduleAgents(); return; }
    cur.classList.add("is-click");
    const note = Object.assign({}, a, { when: t("Just now", "刚刚"), fresh: true });
    P.extra.unshift(note);
    agentN++;
    if (P.sel >= 1) P.sel++;
    render();
    await wait(700);
    cur.style.opacity = "0";
    cur.style.transform = `translate(${fromLeft ? tx - 140 : tx + 140}px, ${ty + 160}px)`;
    await wait(1300);
    cur.remove();
    scheduleAgents();
  }

  /* Themes. */
  let themeName = store.get("jot-theme");
  if (!THEMES[themeName]) themeName = "default";
  const swatchesEl = $("#swatches");
  function applyTheme(name) {
    themeName = name;
    const vals = THEMES[name][dark.matches ? "dark" : "light"];
    [stage, $("#mini"), ...keys].forEach((el) => THEME_KEYS.forEach((k, i) => el.style.setProperty(VAR[k], vals[i])));
    $$(".sw", swatchesEl).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.theme === name)));
    const label = THEME_NAMES[name];
    $("#theme-name").textContent = Array.isArray(label) ? t(label[0], label[1]) : label;
    store.set("jot-theme", name);
  }
  function drawSwatches() {
    swatchesEl.innerHTML = Object.keys(THEMES).map((n) => {
      const m = dark.matches ? "dark" : "light";
      const label = THEME_NAMES[n];
      return `<button class="sw" type="button" role="radio" data-theme="${n}" aria-label="${esc(Array.isArray(label) ? label[0] : label)}" style="--sw-bg:${THEMES[n].swatch[m]};--sw-fg:${THEMES[n][m][0]}"></button>`;
    }).join("");
    applyTheme(themeName);
  }
  swatchesEl.addEventListener("click", (e) => { const b = e.target.closest(".sw"); if (b) applyTheme(b.dataset.theme); });
  dark.addEventListener("change", drawSwatches);
  drawSwatches();

  /* AI apps demo: an ask, the tool it calls, what lands in the notebook. */
  function nextWeekday(wd, h) { const d = weekday(new Date(), wd, false); d.setHours(h, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 7); return d; }
  const ASKS = () => {
    const fri = nextWeekday(5, 9);
    return [
      { app: "Claude Code", q: t("Jot this command down.", "帮我把这条命令记一下"),
        call: `create_note(<em>"${t("Deploy with Docker Compose", "用 Docker Compose 部署")}"</em>, …)`,
        title: t("Deploy with Docker Compose", "用 Docker Compose 部署"), src: "Claude Code",
        lines: [["p", t("The steps we used to deploy the API to staging.", "上次把 API 部署到预发环境的步骤。")], ["pre", "docker compose -f compose.prod.yml up -d --build"]] },
      { app: "Claude", q: t("Remind me to send the weekly report on Friday.", "周五提醒我发周报"),
        call: `add_todo(<em>"${t("Send the weekly report", "发周报")}"</em>, due: <em>"${stamp(fri)}"</em>)`,
        title: t("This week", "本周"), src: t("To-do added by Claude", "Claude 加的待办"),
        lines: [["todo", t("Ship the onboarding redesign", "上线新版引导页"), "17:00", true], ["todo", t("Send the weekly report", "发周报"), dueLabel(fri, new Date())]] },
      { app: "Cursor", q: t("What's on my list today?", "我今天要干嘛？"),
        call: `list_todos(<em>"today"</em>)`,
        title: t("3 open today, 1 overdue", "今天还有 3 件，1 件已过期"), src: t("Cursor read your to-dos", "Cursor 查了你的待办"),
        lines: [["todo", t("Renew the passport", "续签护照"), t("Yesterday 09:00", "昨天 09:00"), true], ["todo", t("Ship the onboarding redesign", "上线新版引导页"), "17:00", true], ["todo", t("Call the landlord about the heating", "打电话给房东说暖气的事"), "18:30", true], ["todo", t("Book the ryokan", "订旅馆"), "21:00", true]] },
    ];
  };
  const asksEl = $("#asks"); const paperEl = $("#ai-paper"); const callEl = $("#call");
  let askI = 0; let askAuto = true; let askTimer; let typing = 0; let aiSeen = false;
  const ASK_MS = 6500;
  function drawAsks() {
    asksEl.innerHTML = ASKS().map((a, i) => `<button class="ask${i === askI ? " is-on" : ""}${askAuto ? " is-auto" : ""}" type="button" role="tab" aria-selected="${i === askI}" data-i="${i}" style="--dur:${ASK_MS}ms"><span class="ask-app">${esc(t(`Ask ${a.app}`, `对 ${a.app} 说`))}</span><span class="ask-q">${esc(a.q)}</span><span class="ask-bar"><i></i></span></button>`).join("");
  }
  async function showAsk(i, animate) {
    askI = i; drawAsks();
    const a = ASKS()[i];
    const run = ++typing;
    callEl.innerHTML = `<b>${esc(a.app)}</b> ${a.call}`;
    paperEl.innerHTML = `<h4></h4><div class="src">${icon("spark")}${esc(a.src)}</div><div class="lines"></div>`;
    const h = $("h4", paperEl); const linesEl = $(".lines", paperEl);
    const type = async (el, text) => {
      if (!animate || still.matches) { el.textContent = text; return; }
      const caret = document.createElement("span"); caret.className = "caret";
      for (let k = 1; k <= text.length; k++) {
        if (run !== typing) return;
        el.textContent = text.slice(0, k); el.append(caret);
        await wait(text.length > 40 ? 14 : 24);
      }
      caret.remove();
    };
    await type(h, a.title);
    for (const l of a.lines) {
      if (run !== typing) return;
      let el;
      if (l[0] === "p") { el = document.createElement("p"); linesEl.append(el); el.className = "new"; await type(el, l[1]); }
      else if (l[0] === "pre") { el = document.createElement("pre"); el.className = "new"; linesEl.append(el); await type(el, l[1]); }
      else {
        el = document.createElement("p"); el.className = "pl-todo new";
        el.innerHTML = `<i></i><span></span><span class="chip">${icon("alarm")}${esc(l[2])}</span>`;
        linesEl.append(el);
        if (l[3]) $("span", el).textContent = l[1]; else await type($("span", el), l[1]);
        if (animate) await wait(120);
      }
    }
    if (askAuto && aiSeen) { clearTimeout(askTimer); askTimer = setTimeout(() => showAsk((askI + 1) % 3, true), ASK_MS); }
  }
  asksEl.addEventListener("click", (e) => {
    const b = e.target.closest(".ask"); if (!b) return;
    askAuto = false; clearTimeout(askTimer);
    showAsk(+b.dataset.i, true);
  });
  new IntersectionObserver(([e]) => {
    const was = aiSeen; aiSeen = e.isIntersecting;
    if (aiSeen && !was && askAuto) { clearTimeout(askTimer); showAsk(askI, true); }
    if (!aiSeen) clearTimeout(askTimer);
  }, { threshold: 0.4 }).observe($("#ai"));
  showAsk(0, false);

  /* Time phrases. */
  const tin = $("#tinput"); const tfile = $("#tfile"); const trow = $("#trow"); const tchips = $("#tchips");
  const EXAMPLES = ["call mom in 2 hours", "standup next monday 10:30", "交房租 明天 9点", "下周五 下午3点 看牙", "明日 9時 ミーティング"];
  let lastDue = null;
  function parseLine() {
    const raw = tin.value.replace(/^\s*-\s*\[\s?\]\s*/, "");
    const now = new Date();
    const { due, rest } = parseDue(raw, now);
    const text = rest || raw.trim();
    lastDue = { text, due };
    if (!raw.trim()) {
      tfile.innerHTML = `- [ ] …`;
      trow.innerHTML = `<span class="is-none">${t("Type a to-do and a time.", "写一条待办，带上时间试试")}</span>`;
      return;
    }
    tfile.innerHTML = `- [ ] ${esc(text)}${due ? ` <b>⏰ ${stamp(due)}</b>` : ""}`;
    trow.innerHTML = `<span class="tbox" aria-hidden="true"></span><span>${esc(text)}</span>${due ? `<span class="chip">${icon("alarm")}${esc(dueLabel(due, now))}</span>` : `<span class="is-none" style="margin-left:auto">${t("No time yet", "没写时间")}</span>`}`;
  }
  function drawChips() {
    tchips.innerHTML = EXAMPLES.map((x) => `<button class="tchip" type="button">${esc(x)}</button>`).join("");
  }
  tchips.addEventListener("click", (e) => { const b = e.target.closest(".tchip"); if (b) { tin.value = b.textContent; parseLine(); } });
  tin.addEventListener("input", parseLine);
  function defaultLine() { tin.value = t("pay rent tomorrow 9am", "交房租 明天 9点"); parseLine(); }
  drawChips(); defaultLine();

  /* The island: a reminder coming due. */
  const island = $("#island"); const ringBtn = $("#ring");
  let islandTimer;
  function ring(title) {
    island.querySelector(".island-in").innerHTML = `<span class="island-bell">${icon("bell")}</span><span class="island-t"><small>${t("Reminder", "提醒")}</small><b>${esc(title)}</b></span><button class="island-done" type="button">${icon("check")}${t("Done", "完成")}</button>`;
    island.classList.add("is-peek");
    setTimeout(() => island.classList.add("is-open"), still.matches ? 0 : 280);
    clearTimeout(islandTimer);
    islandTimer = setTimeout(closeIsland, 7000);
  }
  function closeIsland() {
    island.classList.remove("is-open");
    setTimeout(() => island.classList.remove("is-peek"), still.matches ? 0 : 320);
  }
  island.addEventListener("click", (e) => {
    if (!e.target.closest(".island-done")) return;
    $(".island-t b", island).style.textDecoration = "line-through";
    clearTimeout(islandTimer);
    islandTimer = setTimeout(closeIsland, 600);
  });
  ringBtn.addEventListener("click", async () => {
    const title = (lastDue && lastDue.text) || t("Pay rent", "交房租");
    ringBtn.disabled = true;
    const label = ringBtn.querySelector(`[data-${lang()}]`);
    const keep = label.textContent;
    for (let s = 3; s > 0; s--) { label.textContent = t(`Ringing in ${s}…`, `${s} 秒后提醒…`); await wait(1000); }
    label.textContent = keep;
    ringBtn.disabled = false;
    ring(title);
  });

  /* The lock. */
  const lockCell = $("#lockcell"); const lockBtn = $("#lock"); const lockAgent = $("#lock-agent");
  function drawLock(tried) {
    const locked = lockCell.dataset.locked === "true";
    lockAgent.classList.remove("is-denied");
    if (locked) {
      lockAgent.innerHTML = `${icon("spark")}<span>${t("Claude tried to append. The note is locked, so it can only read it.", "Claude 想往里加内容，但笔记锁着，它只能看。")}</span>`;
      if (tried) { void lockAgent.offsetWidth; lockAgent.classList.add("is-denied"); }
    } else {
      lockAgent.innerHTML = `${icon("spark")}<span>${t("Claude appended", "Claude 追加了")} <span class="add">+ ${t("Router: 192.168.1.1", "路由器：192.168.1.1")}</span></span>`;
    }
  }
  lockBtn.addEventListener("click", () => {
    const locked = lockCell.dataset.locked !== "true";
    lockCell.dataset.locked = String(locked);
    lockBtn.setAttribute("aria-pressed", String(locked));
    lockBtn.setAttribute("aria-label", locked ? t("Unlock", "解锁") : t("Lock", "锁定"));
    drawLock(locked);
  });
  drawLock(false);

  /* Everything that carries words, again in the other language. */
  onLang.push(() => {
    q.placeholder = t("Search or create…", "搜索或新建…");
    P.extra = INCOMING().slice(0, agentN).reverse().map((a) => Object.assign({}, a, { when: t("Just now", "刚刚") }));
    if (P.view === "paper" && !P.note.isNew) P.view = "list";
    render();
    clearTimeout(askTimer); showAsk(askI, false);
    defaultLine();
    applyTheme(themeName);
    drawLock(false);
  });
})();
