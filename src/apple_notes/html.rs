//! Apple Notes' HTML (a note's `body` as Notes' scripting gives it) as Markdown.
//!
//! Notes writes one `<div>` per line (`<div><br></div>` for a blank one), `<h1>`–`<h3>` for its title, heading and
//! subheading styles, `<b>`, `<i>`, `<u>` and `<strike>`, nested `<ul>` / `<ol>` (a list inside a list's `<li>` or
//! beside it), `<a href>`, monospaced text (`<tt>`, `<pre>`, a Menlo or Courier font), `<blockquote>`, `<table>`
//! (inside an `<object>`) and `<img>`. A line is a line here too: no blank lines are added between them, as Jot shows a
//! note line by line, and the spaces the user started it with stay. A line all monospaced is code (a run of them one
//! fenced block), else monospaced words are inline code. Underline has no Markdown and is dropped; images and other
//! attachments are not imported, a line saying so in their place. Checklists come as plain lists: the HTML does not
//! tell a ticked item from an open one.

use html5ever::tendril::TendrilSink as _;
use html5ever::{ParseOpts, parse_document};
use markup5ever_rcdom::{Handle, NodeData, RcDom};

/// What stands in for an image.
pub(crate) const IMAGE: &str = "[image not imported]";
/// What stands in for any other attachment.
pub(crate) const ATTACHMENT: &str = "[attachment not imported]";

/// The note's HTML as Markdown, the title left out when it starts the note (Notes repeats the title there; in Jot
/// the file's name is the title): see [`drop_title`]. No line break at the end.
pub(crate) fn to_markdown(html: &str, title: Option<&str>) -> String {
    let dom = parse_document(RcDom::default(), ParseOpts::default()).one(html);
    let mut walker = Walker::default();
    walker.container(&dom.document, &Ctx::default());
    let mut blocks = walker.blocks;
    if let Some(title) = title {
        drop_title(&mut blocks, &walker.starts, title);
    }
    render(&blocks)
}

// ——— Blocks ———

/// A line of the note, or a table.
#[derive(Debug, Clone, PartialEq)]
enum Block {
    Line {
        /// The line's Markdown, or its plain text for code.
        text: String,
        /// Its text without Markdown, to compare with the title.
        plain: String,
        /// What goes before it: a heading's `#`s, a list item's indent and marker.
        prefix: String,
        /// A line of a code block.
        code: bool,
        /// How many quotes it is in.
        quote: usize,
    },
    Blank {
        /// A blank line among code lines (in monospaced text).
        code: bool,
        quote: usize,
    },
    Table {
        rows: Vec<Vec<String>>,
        quote: usize,
    },
}

/// Where the walk is.
#[derive(Debug, Clone, Default)]
struct Ctx {
    quote: usize,
    /// `#`s of the heading it is in (0: none).
    heading: usize,
    /// Inside a list item: the indent its lines after the first take (its marker's width under it).
    indent: Option<String>,
    /// Inside `<pre>`: whitespace kept, every line code.
    pre: bool,
}

#[derive(Default)]
struct Walker {
    blocks: Vec<Block>,
    /// A list item's indent and marker, for its first line.
    marker: Option<String>,
    /// Where each of the body's children starts in `blocks` (Notes' `<div>`s), for the title.
    starts: Vec<usize>,
}

impl Walker {
    /// Walks the children of `node`: runs of inline nodes become lines, block elements are walked in turn.
    fn container(&mut self, node: &Handle, ctx: &Ctx) {
        let top = element(node).is_some_and(|(name, _)| name == "body");
        let children = node.children.borrow();
        let mut rest: &[Handle] = &children;
        let mut after_object = false;
        loop {
            let end = rest
                .iter()
                .position(|child| block_name(child).is_some())
                .unwrap_or(rest.len());
            let mut run = &rest[..end];
            if after_object {
                run = after_line_end(run);
            }
            if top {
                self.starts.push(self.blocks.len());
            }
            self.flush(Inline::of(inlines(run, &InlineCtx::of(ctx))), ctx);
            let Some((child, more)) = rest[end..].split_first() else {
                break;
            };
            let Some(name) = block_name(child) else {
                break;
            };
            if top {
                self.starts.push(self.blocks.len());
            }
            self.block(child, &name, ctx);
            after_object = name == "object";
            rest = more;
        }
    }

