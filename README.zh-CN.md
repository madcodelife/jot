<p align="center">
  <img src="design/logo/loop/png/jot-horizontal.png" alt="Jot" width="240">
</p>

<p align="center"><a href="README.md">English</a></p>

# Jot

Jot 是一个你和 AI 应用共用的 macOS 速记本。在任何地方连按两下 ⌥，就会弹出一个浮窗；浮窗里只有一个输入框，它既是搜索框，
也是新笔记的标题：打几个字，要么找到以前记过的，要么按回车直接新建一条。笔记是你选定的文件夹里的普通 Markdown 文件，
待办和提醒就写在笔记里。`jot-mcp` 是一个小小的 MCP 服务器，让你的 AI 应用（Claude、Cursor、Codex……）也能搜索、读取、
追加同一批笔记，你和它们共用一个本子。

## 功能

- **随处呼出**：连按两下 ⌥（需要辅助功能权限；没授权时用备用快捷键）。按 Esc 或失去焦点时浮窗自动收起。
- **搜索即新建**：边输入边按标题和正文过滤，最近修改的排前面；搜不到时按回车，就以输入内容为标题新建。
- **用 Markdown 写**：边写边高亮、边写边保存。没有保存按钮，也没有预览模式。
- **待办长在笔记里**：`- [ ] 内容` 就是一条待办。写上时间，比如 `- [ ] 交房租 明天 9:00`，它就成了提醒，到点弹桌面通知
  （有刘海的 Mac 上还会从灵动岛弹出）。中文、英文、日文的时间说法都认（`tomorrow 9am`、`明日 9時`）。输入「待办」
  （或 `/todo`）列出所有没勾掉的待办，按时间分组；⇧⌘D 不用打字就能改提醒时间。
- **语音输入**：按住 ⌥ 说话，写进搜索框或笔记；在任何 App 里连按两下 ⌥ 并按住，记一条速记。
- **操作面板**：在一行上按 ⌘K，可以打开、重命名、复制、在访达中显示、锁定或移到废纸篓（可撤销）。
- **锁定笔记**：⌘K →「锁定」让一条笔记只读：Jot、你的 AI 应用和其他任何程序都改不了它，用的就是访达「显示简介」里的
  「已锁定」。列表里有个小锁标着它；点笔记头上的「已锁定」就解锁。
- **AI 应用**：在设置里一键连接 Claude Code、Claude、Cursor、VS Code、Windsurf、Codex 或 Gemini CLI。AI 应用写的笔记
  带上它的名字（Claude、Cursor……），一写进来就出现在列表里。你在设置里允许的话，它们还能把笔记移到废纸篓、改写笔记；
  拿走的东西都在废纸篓里，可以找回。
- 深浅色外观；浮窗主题有 Jot 自己的默认（靛蓝）、GitHub、One、Dracula、Tokyo Night、Catppuccin、Gruvbox 和高对比，
  每套都有浅色和深色。界面支持简体中文、繁体中文、英文和日文。

## 笔记怎么存

- 一条笔记就是笔记文件夹（默认 `~/Documents/Jot`，可在设置里改）下的一个 `.md` 文件，文件名就是标题。
- AI 应用新建的笔记开头有 YAML frontmatter，记下是谁写的：`source: claude`、`source: cursor`，Jot 不认识的应用写成
  `source: "agent:<名字>"`（取应用连接时报的名字）；你自己写的笔记没有。只有这几种值才算 AI 写的：你自己写的
  `source`（剪藏的网址、书名）还是你的。锁定的笔记除了文件的「已锁定」标记，frontmatter 里还有 `locked: true`。其他
  frontmatter 原样保留。
- 提醒在文件里存成绝对时间：`- [ ] 交房租 ⏰ 2026-11-14 09:00`（和 Obsidian 的 Reminder 插件同一写法）；
  勾掉的待办记下完成日期：`- [x] 交房租 ✅ 2026-11-14`。
- Jot 自己不做同步：把文件夹放进 iCloud 云盘、Dropbox 或 Syncthing 即可。设置 → 通用 →「放到 iCloud 云盘…」把笔记移到
  `iCloud 云盘/Jot` 并切换过去（不会覆盖那里已有的笔记：同名的加编号另存），已连接的 AI 应用跟着换。被 iCloud 移出本地的
  笔记仍在列表里，标着「正在下载…」，下载回来就能打开；两台设备同时改过的笔记，可以选留这台 Mac 上的、用另一个，或两个都留。

