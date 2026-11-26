<p align="center">
  <img src="design/logo/loop/png/jot-horizontal.png" alt="Jot" width="240">
</p>

# Jot

你和 AI 应用共用的 macOS 速记本。

[下载](https://github.com/madcodelife/jot/releases/latest) · [安装](#安装) · [English](README.md)

在任何地方连按两下 ⌥，就会弹出一个浮窗。浮窗里只有一个输入框，它既是搜索框，也是新笔记的标题：打几个字，要么找到以前
记过的，要么按回车新建一条。笔记是你选定的文件夹里的普通 Markdown 文件，你的 AI 应用（Claude、Cursor、Codex……）也能
搜索、读取、追加同一批笔记，你和它们共用一个本子。

<p align="center">
  <img src="design/screenshots/light.png" alt="浅色模式、Indigo 主题下的 Jot 浮窗：最近的笔记，其中几条由 Claude、Claude Code 和 Cursor 写下" width="49%" align="top">
  <img src="design/screenshots/dark.png" alt="深色模式、Tokyo Night 主题下的 Jot 待办视图：未完成的待办按过期、今天、明天、以后分组，每条带着所在笔记和提醒时间" width="49%" align="top">
</p>

- **随处呼出** — 连按两下 ⌥，搜索和新建都在同一个输入框里，按 Esc 就收起。
- **Markdown 实时预览** — 像 Typora 那样，光标所在处才显示 Markdown 符号。边写边保存。
- **待办长在笔记里** — `- [ ] 交房租 明天 9:00` 就成了一条提醒，到点弹通知。中文、英文、日文的时间说法都认。
- **和 AI 应用共用** — 一键连接 Claude Code、Claude、Cursor、VS Code、Windsurf、Codex 或 Gemini CLI；应用写的笔记
  带着它的名字。
- **普通文件，归你所有** — 一条笔记一个 `.md` 文件，放在 iCloud 云盘或任何文件夹里。不用注册账号，没有服务器。

## 安装

在 Mac 上（Apple 芯片或 Intel）：

```sh
curl -fsSL https://madcodelife.github.io/jot/install.sh | sh
```

它会下载适合这台 Mac 的最新版，把 `Jot.app` 放进 `/Applications`（没有写权限时放进 `~/Applications`），然后打开。
笔记不受影响。

之后 Jot 会自己更新：在后台检查并下载新版本，面板底栏和菜单栏菜单里会出现「重启」入口（退出 Jot 时也会自动装上）。
在「设置 → 关于」里可以立即检查。再跑一次安装命令同样可以更新。

也可以从 [Releases](https://github.com/madcodelife/jot/releases) 下载 `Jot-<版本>-macos-arm64.zip`（Apple 芯片）或
`Jot-<版本>-macos-x86_64.zip`（Intel），解压后把 `Jot.app` 拖进「应用程序」。Jot 没有经过 Apple 公证，第一次打开前先运行一次
`xattr -dr com.apple.quarantine /Applications/Jot.app`。

## 使用

- **打开浮窗**：连按两下 ⌥。第一次 macOS 会请求辅助功能权限，连按 ⌥ 需要它；没授权时用 ⌃⌥J 打开。
- **查找或新建**：边输入边按标题和正文过滤；搜不到时按回车，就以输入内容为标题新建。
- **操作笔记**：在一行上按 ⌘K，可以打开、重命名、复制、在访达中显示、锁定或移到废纸篓（可撤销）。
- **待办**：输入「待办」（或 `/todo`）列出所有没勾掉的待办，按时间分组；⇧⌘D 改提醒时间。
- **语音输入**：按住 ⌥ 说话，写进搜索框或笔记；在任何 App 里连按两下 ⌥ 并按住，记一条速记。
- **锁定笔记**：⌘K →「锁定」让笔记只读，Jot、你的 AI 应用和其他任何程序都改不了它（访达里的「已锁定」）。
- **连接 AI 应用**：设置 → AI 应用，每个点一下。然后就可以对它们说「把这个命令记到 Jot」「提醒我周五交周报」
  「我今天有什么要做的」。

深浅色外观，浮窗主题有 Jot 自己的靛蓝、GitHub、One、Dracula、Tokyo Night、Catppuccin、Gruvbox 和高对比。界面支持
简体中文、繁体中文、英文和日文。

## 你的笔记

- 一条笔记就是笔记文件夹里的一个 `.md` 文件，文件名就是标题。打开了 iCloud 云盘时文件夹默认是 `iCloud 云盘/Jot`，
  否则是 `~/Documents/Jot`；可以在设置里改。
- 提醒在笔记里写成普通的时间：`- [ ] 交房租 ⏰ 2026-11-14 09:00`；勾掉的待办记下日期：`- [x] 交房租 ✅ 2026-11-14`。
- AI 应用新建的笔记开头有 frontmatter 记下是谁写的（`source: claude`）；你自己写的笔记没有。
- Jot 自己不做同步：把文件夹放进 iCloud 云盘、Dropbox 或 Syncthing 即可。

详见 [docs/storage.md](docs/storage.md)（英文）。

## AI 应用与 MCP

Jot.app 里自带 `jot-mcp`（`Jot.app/Contents/MacOS/jot-mcp`），一个 MCP 服务器，Jot 开不开都能读写笔记文件夹。
设置 → AI 应用会连接这台 Mac 上找到的应用。其他 MCP 应用，复制那一页给出的条目，或者手写：

```json
{
  "mcpServers": {
    "jot": {
      "command": "/Applications/Jot.app/Contents/MacOS/jot-mcp",
      "args": ["--dir", "~/Documents/Jot"]
    }
  }
}
```

| 工具 | 作用 |
|---|---|
| `search_notes(query, limit?)` | 按标题和正文搜索 |
| `read_note(title)` | 读出一条笔记的全文 |
| `recent_notes(limit?)` | 最近修改的笔记 |
| `create_note(title, body)` | 新建笔记，标上应用的名字 |
| `append_note(title, text)` | 往笔记末尾追加 |
| `add_todo(text, due?, note?)` | 加一条待办；`due` 是 ISO 本地时间，或 `明天 9点`、`tomorrow 3pm` 这类说法 |
| `list_todos(range?)` | 没勾掉的待办：`overdue`、`today`、`upcoming` 或 `all`（默认今天的和已过期的） |
| `complete_todo(note, text)` | 勾掉一条待办 |
| `reschedule_todo(note, text, due)` | 改一条待办的提醒时间；`null` 移除提醒 |
| `trash_note(title)` | 把笔记移到废纸篓（需要你允许） |
| `replace_note(title, body)` | 改写整条笔记，改写前的版本放进废纸篓（需要你允许） |

移走和改写默认关闭，要在设置 → AI 应用 → 「允许 AI 应用把笔记移到废纸篓和改写笔记」里打开；应用拿走的东西都在废纸篓里，
可以找回。没有哪个工具能改锁定的笔记。连接、这个开关和锁定的细节见 [docs/mcp.md](docs/mcp.md) 和
[docs/locks.md](docs/locks.md)（英文）。

## 构建

Jot 用 [NSH](https://github.com/longbridge/nsh) 构建：界面是 TSX，笔记存储、提醒和平台相关的代码是 Rust。
[CONTRIBUTING.md](CONTRIBUTING.md)（英文）讲怎么搭环境和常用命令，[docs/architecture.md](docs/architecture.md) 是代码总览。

## 致谢

主题配色参考以下 VS Code 主题，均为 MIT 许可证：
[GitHub Theme](https://github.com/primer/github-vscode-theme)、
[One Dark Pro](https://github.com/Binaryify/OneDark-Pro) 与 [Atom One Light](https://github.com/akamud/vscode-theme-onelight)、
[Dracula](https://github.com/dracula/visual-studio-code)（浅色版 Alucard 取自
[Dracula 规范](https://github.com/dracula/dracula-theme)）、
[Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme)、
[Catppuccin](https://github.com/catppuccin/vscode) 和 [Gruvbox](https://github.com/jdinhify/vscode-theme-gruvbox)。
Jot 按笔记浮窗而不是代码编辑器挑选颜色，部分颜色为达到 WCAG AA 对比度做了微调。

## 许可证

[MIT](LICENSE)