    fn block(&mut self, node: &Handle, name: &str, ctx: &Ctx) {
        match name {
            "head" | "script" | "style" | "template" | "title" => {}
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let level = usize::from(name.as_bytes()[1] - b'0');
                self.container(
                    node,
                    &Ctx {
                        heading: level,
                        ..ctx.clone()
                    },
                );
            }
            "blockquote" => self.container(
                node,
                &Ctx {
                    quote: ctx.quote + 1,
                    ..ctx.clone()
                },
            ),
            "pre" => self.container(
                node,
                &Ctx {
                    pre: true,
                    ..ctx.clone()
                },
            ),
            "ul" | "ol" => self.list(node, name == "ol", ctx),
            "li" => self.item(node, "- ", ctx),
            "table" => self.table(node, ctx),
            _ => self.container(node, ctx),
        }
    }

    /// A list: each item's first line with its marker, nested lists (inside an item, or beside the items as Notes
    /// writes them) under the item before.
    fn list(&mut self, node: &Handle, ordered: bool, ctx: &Ctx) {
        // A list starting while an item's marker waits for words: the item had none, and shows alone.
        self.flush_marker(ctx);
        let indent = ctx.indent.clone().unwrap_or_default();
        let mut number = element(node)
            .and_then(|(_, node)| attr(node, "start"))
            .and_then(|start| start.trim().parse::<u64>().ok())
            .unwrap_or(1);
        // Where a list beside the items goes: under the last item's words.
        let mut under = format!("{indent}  ");
        for child in node.children.borrow().iter() {
            match element(child) {
                Some((name, _)) if name == "li" => {
                    let marker = if ordered {
                        let marker = format!("{number}. ");
                        number += 1;
                        marker
                    } else {
                        "- ".to_owned()
                    };
                    under = format!("{indent}{}", " ".repeat(marker.chars().count()));
                    self.item(
                        child,
                        &marker,
                        &Ctx {
                            indent: Some(indent.clone()),
                            ..ctx.clone()
                        },
                    );
                }
                Some((name, _)) if name == "ul" || name == "ol" => {
                    self.list(
                        child,
                        name == "ol",
                        &Ctx {
                            indent: Some(under.clone()),
                            ..ctx.clone()
                        },
                    );
                }
                _ => {
                    let ctx = Ctx {
                        indent: Some(under.clone()),
                        ..ctx.clone()
                    };
                    if let Some(name) = block_name(child) {
                        self.block(child, &name, &ctx);
                    } else {
                        // Text between items (whitespace, mostly).
                        let run = Inline::of(inline(child, &InlineCtx::of(&ctx)));
                        self.flush(run, &ctx);
                    }
                }
            }
        }
    }

    /// A list item at `ctx.indent` (none: an item outside a list), with `marker`.
    fn item(&mut self, node: &Handle, marker: &str, ctx: &Ctx) {
        self.flush_marker(ctx);
        let indent = ctx.indent.clone().unwrap_or_default();
        self.marker = Some(format!("{indent}{marker}"));
        let under = format!("{indent}{}", " ".repeat(marker.chars().count()));
        self.container(
            node,
            &Ctx {
                indent: Some(under),
                ..ctx.clone()
            },
        );
        self.flush_marker(ctx);
    }

    /// An item's marker no line took: the item alone.
    fn flush_marker(&mut self, ctx: &Ctx) {
        if let Some(marker) = self.marker.take() {
            self.blocks.push(Block::Line {
                text: String::new(),
                plain: String::new(),
                prefix: marker.trim_end().to_owned(),
                code: false,
                quote: ctx.quote,
            });
        }
    }

    /// A table: a row per `<tr>`, each cell's text on one line.
    fn table(&mut self, node: &Handle, ctx: &Ctx) {
        let mut rows = Vec::new();
        collect_rows(node, &mut rows);
        if !rows.is_empty() {
            self.blocks.push(Block::Table {
                rows,
                quote: ctx.quote,
            });
        }
    }

    /// Makes lines of a run of inline nodes: each line a `<br>` ended (a blank one when empty), and the last one
    /// when it has words.
    fn flush(&mut self, run: Inline, ctx: &Ctx) {
        for line in run.lines {
            if !line.ended && line.words == 0 {
                continue;
            }
            let in_list = ctx.indent.is_some();
            if line.words == 0 {
                self.blocks.push(Block::Blank {
                    code: line.mono_break && !in_list && ctx.heading == 0,
                    quote: ctx.quote,
                });
                continue;
            }
            let code = (ctx.pre || line.mono == line.words) && !in_list && ctx.heading == 0;
            let text = if code {
                code_text(&line.plain, ctx.pre)
            } else {
                text_of(&line.md)
            };
            let plain = text_of(&line.plain);
            // A heading's or a list item's first line takes no spaces of its own after its `#`s or marker.
            let (prefix, text) = if ctx.heading > 0 {
                let prefix = format!("{} ", "#".repeat(ctx.heading));
                (prefix, text.trim_start().to_owned())
            } else if let Some(marker) = self.marker.take() {
                (marker, text.trim_start().to_owned())
            } else {
                (ctx.indent.clone().unwrap_or_default(), text)
            };
            self.blocks.push(Block::Line {
                text,
                plain,
                prefix,
                code,
                quote: ctx.quote,
            });
        }
    }
}