## AI 应用与 MCP

`jot-mcp` 是一个 stdio MCP 服务器，直接读写笔记文件夹，App 开不开都能用。Jot.app 里自带它
（`Jot.app/Contents/MacOS/jot-mcp`）。它能搜索、读取、新建、追加笔记，管待办；只有你允许时（见下文）才会把笔记移到废纸篓
或改写笔记，锁定的笔记它一概不碰。它不会彻底删除任何东西。

### 在设置里连接

设置 → AI 应用列出这台 Mac 上装了的 AI 应用和各自的状态，点一下就能连接或断开：

| 应用 | Jot 怎么登记 |
|---|---|
| Claude Code | `claude mcp add --scope user jot -- …`（Jot 自己在 `~/.local/bin`、Homebrew、npm 和 Bun 的目录里找 `claude`） |
| Claude（桌面版） | `~/Library/Application Support/Claude/claude_desktop_config.json` 的 `mcpServers.jot` |
| Cursor | `~/.cursor/mcp.json` 的 `mcpServers.jot` |
| VS Code | `~/Library/Application Support/Code/User/mcp.json` 的 `servers.jot`（`"type": "stdio"`） |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` 的 `mcpServers.jot` |
| Codex | `~/.codex/config.toml` 的 `[mcp_servers.jot]` |
| Gemini CLI | `~/.gemini/settings.json` 的 `mcpServers.jot` |
| Zed | 手动：把条目复制进 `~/.config/zed/settings.json` 的 `context_servers` |

Jot 只改 `jot` 这一项，文件里其他设置不变：TOML 文件连排版和注释都保留；JSON 文件保留键的顺序、缩进和换行符，但整份会
重新写出，其他格式（比如写在一行里的数组）可能变。第一次改之前，Jot 在旁边留一份原文件（`<文件名>.jot.bak`），之后一直
保留这份。解析不了的文件（比如带注释的 JSON）它绝不重写，而是给出条目让你复制；找不到 `claude` 命令时 Claude Code
也一样。在设置里换了笔记文件夹，已连接的应用都会跟着更新。应用当时开着的话，重启一下才会载入 Jot。macOS 从临时位置
运行 Jot 时（直接从「下载」里打开），Jot 不做任何连接：先把它拖进「应用程序」。

### 手动设置

其他 MCP 应用，在这一页复制命令或 JSON 即可。从源码目录手动登记：

```sh
cargo build --release -p jot-mcp
claude mcp add --scope user jot -- "$PWD/target/release/jot-mcp" --dir ~/Documents/Jot
```

文件夹取 `--dir`，没有时取环境变量 `JOT_DIR`，再没有就是 `~/Documents/Jot`；开头的 `~` 由 `jot-mcp` 自己展开，
因为 MCP 客户端启动它时不经过 shell。大多数应用接受同样的 JSON 条目，写上可执行文件的绝对路径：

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

工具：

| 工具 | 作用 |
|---|---|
| `search_notes(query, limit?)` | 按标题和正文搜索 |
| `read_note(title)` | 读出一条笔记的全文 |
| `recent_notes(limit?)` | 最近修改的笔记 |
| `create_note(title, body)` | 新建笔记，标上应用的名字（`source: cursor`） |
| `append_note(title, text)` | 往已有笔记末尾追加 |
| `add_todo(text, due?, note?)` | 加一条待办；`due` 是 ISO 本地时间，或 `明天 9点`、`tomorrow 3pm` 这类说法 |
| `list_todos(range?)` | 没勾掉的待办：`overdue`、`today`、`upcoming` 或 `all`（默认今天的和已过期的） |
| `complete_todo(note, text)` | 勾掉一条待办；写出待办里独一无二的一段就够了 |
| `reschedule_todo(note, text, due)` | 改一条待办的提醒时间；`null` 移除提醒 |

| `trash_note(title)` | 把笔记移到废纸篓（需要你允许） |
| `replace_note(title, body)` | 改写整条笔记；改写前的版本先放进废纸篓（需要你允许） |

然后就可以对应用说「把这个命令记到 Jot」「提醒我周五交周报」「我今天有什么要做的」。

### 移走和改写笔记

设置 → AI 应用 →「允许 AI 应用把笔记移到废纸篓和改写笔记」一开始是关的。关着时 `trash_note` 和 `replace_note` 照样列出，
但调用会被拒绝，并告诉应用去哪里打开。打开后对所有已连接的应用立刻生效，不用重新连接（`jot-mcp` 每次调用都读一遍
`~/Library/Application Support/Jot/ai.json`）：

- `trash_note` 把笔记移到废纸篓，不是彻底删除：从废纸篓拖回笔记文件夹就找回来了。
- `replace_note` 先把笔记原样（含 frontmatter）放进废纸篓，名字是 Jot 当前语言的「计划（改写前 · 2026-11-25 14.30）.md」
  这样，再在原来的 frontmatter 下写入新正文，frontmatter 保持不变。
- Jot 告诉应用：只在你要求时才这么做；要一次移走很多条时，先列出来请你确认。

这个开关管的是应用能不能通过 Jot 的工具做这些事。能跑 shell 命令的应用也可以自己改那个文件或笔记；要让一条笔记不被
改动，靠的是锁定。

### 锁定的笔记

锁定的笔记，AI 应用照样能读、能搜到、能列出里面的待办，但没有哪个工具能改它，也没有工具能解锁它。锁用的是 macOS 自己的
机制（文件的 `uchg` 标记，即访达里的「已锁定」）：不管谁来，系统都不让修改、改名、移动或删除这个文件，AI 应用在 shell 里
跑 `rm`、`rm -f` 也一样，移到废纸篓也会被拒。Jot 还会在笔记里写上 `locked: true`，因为 iCloud 云盘不会把这个标记同步到
你的其他 Mac（上传笔记的新内容时它甚至会清掉这个标记）；Jot 会照着它把标记补回来，你在访达里锁定的笔记也会补上这一行。
锁挡不住的情况：文件的主人可以清掉这个标记（`chflags nouchg`，或在访达里取消），以你的身份运行、存心要改的程序也可以；
有管理员权限的程序同样可以。锁防的是误操作，挡不住一个铁了心要改它的程序。

## 构建

Jot 用 [NSH](https://github.com/longbridge/nsh) 构建：界面是 TSX，笔记存储、提醒和平台相关的代码是 Rust。

Jot 依赖 crates.io 上的 NSH 0.6.0。先装同一版本（0.6.0）的 `nsh` 命令行（见 [NSH 的安装说明](https://github.com/longbridge/nsh)），然后：

```sh
nsh run                       # 构建并运行 App
nsh check                     # cargo check，再检查 TSX 的类型
nsh test                      # 先跑 Rust 测试，再无界面地跑 TSX 测试
scripts/package-macos.sh      # 打包出 Jot.app，里面带着 jot-mcp
```

`scripts/package-macos.sh` 先编 `jot-mcp`，再跑 `nsh package --target macos`（参数原样传过去：`--arch universal`、
`--out`、`--name`……），把 `jot-mcp` 放进 `Jot.app/Contents/MacOS`，然后重新签名（默认 ad hoc；`SIGN_IDENTITY` 换别的
身份，这时带安全时间戳和 hardened runtime）。它用 `PATH` 里的 `nsh`，或 `NSH=/path/to/nsh` 指定的。开发时 `nsh run`
（debug 构建）会在 cargo 的 target 目录里找 `jot-mcp`：先 `cargo build -p jot-mcp` 一次，就能在设置里连接应用。

目前只支持 macOS。

## 目录结构

```
App.tsx    App 本身（TSX）
app/       App 逻辑：操作、设置、待办、提醒、语音输入
ui/        组件和设计 token
locales/   翻译
src/       App 的 Rust crate（`jot/native`）
store/     jot-store：笔记文件夹、待办和时间说法，纯 Rust
mcp/       jot-mcp，MCP 服务器
tests/     App 的 TSX 测试（`nsh test`，无界面运行）
scripts/   打包脚本
assets/    App 图标
docs/      架构说明和产品定义
design/    可交互的设计稿和 logo
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 介绍各个 crate 和它们的 API；[docs/PRODUCT.md](docs/PRODUCT.md) 是产品定义（英文）。

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
