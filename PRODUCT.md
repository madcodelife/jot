# Jot（代号）产品定义

## 一句话

按一个快捷键呼出的速记本：输入框既是搜索框也是新笔记的标题；你和 Claude 共用这个本子，Claude 能往里记，也能读出来。

## 为什么做

- Notational Velocity / nvALT 的交互（搜索即新建）至今有人用，2026-10 还被作者重新发版，但只有 Mac 版；Windows、Linux、手机上没有像样的同类。
- Heynote 这类草稿板是 Electron，被吐槽包大、吃内存，也没有手机版。
- AI 助手每次会话都从零开始。一个它能写、能搜、能读的本地小本子，让你和它之间有一份共同的记忆。

## 核心交互

1. 全局快捷键（默认 ⌥Space）呼出一个居中的浮窗，再按一次或按 Esc 隐藏。
2. 浮窗顶部是输入框。输入时按标题和正文实时过滤，最近修改的排前面。
3. ↑↓ 选中，回车打开；搜不到时回车直接以输入内容为标题新建。
4. 下方是正文编辑区，Markdown 高亮，边写边自动保存，没有保存按钮。
5. Claude 写的笔记在列表里带一个小标记；App 开着时，新笔记会立刻出现。

## 存储

- 笔记是一个文件夹（默认 `~/Documents/Jot`，可改）里的 `.md` 文件，文件名就是标题。
- 文件头用 YAML frontmatter 记来源：`source: claude`。用户手写的笔记不加。
- 同步不自己做，交给 iCloud Drive、Dropbox 或 Syncthing。

## 给 Claude 的 MCP

`jot-mcp`：一个 stdio MCP 服务器（Rust），直接读写笔记文件夹，App 不开也能用。

| 工具 | 作用 |
|---|---|
| `search_notes(query, limit?)` | 按标题和正文搜索，返回标题、摘要、修改时间 |
| `read_note(title)` | 读出一条笔记的全文 |
| `recent_notes(limit?)` | 列出最近修改的笔记 |
| `create_note(title, body)` | 新建；标题已存在时报错，提示改用 `append_note` |
| `append_note(title, text)` | 往已有笔记末尾追加一段 |

第一版不提供删除和覆盖，Claude 改不坏用户手写的内容。安装：`claude mcp add jot -- <jot-mcp 路径> --dir <笔记文件夹>`；App 设置里以后会有一键「连接 Claude」。

## 第一版做什么、不做什么

做：macOS 桌面（NSH 的 AppKit 后端），托盘常驻，全局快捷键浮窗，搜索即新建，正文编辑和自动保存，监听文件夹变化，`jot-mcp`，深浅色。

先不做：Windows、Linux 和手机（第二步，同一份代码），自建同步，标签和文件夹层级，富文本，草稿块和行内计算，App 内的一键连接 Claude。

## 设计基调

参考 Bear、Things 和 Raycast 的浮窗：克制、留白足、字体讲究；深浅两套颜色都要精调。浮窗约 680×440，圆角，失去焦点时自动隐藏。

## 验收

- 从按下快捷键到可以打字，感觉不到延迟。
- 在 Claude Code 里说「把这个命令记到 Jot」，App 列表里立刻出现这条笔记，带 Claude 标记。
- 在 Claude Code 里问「我在 Jot 里记过 wifi 密码吗」，Claude 能搜到并读出来。