/// Every row under `node` (through `<thead>`, `<tbody>`, `<tfoot>`), a cell's lines joined by spaces.
fn collect_rows(node: &Handle, rows: &mut Vec<Vec<String>>) {
    for child in node.children.borrow().iter() {
        match element(child) {
            Some((name, _)) if name == "tr" => {
                let mut cells = Vec::new();
                for cell in child.children.borrow().iter() {
                    if let Some((name, _)) = element(cell)
                        && (name == "td" || name == "th")
                    {
                        let mut walker = Walker::default();
                        walker.container(cell, &Ctx::default());
                        let words: Vec<String> = walker
                            .blocks
                            .into_iter()
                            .filter_map(|block| match block {
                                Block::Line { text, prefix, .. } => {
                                    Some(format!("{prefix}{text}").trim().to_owned())
                                }
                                Block::Table { rows, .. } => Some(
                                    rows.iter()
                                        .map(|row| row.join(" "))
                                        .collect::<Vec<_>>()
                                        .join(" "),
                                ),
                                Block::Blank { .. } => None,
                            })
                            .filter(|text| !text.is_empty())
                            .collect();
                        cells.push(words.join(" ").replace('|', "\\|"));
                    }
                }
                rows.push(cells);
            }
            Some((name, _)) if matches!(name.as_str(), "thead" | "tbody" | "tfoot") => {
                collect_rows(child, rows)
            }
            _ => {}
        }
    }
}

/// Takes out the title Notes repeats at the top, whitespace aside: the first line when it is the title, else the whole
/// first block (a child of the body, as `starts` says: one of Notes' `<div>`s) when its lines, headings or plain ones,
/// say it together (Notes may split a title over headings: `<h1>Shoes</h1><b><h1>👟</h1></b>`).
fn drop_title(blocks: &mut Vec<Block>, starts: &[usize], title: &str) {
    let Some(first) = blocks
        .iter()
        .position(|block| !matches!(block, Block::Blank { .. }))
    else {
        return;
    };
    let title = without_whitespace(title);
    let says_title = |blocks: &[Block]| {
        let mut words = String::new();
        for block in blocks {
            match block {
                Block::Line { plain, prefix, .. }
                    if prefix.is_empty() || prefix.starts_with('#') =>
                {
                    words.push_str(&without_whitespace(plain))
                }
                Block::Blank { .. } => {}
                _ => return false,
            }
        }
        words == title
    };
    if says_title(&blocks[first..=first]) {
        blocks.drain(..=first);
        return;
    }
    let end = starts
        .iter()
        .copied()
        .filter(|&start| start > first)
        .min()
        .unwrap_or(blocks.len());
    if says_title(&blocks[first..end]) {
        blocks.drain(..end);
    }
}

