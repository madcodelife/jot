<p align="center">
  <img src="design/logo/loop/png/jot-horizontal.png" alt="Jot" width="240">
</p>

<p align="center"><a href="README.md">English</a></p>

# Jot

Jot 是一个和 Claude 共用的 macOS 速记本。在任何地方连按两下 ⌥，就会弹出一个浮窗；浮窗里只有一个输入框，它既是搜索框，
也是新笔记的标题：打几个字，要么找到以前记过的，要么按回车直接新建一条。笔记是你选定的文件夹里的普通 Markdown 文件，
待办和提醒就写在笔记里。`jot-mcp` 是一个小小的 MCP 服务器，让 Claude 也能搜索、读取、追加同一批笔记，你和 Claude 共用一个本子。

## 功能

- **随处呼出**：连按两下 ⌥（需要辅助功能权限；没授权时用备用快捷键）。按 Esc 或失去焦点时浮窗自动收起。
- **搜索即新建**：边输入边按标题和正文过滤，最近修改的排前面；搜不到时按回车，就以输入内容为标题新建。
- **用 Markdown 写**：边写边高亮、边写边保存。没有保存按钮，也没有预览模式。
- **待办长在笔记里**：`- [ ] 内容` 就是一条待办。写上时间，比如 `- [ ] 交房租 明天 9:00`，它就成了提醒，到点弹桌面通知
  （有刘海的 Mac 上还会从灵动岛弹出）。中文、英文、日文的时间说法都认（`tomorrow 9am`、`明日 9時`）。输入「待办」
  （或 `/todo`）列出所有没勾掉的待办，按时间分组；⇧⌘D 不用打字就能改提醒时间。
- **语音输入**：按住 ⌥ 说话，写进搜索框或笔记；在任何 App 里连按两下 ⌥ 并按住，记一条速记。
- **操作面板**：在一行上按 ⌘K，可以打开、重命名、复制、在访达中显示或移到废纸篓（可撤销）。
- **Claude**：Claude 写的笔记带 Claude 标记，一写进来就出现在列表里。
- 深浅色外观、多套浮窗主题，界面支持简体中文、繁体中文、英文和日文。

## 笔记怎么存

- 一条笔记就是笔记文件夹（默认 `~/Documents/Jot`，可在设置里改）下的一个 `.md` 文件，文件名就是标题。
- Claude 新建的笔记开头有 YAML frontmatter：`source: claude`；你自己写的笔记没有。其他 frontmatter 原样保留。
- 提醒在文件里存成绝对时间：`- [ ] 交房租 ⏰ 2026-11-14 09:00`（和 Obsidian 的 Reminder 插件同一写法）；
  勾掉的待办记下完成日期：`- [x] 交房租 ✅ 2026-11-14`。
- Jot 自己不做同步：把文件夹放进 iCloud 云盘、Dropbox 或 Syncthing 即可。

## Claude 与 MCP

`jot-mcp` 是一个 stdio MCP 服务器，直接读写笔记文件夹，App 开不开都能用。它从不删除或覆盖笔记。

```sh
cargo build --release -p jot-mcp
claude mcp add jot -- <jot-mcp 路径> --dir <笔记文件夹>
# 例如：
claude mcp add jot -- "$PWD/target/release/jot-mcp" --dir ~/Documents/Jot
```

文件夹取 `--dir`，没有时取环境变量 `JOT_DIR`，再没有就是 `~/Documents/Jot`；开头的 `~` 由 `jot-mcp` 自己展开，
因为 MCP 客户端启动它时不经过 shell。给 `claude mcp add` 加上 `--scope user`，所有项目里都能用 Jot。

Claude Desktop：把服务器加到 `~/Library/Application Support/Claude/claude_desktop_config.json`（设置 → 开发者 →
编辑配置），写上可执行文件的绝对路径，然后重启 Claude Desktop：

```json
{
  "mcpServers": {
    "jot": {
      "command": "/absolute/path/to/jot-mcp",
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
| `create_note(title, body)` | 新建笔记，标记为 `source: claude` |
| `append_note(title, text)` | 往已有笔记末尾追加 |
| `add_todo(text, due?, note?)` | 加一条待办；`due` 是 ISO 本地时间，或 `明天 9点`、`tomorrow 3pm` 这类说法 |
| `list_todos(range?)` | 没勾掉的待办：`overdue`、`today`、`upcoming` 或 `all`（默认今天的和已过期的） |
| `complete_todo(note, text)` | 勾掉一条待办；写出待办里独一无二的一段就够了 |
| `reschedule_todo(note, text, due)` | 改一条待办的提醒时间；`null` 移除提醒 |

然后就可以对 Claude 说「把这个命令记到 Jot」「提醒我周五交周报」「我今天有什么要做的」。

## 构建

Jot 用 [NSH](https://github.com/longbridge/nsh) 构建：界面是 TSX，笔记存储、提醒和平台相关的代码是 Rust。

Jot 依赖 crates.io 上的 NSH 0.6.0。先装同一版本（0.6.0）的 `nsh` 命令行（见 [NSH 的安装说明](https://github.com/longbridge/nsh)），然后：

```sh
nsh run                       # 构建并运行 App
nsh check                     # cargo check，再检查 TSX 的类型
nsh test                      # 先跑 Rust 测试，再无界面地跑 TSX 测试
nsh package --target macos    # 打包出 Jot.app
```

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
design/    可交互的设计稿和 logo
```

[ARCHITECTURE.md](ARCHITECTURE.md) 介绍各个 crate 和它们的 API；[PRODUCT.md](PRODUCT.md) 是产品定义（英文）。

## 许可证

[MIT](LICENSE)