fn without_whitespace(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Spaces (non-breaking ones too) collapsed, trimmed.
fn squash(text: &str) -> String {
    text.split(|c: char| c.is_whitespace())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The blocks as Markdown lines, code lines fenced, a table set off by blank lines; no blank lines at either end.
fn render(blocks: &[Block]) -> String {
    let mut out: Vec<String> = Vec::new();
    // The code block open: its quote and the index of its opening fence.
    let mut open: Option<(usize, usize)> = None;
    let close = |out: &mut Vec<String>, open: &mut Option<(usize, usize)>| {
        if let Some((quote, start)) = open.take() {
            // Blank lines at its end belong after it.
            let mut trailing = 0;
            while out.len() > start + 1
                && out
                    .last()
                    .is_some_and(|line| line.trim_end_matches('>').trim().is_empty())
            {
                out.pop();
                trailing += 1;
            }
            let fence = fence_for(&out[start + 1..]);
            out[start] = format!("{}{fence}", quotes(quote));
            out.push(format!("{}{fence}", quotes(quote)));
            for _ in 0..trailing {
                out.push(quotes(quote).trim_end().to_owned());
            }
        }
    };
    let mut after_table = false;
    for block in blocks {
        let is_blank = matches!(block, Block::Blank { code: false, .. });
        if after_table && !is_blank {
            out.push(String::new());
        }
        after_table = false;
        match block {
            Block::Line {
                text,
                code: true,
                quote,
                ..
            } => {
                if open.is_some_and(|(q, _)| q != *quote) {
                    close(&mut out, &mut open);
                }
                if open.is_none() {
                    open = Some((*quote, out.len()));
                    out.push(String::new());
                }
                out.push(format!("{}{text}", quotes(*quote)).trim_end().to_owned());
            }
            Block::Blank { code: true, quote } if open.is_some_and(|(q, _)| q == *quote) => {
                out.push(quotes(*quote).trim_end().to_owned());
            }
            Block::Line {
                text,
                prefix,
                quote,
                ..
            } => {
                close(&mut out, &mut open);
                out.push(
                    format!("{}{prefix}{text}", quotes(*quote))
                        .trim_end()
                        .to_owned(),
                );
            }
            Block::Blank { quote, .. } => {
                close(&mut out, &mut open);
                out.push(quotes(*quote).trim_end().to_owned());
            }
            Block::Table { rows, quote } => {
                close(&mut out, &mut open);
                if out.last().is_some_and(|line| !line.is_empty()) {
                    out.push(String::new());
                }
                let columns = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
                let q = quotes(*quote);
                for (i, row) in rows.iter().enumerate() {
                    let cells: Vec<&str> = (0..columns)
                        .map(|c| row.get(c).map_or("", String::as_str))
                        .collect();
                    out.push(format!("{q}| {} |", cells.join(" | ")));
                    if i == 0 {
                        out.push(format!("{q}|{}", " --- |".repeat(columns)));
                    }
                }
                after_table = true;
            }
        }
    }
    close(&mut out, &mut open);
    let start = out
        .iter()
        .position(|line| !line.is_empty())
        .unwrap_or(out.len());
    let end = out
        .iter()
        .rposition(|line| !line.is_empty())
        .map_or(start, |end| end + 1);
    out[start..end].join("\n")
}

/// `> ` for each quote.
fn quotes(depth: usize) -> String {
    "> ".repeat(depth)
}

/// A fence longer than any run of backticks starting a line of the block.
fn fence_for(lines: &[String]) -> String {
    let longest = lines
        .iter()
        .map(|line| {
            line.trim_start_matches(['>', ' '])
                .chars()
                .take_while(|&c| c == '`')
                .count()
        })
        .max()
        .unwrap_or(0);
    "`".repeat(longest.max(2) + 1)
}

/// A line's Markdown: the spaces, tabs and non-breaking spaces starting it kept, as the user indented it (a line break
/// of the source among them is not the line's, nor what is before it); further in, whitespace HTML would collapse
/// collapsed; non-breaking spaces as spaces; trimmed at the end.
fn text_of(md: &str) -> String {
    let rest = md.trim_start_matches(is_space);
    let lead = &md[..md.len() - rest.len()];
    let mut out = lead.rsplit('\n').next().unwrap_or_default().to_owned();
    let mut space = false;
    for c in rest.chars() {
        if c.is_ascii_whitespace() {
            space = true;
            continue;
        }
        if space {
            out.push(' ');
        }
        space = false;
        out.push(c);
    }
    out.replace('\u{a0}', " ").trim_end().to_owned()
}

/// A code line: indentation kept (non-breaking spaces as spaces); outside `<pre>`, as any line's.
fn code_text(plain: &str, pre: bool) -> String {
    if pre {
        plain.replace('\u{a0}', " ").trim_end().to_owned()
    } else {
        text_of(plain)
    }
}

/// Whitespace in a line's text: what HTML collapses, and non-breaking spaces.
fn is_space(c: char) -> bool {
    c.is_ascii_whitespace() || c == '\u{a0}'
}

// ——— Inline ———

/// Text on the way to lines: the lines so far, the last one open unless a `<br>` ended it.
#[derive(Debug, Default)]
struct Inline {
    lines: Vec<Line>,
}

#[derive(Debug, Clone, Default)]
struct Line {
    /// The Markdown.
    md: String,
    /// The text alone.
    plain: String,
    /// Characters that are not whitespace.
    words: usize,
    /// How many of them are monospaced.
    mono: usize,
    /// A `<br>` ended it.
    ended: bool,
    /// It was ended by a `<br>` in monospaced text (a blank line inside code).
    mono_break: bool,
}

impl Inline {
    fn of(lines: Vec<Line>) -> Inline {
        Inline { lines }
    }

    /// Adds `more` after what is here: its first line goes on the open last line.
    fn push(&mut self, more: Vec<Line>) {
        let mut more = more.into_iter();
        if let Some(last) = self.lines.last_mut()
            && !last.ended
            && let Some(first) = more.next()
        {
            last.md.push_str(&first.md);
            last.plain.push_str(&first.plain);
            last.words += first.words;
            last.mono += first.mono;
            last.ended = first.ended;
            last.mono_break = first.mono_break;
        }
        self.lines.extend(more);
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct InlineCtx {
    mono: bool,
    pre: bool,
    /// In a heading: bold is the heading's own, not marked.
    heading: bool,
}

impl InlineCtx {
    fn of(ctx: &Ctx) -> InlineCtx {
        InlineCtx {
            mono: ctx.pre,
            pre: ctx.pre,
            heading: ctx.heading > 0,
        }
    }
}

/// The lines of one inline node.
fn inline(node: &Handle, ctx: &InlineCtx) -> Vec<Line> {
    match &node.data {
        NodeData::Text { contents } => text(&contents.borrow(), ctx),
        NodeData::Element { .. } => {
            let Some((name, _)) = element(node) else {
                return Vec::new();
            };
            inline_element(node, &name, ctx)
        }
        _ => Vec::new(),
    }
}

fn inline_element(node: &Handle, name: &str, ctx: &InlineCtx) -> Vec<Line> {
    match name {
        "br" => vec![Line {
            ended: true,
            mono_break: ctx.mono,
            ..Line::default()
        }],
        "img" => vec![stand_in(IMAGE)],
        // An `<object>` holding a table is the table (below, as a block).
        "object" | "embed" | "iframe" | "video" | "audio" | "attachment"
            if !(name == "object" && has_table(node)) =>
        {
            vec![stand_in(ATTACHMENT)]
        }
        "script" | "style" | "head" | "title" | "template" => Vec::new(),
        _ if let Some(mark) = mark_of(node, ctx) => wrap(children(node, ctx), mark),
        "a" => link(node, ctx),
        _ if !ctx.mono && is_mono(node, name) => {
            let inner = children(node, &InlineCtx { mono: true, ..*ctx });
            code_span(inner)
        }
        // A block inside inline text: its lines, ended.
        _ if block_name(node).is_some() => {
            let mut lines = children(node, ctx);
            if let Some(last) = lines.last_mut()
                && last.words > 0
            {
                last.ended = true;
            }
            lines
        }
        _ => children(node, ctx),
    }
}

fn children(node: &Handle, ctx: &InlineCtx) -> Vec<Line> {
    inlines(&node.children.borrow(), ctx)
}

/// The lines of inline nodes side by side. Bold, italic or struck ones of one mark next to each other (whitespace
/// between them aside) are one run between one pair of marks: `**ab**`, not `**a****b**`.
fn inlines(nodes: &[Handle], ctx: &InlineCtx) -> Vec<Line> {
    let mut run = Inline::default();
    let mut i = 0;
    while i < nodes.len() {
        let Some(mark) = mark_of(&nodes[i], ctx) else {
            run.push(inline(&nodes[i], ctx));
            i += 1;
            continue;
        };
        let mut last = i;
        for (j, node) in nodes.iter().enumerate().skip(i + 1) {
            if mark_of(node, ctx) == Some(mark) {
                last = j;
            } else if !is_blank_text(node) {
                break;
            }
        }
        let mut group = Inline::default();
        for node in &nodes[i..=last] {
            group.push(if mark_of(node, ctx).is_some() {
                children(node, ctx)
            } else {
                inline(node, ctx)
            });
        }
        run.push(wrap(group.lines, mark));
        i = last + 1;
    }
    run.lines
}

/// The Markdown mark of a bold, italic or struck element; none in monospaced text, nor for bold in a heading (the
/// heading's own).
fn mark_of(node: &Handle, ctx: &InlineCtx) -> Option<&'static str> {
    if ctx.mono {
        return None;
    }
    match element(node)?.0.as_str() {
        "b" | "strong" if !ctx.heading => Some("**"),
        "i" | "em" => Some("*"),
        "s" | "strike" | "del" => Some("~~"),
        _ => None,
    }
}

/// A text node: in `<pre>`, as it is, a line break ending a line; else a run of spaces and tabs kept as it is (it may
/// be a line's indent: [`text_of`] collapses it further in) and a run of whitespace with a line break one `\n` (the
/// source's, never indent).
fn text(text: &str, ctx: &InlineCtx) -> Vec<Line> {
    let piece = |s: &str| {
        let words = s.chars().filter(|c| !c.is_whitespace()).count();
        Line {
            md: s.to_owned(),
            plain: s.to_owned(),
            words,
            mono: if ctx.mono { words } else { 0 },
            ..Line::default()
        }
    };
    if ctx.pre {
        let mut lines: Vec<Line> = Vec::new();
        let mut parts = text.split('\n').peekable();
        while let Some(part) = parts.next() {
            let mut line = piece(part.trim_end_matches('\r'));
            if parts.peek().is_some() {
                line.ended = true;
                line.mono_break = true;
            }
            lines.push(line);
        }
        return lines;
    }
    let mut out = String::with_capacity(text.len());
    let mut space = String::new();
    let end_space = |space: &mut String, out: &mut String| {
        if space.contains(['\n', '\r', '\x0c']) {
            out.push('\n');
        } else {
            out.push_str(space);
        }
        space.clear();
    };
    for c in text.chars() {
        if c.is_ascii_whitespace() {
            space.push(c);
            continue;
        }
        end_space(&mut space, &mut out);
        out.push(c);
    }
    end_space(&mut space, &mut out);
    vec![piece(&out)]
}

fn stand_in(text: &str) -> Line {
    Line {
        md: text.to_owned(),
        plain: text.to_owned(),
        words: text.chars().filter(|c| !c.is_whitespace()).count(),
        ..Line::default()
    }
}

/// Each line's words between `mark`s, the spaces around them left outside (`**bold** `, not `**bold **`).
fn wrap(lines: Vec<Line>, mark: &str) -> Vec<Line> {
    lines
        .into_iter()
        .map(|mut line| {
            if line.words > 0 {
                line.md = around(&line.md, |inner| format!("{mark}{inner}{mark}"));
            }
            line
        })
        .collect()
}

/// `text` with `f` applied to it without its leading and trailing whitespace, which stays outside.
fn around(text: &str, f: impl FnOnce(&str) -> String) -> String {
    let inner = text.trim_matches(is_space);
    let lead = &text[..text.len() - text.trim_start_matches(is_space).len()];
    let trail = &text[text.trim_end_matches(is_space).len()..];
    format!("{lead}{}{trail}", f(inner))
}

/// Monospaced words as inline code, each line's: the text as it is, between enough backticks.
fn code_span(lines: Vec<Line>) -> Vec<Line> {
    lines
        .into_iter()
        .map(|mut line| {
            if line.words > 0 {
                let plain = line.plain.clone();
                line.md = around(&plain, |inner| {
                    let longest = longest_run(inner, '`');
                    let ticks = "`".repeat(longest + 1);
                    if inner.starts_with('`') || inner.ends_with('`') {
                        format!("{ticks} {inner} {ticks}")
                    } else {
                        format!("{ticks}{inner}{ticks}")
                    }
                });
            }
            line
        })
        .collect()
}

fn longest_run(text: &str, c: char) -> usize {
    let (mut longest, mut run) = (0, 0);
    for ch in text.chars() {
        if ch == c {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    longest
}

/// A link: `[words](target)`; just the address when the words are it; just the words for a target that is not a
/// web, mail or phone address (Notes' data detectors).
fn link(node: &Handle, ctx: &InlineCtx) -> Vec<Line> {
    let inner = children(node, ctx);
    let Some(href) = element(node).and_then(|(_, node)| attr(node, "href")) else {
        return inner;
    };
    let href = href.trim().to_owned();
    let scheme = href
        .split_once(':')
        .map(|(scheme, _)| scheme.to_ascii_lowercase());
    if !matches!(
        scheme.as_deref(),
        Some("http" | "https" | "mailto" | "tel" | "ftp")
    ) || ctx.mono
    {
        return inner;
    }
    let target = if href.contains([' ', '(', ')', '<', '>']) {
        format!("<{}>", href.replace(['<', '>'], ""))
    } else {
        href.clone()
    };
    inner
        .into_iter()
        .map(|mut line| {
            if line.words > 0 {
                let words = squash(&line.plain);
                let bare = href
                    .strip_prefix("mailto:")
                    .or_else(|| href.strip_prefix("tel:"));
                line.md = if words == href || bare == Some(words.as_str()) {
                    around(&line.md, |_| words.clone())
                } else {
                    around(&line.md, |inner| format!("[{inner}]({target})"))
                };
            }
            line
        })
        .collect()
}

// ——— The DOM ———

/// An element's lowercase name.
fn element(node: &Handle) -> Option<(String, &Handle)> {
    match &node.data {
        NodeData::Element { name, .. } => Some((name.local.to_string().to_ascii_lowercase(), node)),
        _ => None,
    }
}

fn attr(node: &Handle, key: &str) -> Option<String> {
    match &node.data {
        NodeData::Element { attrs, .. } => attrs
            .borrow()
            .iter()
            .find(|attr| str::eq_ignore_ascii_case(&attr.name.local, key))
            .map(|attr| attr.value.to_string()),
        _ => None,
    }
}

/// An element's name when it is a block: a block element, or an `<object>` holding a table (as Notes writes tables).
fn block_name(node: &Handle) -> Option<String> {
    let (name, _) = element(node)?;
    (is_block(&name) || (name == "object" && has_table(node))).then_some(name)
}

fn has_table(node: &Handle) -> bool {
    node.children
        .borrow()
        .iter()
        .any(|child| element(child).is_some_and(|(name, _)| name == "table") || has_table(child))
}

/// A text node of whitespace alone.
fn is_blank_text(node: &Handle) -> bool {
    matches!(&node.data, NodeData::Text { contents } if contents.borrow().chars().all(char::is_whitespace))
}

/// The inline nodes after a table's `<object>`: the `<br>` ending its line left out, as the table is that line.
fn after_line_end(run: &[Handle]) -> &[Handle] {
    let start = run
        .iter()
        .position(|node| !is_blank_text(node))
        .unwrap_or(run.len());
    match run.get(start) {
        Some(node) if element(node).is_some_and(|(name, _)| name == "br") => &run[start + 1..],
        _ => run,
    }
}

fn is_block(name: &str) -> bool {
    matches!(
        name,
        "html"
            | "body"
            | "head"
            | "div"
            | "p"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "ul"
            | "ol"
            | "li"
            | "table"
            | "blockquote"
            | "pre"
            | "section"
            | "article"
            | "header"
            | "footer"
            | "main"
            | "nav"
            | "aside"
            | "figure"
            | "center"
            | "address"
            | "dl"
            | "dt"
            | "dd"
            | "script"
            | "style"
            | "template"
            | "title"
    )
}

/// Whether an element sets its words in a monospaced font: `<tt>`, `<code>`, …, or a font or style naming Menlo,
/// Courier, Monaco, Consolas or a mono font.
fn is_mono(node: &Handle, name: &str) -> bool {
    if matches!(name, "tt" | "code" | "kbd" | "samp" | "pre") {
        return true;
    }
    let mono_family = |family: &str| {
        let family = family.to_ascii_lowercase();
        ["menlo", "courier", "monaco", "consolas", "mono"]
            .iter()
            .any(|font| family.contains(font))
    };
    if name == "font" && attr(node, "face").is_some_and(|face| mono_family(&face)) {
        return true;
    }
    attr(node, "style").is_some_and(|style| {
        style.split(';').any(|declaration| {
            declaration
                .split_once(':')
                .is_some_and(|(property, value)| {
                    property.trim().eq_ignore_ascii_case("font-family") && mono_family(value)
                })
        })
    })
}
