//! Apple Notes' HTML as Markdown, on HTML shaped as Notes writes it, and the JSON its scripting gives.

use std::time::{Duration, SystemTime};

use super::html::{ATTACHMENT, IMAGE, to_markdown};
use super::{NO_ID, NO_TEXT, ReadError, output_within, parse, progress_line};

fn md(html: &str) -> String {
    to_markdown(html, None)
}

#[test]
fn a_div_is_a_line_and_an_empty_one_a_blank_line() {
    let html = "<div>One</div>\n<div>Two</div>\n<div><br></div>\n<div>Three<br></div>\n<div><br></div>\n<div><br></div>\n<div>Four</div>\n";
    assert_eq!(md(html), "One\nTwo\n\nThree\n\n\nFour");
    // Lines broken inside one div.
    assert_eq!(md("<div>a<br>b<br><br>c</div>"), "a\nb\n\nc");
    // Blank lines at either end go.
    assert_eq!(md("<div><br></div><div>x</div><div><br></div>"), "x");
    assert_eq!(md(""), "");
}

#[test]
fn the_title_line_is_left_out() {
    let html = "<div><h1>Groceries</h1></div>\n<div><br></div>\n<div>Milk</div>\n";
    assert_eq!(to_markdown(html, Some("Groceries")), "Milk");
    // Another first line stays.
    assert_eq!(to_markdown(html, Some("Shopping")), "# Groceries\n\nMilk");
    // An older note's title: a bold first line, spaces and non-breaking ones aside.
    let html = "<div><b><span style=\"font-size: 24px\">Trip&nbsp; to  Kyoto</span></b></div><div>Day one</div>";
    assert_eq!(to_markdown(html, Some("Trip to Kyoto")), "Day one");
    // A list item is never the title.
    assert_eq!(
        to_markdown("<ul><li>Milk</li></ul>", Some("Milk")),
        "- Milk"
    );
    // A note that is only its title.
    assert_eq!(to_markdown("<div><h1>Alone</h1></div>", Some("Alone")), "");
}

#[test]
fn headings() {
    let html = "<div><h1><b>Title</b></h1></div><div><h2>Heading</h2></div><div><h3>Sub <i>heading</i></h3></div><div>text</div>";
    assert_eq!(md(html), "# Title\n## Heading\n### Sub *heading*\ntext");
}

#[test]
fn bold_italic_underline_and_strikethrough() {
    let html = "<div>a <b>bold </b>and <i>it</i> <u>under</u> <strike>gone</strike> <b><i>both</i></b></div>";
    assert_eq!(md(html), "a **bold** and *it* under ~~gone~~ ***both***");
    // Marks around words only: none around spaces, each line its own.
    assert_eq!(md("<div>w<b> </b>x<b>a<br>b</b></div>"), "w x**a**\n**b**");
}

#[test]
fn nested_lists() {
    let html = "<div>Things:</div>\n<ul>\n<li>Milk</li>\n<li>Eggs</li>\n<ul>\n<li>Free range</li>\n<ul><li>Large</li></ul>\n</ul>\n<li>Bread</li>\n</ul>\n<div><br></div>\n<ol>\n<li>First</li>\n<li>Second</li>\n<ol><li>Inner</li></ol>\n</ol>\n";
    assert_eq!(
        md(html),
        "Things:\n- Milk\n- Eggs\n  - Free range\n    - Large\n- Bread\n\n1. First\n2. Second\n   1. Inner"
    );
    // A list inside an item, and a numbered list's start.
    let html = "<ol start=\"9\"><li>Nine<ol><li>a</li></ol></li><li>Ten</li></ol>";
    assert_eq!(md(html), "9. Nine\n   1. a\n10. Ten");
    // An item with lines of its own.
    assert_eq!(md("<ul><li>one<br>more</li></ul>"), "- one\n  more");
}

#[test]
fn a_heading_in_a_list_item_is_the_item_s_words() {
    assert_eq!(
        md("<ul><li><h1>Head in item</h1></li></ul>"),
        "- Head in item"
    );
    assert_eq!(
        md("<ol><li>one<h2>two</h2></li><li><h3><b>three</b></h3></li></ol><div>after</div>"),
        "1. one\n   two\n2. **three**\nafter"
    );
}

#[test]
fn checklists_and_dash_lists_are_plain_lists() {
    let html = "<ul class=\"Apple-dash-list\"><li>dash</li></ul><ul><li>checked or not</li></ul>";
    assert_eq!(md(html), "- dash\n- checked or not");
}

#[test]
fn links() {
    let html = "<div>See <a href=\"https://example.com/a\">the site</a>, <a href=\"https://example.com\">https://example.com</a>, <a href=\"mailto:me@example.com\">me@example.com</a> and <a href=\"x-apple-data-detectors://3\">tomorrow</a>.</div>";
    assert_eq!(
        md(html),
        "See [the site](https://example.com/a), https://example.com, me@example.com and tomorrow."
    );
    assert_eq!(
        md("<div><a href=\"https://e.com/a b\"><b>bold link</b></a></div>"),
        "[**bold link**](<https://e.com/a b>)"
    );
}

#[test]
fn monospaced_lines_are_a_code_block() {
    let html = "<div>Run:</div>\n<div><tt>fn main() {</tt></div>\n<div><tt>&nbsp;&nbsp;&nbsp;&nbsp;println!(\"*hi*\");</tt></div>\n<div><tt><br></tt></div>\n<div><tt>}</tt></div>\n<div>after</div>";
    assert_eq!(
        md(html),
        "Run:\n```\nfn main() {\n    println!(\"*hi*\");\n\n}\n```\nafter"
    );
    // A Menlo font, or a style naming one, is monospaced too; a blank line after the code stays after it.
    let html = "<div><font face=\"Menlo-Regular\">ls -la</font></div><div><span style=\"font-family: Menlo; font-size: 12px\">cd ~</span></div><div><br></div><div>done</div>";
    assert_eq!(md(html), "```\nls -la\ncd ~\n```\n\ndone");
    // A fence longer than the backticks inside.
    assert_eq!(md("<div><tt>```</tt></div>"), "````\n```\n````");
}

#[test]
fn a_code_line_of_quote_marks_stays_code() {
    // A prompt alone on a line is code, not a blank line of a quote.
    assert_eq!(
        md("<div><tt>print(1)</tt></div><div><tt>&gt;&gt;&gt;</tt></div>"),
        "```\nprint(1)\n>>>\n```"
    );
    assert_eq!(
        md("<div><tt>a</tt></div><div><tt>&gt;</tt></div><div>after</div>"),
        "```\na\n>\n```\nafter"
    );
    // In a quote too, and the blank lines ending the block still go after it.
    assert_eq!(
        md(
            "<blockquote><div><tt>&gt;</tt></div><div><tt><br></tt></div></blockquote><div>out</div>"
        ),
        "> ```\n> >\n> ```\n>\nout"
    );
}

#[test]
fn preformatted_text_keeps_its_lines_and_spaces() {
    let html = "<pre>if x:\n    y = 1\n\nz</pre><div>after</div>";
    assert_eq!(md(html), "```\nif x:\n    y = 1\n\nz\n```\nafter");
}

#[test]
fn monospaced_words_in_a_line_are_inline_code() {
    let html = "<div>Type <tt>git status</tt> or <font face=\"Courier\">a`b</font> then <b>enter</b></div>";
    assert_eq!(md(html), "Type `git status` or ``a`b`` then **enter**");
    // In a list item, a monospaced item is inline code, not a block.
    assert_eq!(md("<ul><li><tt>npm i</tt></li></ul>"), "- `npm i`");
}

#[test]
fn tables() {
    let html = "<div>Before</div><div><table cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse: collapse\"><tbody><tr><td valign=\"top\"><div><b>Name</b></div></td><td valign=\"top\"><div>Qty</div></td></tr><tr><td valign=\"top\"><div>Milk</div></td><td valign=\"top\"><div>2 | 3</div></td></tr><tr><td><div>Eggs</div><div>brown</div></td></tr></tbody></table></div><div>After</div>";
    assert_eq!(
        md(html),
        "Before\n\n| **Name** | Qty |\n| --- | --- |\n| Milk | 2 \\| 3 |\n| Eggs brown |  |\n\nAfter"
    );
}

#[test]
fn a_table_in_an_object_is_a_table() {
    // As Notes writes a table: inside an `<object>`, a `<br>` after it, each cell's words in a `<div>`.
    let td = "<td valign=\"top\" style=\"border-style: solid; border-width: 1.0px 1.0px 1.0px 1.0px; border-color: #ccc; padding: 3.0px 5.0px 3.0px 5.0px; min-width: 70px\">";
    let html = format!(
        "<div><object><table cellspacing=\"0\" cellpadding=\"0\" style=\"border-collapse: collapse; direction: ltr\">\n<tbody>\n<tr>{td}<div><b><font face=\".PingFangUITextSC-Bold\">Day</font></b></div>\n</td>{td}<div><b><font face=\".PingFangUITextSC-Bold\">Plan</font></b></div>\n</td></tr>\n<tr><td valign=\"top\"><div><font face=\".PingFangUITextSC-Regular\">Mon</font></div>\n</td><td valign=\"top\"><div>Rest</div><div>or a walk</div>\n</td></tr>\n<tr><td valign=\"top\"><div>Tue<br>Wed</div>\n</td><td valign=\"top\"><div>Swim | run</div>\n</td></tr>\n</tbody>\n</table></object><br></div>\n<div>Total 12</div>"
    );
    assert_eq!(
        md(&html),
        "| **Day** | **Plan** |\n| --- | --- |\n| Mon | Rest or a walk |\n| Tue Wed | Swim \\| run |\n\nTotal 12"
    );
    // A blank line after it stays one blank line.
    assert_eq!(
        md(
            "<div><object><table><tr><td>a</td></tr></table></object><br></div><div><br></div><div>b</div>"
        ),
        "| a |\n| --- |\n\nb"
    );
}

#[test]
fn the_spaces_starting_a_line_are_kept() {
    let html = "<div>## Topics</div>\n<div>  - layout</div>\n<div>    - grids</div>\n<div>    - flex</div>\n<div>      - wrapping</div>";
    assert_eq!(
        md(html),
        "## Topics\n  - layout\n    - grids\n    - flex\n      - wrapping"
    );
    // Tabs, non-breaking spaces and spaces before styled words too; spaces inside the line still collapse.
    assert_eq!(
        md(
            "<div>\tstep  one</div><div>&nbsp; two</div><div>  <b>three</b></div><div>a<br>  b</div>"
        ),
        "\tstep one\n  two\n  **three**\na\n  b"
    );
    // The line breaks between tags in the source are not indentation.
    assert_eq!(md("<div>\n<b>x</b></div>\n<div>\n  y</div>"), "**x**\ny");
    // Nor do a heading or a list item take any.
    assert_eq!(
        md("<div><h2>  Head</h2></div><ul><li>  item</li></ul>"),
        "## Head\n- item"
    );
    // An indented monospaced line keeps its indent in the code block.
    assert_eq!(
        md("<div><tt>if x:</tt></div><div><tt>  y()</tt></div>"),
        "```\nif x:\n  y()\n```"
    );
}

#[test]
fn runs_of_one_style_side_by_side_are_one_run() {
    let html = "<ul class=\"Apple-dash-list\">\n<li><strike><font face=\".PingFangUITextSC-Regular\">Buy fish at the market, cook it at </font></strike><strike>the corner place</strike></li>\n</ul>";
    assert_eq!(
        md(html),
        "- ~~Buy fish at the market, cook it at the corner place~~"
    );
    assert_eq!(
        md("<div><b>bo</b><b>ld</b> <i>one </i><i>two</i> <b>a</b> <b>b</b></div>"),
        "**bold** *one two* **a b**"
    );
    // Different styles stay apart.
    assert_eq!(md("<div><b>a</b> <i>b</i></div>"), "**a** *b*");
}

#[test]
fn a_title_over_several_headings_is_left_out() {
    let html = "<div><h1>Shoes</h1><b><h1>👟</h1></b><h1><br></h1></div>\n<div>Size 42</div>";
    assert_eq!(to_markdown(html, Some("Shoes👟")), "Size 42");
    assert_eq!(to_markdown(html, Some("Shoes 👟")), "Size 42");
    // A first block saying more than the title stays (its first line goes when that is the title).
    let html = "<div><h1>Shoes</h1><b><h1>Boots</h1></b></div>\n<div>Size 42</div>";
    assert_eq!(
        to_markdown(html, Some("Shoes👟")),
        "# Shoes\n**Boots**\nSize 42"
    );
    // A title in one heading or in bold, as before.
    assert_eq!(
        to_markdown("<div><h1>Plan</h1></div>\n<div>Ship it</div>", Some("Plan")),
        "Ship it"
    );
    assert_eq!(
        to_markdown("<div><b>Plan</b></div>\n<div>Ship it</div>", Some("Plan")),
        "Ship it"
    );
}

#[test]
fn images_and_attachments_leave_a_line() {
    let html = "<div>Photo:</div><div><img src=\"data:\" style=\"max-width: 100%\"><br></div><div><object type=\"application/pdf\"></object></div><div>end</div>";
    assert_eq!(md(html), format!("Photo:\n{IMAGE}\n{ATTACHMENT}\nend"));
}

#[test]
fn entities_and_spaces() {
    let html = "<div>Fish &amp; chips &lt;3 &quot;yes&quot; caf&eacute; &#x1F600;&nbsp;&nbsp;x   y\n z</div><div>&nbsp;&nbsp;indented</div>";
    assert_eq!(
        md(html),
        "Fish & chips <3 \"yes\" café 😀  x y z\n  indented"
    );
}

#[test]
fn block_quotes() {
    let html =
        "<blockquote><div>quoted</div><div><br></div><div>two</div></blockquote><div>out</div>";
    assert_eq!(md(html), "> quoted\n>\n> two\nout");
}

#[test]
fn a_whole_document_is_read_from_its_body() {
    let html = "<html><head><style>div { color: red }</style></head><body><div>Hi</div><script>x()</script></body></html>";
    assert_eq!(md(html), "Hi");
}

#[test]
fn html_nested_very_deep_is_its_text() {
    let deep = |open: &str, close: &str, n: usize| {
        format!("{}deep{}<div>after</div>", open.repeat(n), close.repeat(n))
    };
    // Each of these would overflow the stack, walked all the way in. (html5ever takes its time over deep blocks, a
    // debug build seconds: fewer of those.)
    for (open, close, n) in [
        ("<div>", "</div>", 20_000),
        ("<b>", "</b>", 20_000),
        ("<span>", "</span>", 20_000),
        ("<table><tr><td>", "</td></tr></table>", 20_000),
        ("<blockquote>", "</blockquote>", 2_000),
        ("<ul><li>", "</li></ul>", 2_000),
    ] {
        let md = md(&deep(open, close, n));
        assert!(md.contains("deep"), "{open}: {md:.200}");
    }
    // Not so deep, it is walked as usual.
    assert_eq!(md(&deep("<div>", "</div>", 50)), "deep\nafter");
}

#[test]
fn notes_json_becomes_notes_to_import() {
    let json = r#"{"folders": [
        {"account": "iCloud", "path": ["Notes"], "deleted": false, "notes": [
            {"id": "x-coredata://A/ICNote/p1", "name": "Groceries", "modified": 1700000000000, "locked": false,
             "body": "<div><h1>Groceries</h1></div><div>Milk</div>"},
            {"id": "x-coredata://A/ICNote/p2", "name": "Diary", "modified": 1700000001000, "locked": true, "body": null},
            {"id": "x-coredata://A/ICNote/p3", "name": "Odd", "modified": 1600000000000, "locked": false, "body": null},
            {"id": "", "name": "Nameless", "modified": 1600000000000, "locked": false, "body": "<div>x</div>"}
        ]},
        {"account": "iCloud", "path": ["Work", "Projects"], "deleted": false, "notes": [
            {"id": "x-coredata://A/ICNote/p4", "name": "Plan", "modified": 1800000000000, "locked": false,
             "body": "<div>Plan</div><div>Ship it</div>"}
        ]},
        {"account": "iCloud", "path": ["Recently Deleted"], "deleted": true, "notes": [
            {"id": "x-coredata://A/ICNote/p5", "name": "Old", "modified": 1, "locked": false, "body": null},
            {"id": "x-coredata://A/ICNote/p6", "name": "Older", "modified": 1, "locked": false, "body": null}
        ]},
        {"account": "On My Mac", "path": ["Notes"], "deleted": false, "notes": []}
    ]}"#;
    let read = parse(json).unwrap();
    assert_eq!(read.locked, 1);
    assert_eq!(read.deleted, 2);
    assert_eq!(
        read.unreadable,
        [("Odd".to_owned(), NO_TEXT), ("Nameless".to_owned(), NO_ID)]
    );
    // Newest first.
    let titles: Vec<&str> = read.notes.iter().map(|n| n.title.as_str()).collect();
    assert_eq!(titles, ["Plan", "Groceries"]);
    let plan = &read.notes[0];
    assert_eq!(plan.id, "x-coredata://A/ICNote/p4");
    assert_eq!(plan.body, "Ship it");
    assert_eq!(plan.folder.as_deref(), Some("Work/Projects"));
    assert_eq!(
        plan.modified,
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000)
    );
    assert_eq!(read.notes[1].body, "Milk");
    assert_eq!(read.notes[1].folder.as_deref(), Some("Notes"));

    // As the script writes it, ASCII alone: the rest escaped, a character past U+FFFF as a pair.
    let json = r#"{"folders": [{"path": ["Caf\u00e9"], "deleted": false, "notes": [{"id": "x-coredata://A/ICNote/p7",
        "name": "\u6700\u8fd1 \ud83d\ude00", "modified": 1, "locked": false,
        "body": "<div>\u6700\u8fd1 \ud83d\ude00</div><div>cut \ufffd</div>"}]}]}"#;
    let read = parse(json).unwrap();
    assert_eq!(read.notes[0].title, "最近 😀");
    assert_eq!(read.notes[0].body, "cut \u{fffd}");
    assert_eq!(read.notes[0].folder.as_deref(), Some("Café"));

    assert!(parse("not json").is_err());
    assert!(parse("{}").is_err());
}

#[test]
fn osascript_refused_is_not_authorized() {
    let refused =
        "execution error: Error: Error: Not authorized to send Apple events to Notes. (-1743)\n";
    assert_eq!(ReadError::of_osascript(refused), ReadError::NotAuthorized);
    assert_eq!(
        ReadError::of_osascript(
            "execution error: Error: Error: Notes got an error: AppleEvent timed out. (-1712)\n"
        ),
        ReadError::Failed(
            "execution error: Error: Error: Notes got an error: AppleEvent timed out. (-1712)"
                .to_owned()
        )
    );
    assert_eq!(
        ReadError::of_osascript(""),
        ReadError::Failed("osascript failed".to_owned())
    );
}

#[test]
#[cfg(unix)]
fn a_command_past_its_limit_is_killed() {
    use std::process::Command;
    use std::time::Instant;

    let started = Instant::now();
    let mut sleep = Command::new("/bin/sleep");
    sleep.arg("30");
    assert!(
        output_within(sleep, Duration::from_millis(200), |_, _| {})
            .unwrap()
            .is_none()
    );
    assert!(started.elapsed() < Duration::from_secs(10));
    // Within it, its output, a lot of it on both pipes (neither filling up stops it).
    let line = "a line of output, long enough to fill a pipe";
    let mut sh = Command::new("/bin/sh");
    sh.args([
        "-c",
        &format!("i=0; while [ $i -lt 2000 ]; do echo '{line}'; echo err >&2; i=$((i+1)); done"),
    ]);
    let output = output_within(sh, Duration::from_secs(60), |_, _| {})
        .unwrap()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(output.stdout.len(), 2000 * (line.len() + 1));
    assert_eq!(output.stderr.len(), 2000 * 4);
}

#[test]
#[cfg(unix)]
fn progress_on_stderr_is_reported_as_it_comes_and_left_out() {
    use std::process::Command;
    use std::sync::{Arc, Mutex};

    let seen = Arc::new(Mutex::new(Vec::new()));
    let mut sh = Command::new("/bin/sh");
    sh.args([
        "-c",
        "echo 'progress 0 2' >&2; echo warning >&2; echo 'progress 1 2' >&2; echo '{}'; echo 'progress 2 2' >&2",
    ]);
    let reported = Arc::clone(&seen);
    let output = output_within(sh, Duration::from_secs(60), move |done, total| {
        reported.lock().unwrap().push((done, total))
    })
    .unwrap()
    .unwrap();
    assert_eq!(*seen.lock().unwrap(), [(0, 2), (1, 2), (2, 2)]);
    assert_eq!(output.stdout, b"{}\n");
    assert_eq!(output.stderr, b"warning\n");

    assert_eq!(progress_line(b"progress 5 15\n"), Some((5, 15)));
    assert_eq!(progress_line(b"progress 5 15\r\n"), Some((5, 15)));
    assert_eq!(progress_line(b"progress 5"), None);
    assert_eq!(progress_line(b"progress 5 15 more"), None);
    assert_eq!(progress_line(b"execution error: progress 5 15"), None);
}

#[test]
fn a_note_outside_any_folder_notes_named_is_imported_without_one() {
    // As the script writes a note whose folder Notes did not list, and a folder whose parent it did not: last, the
    // note's with no path.
    let json = r#"{"folders": [
        {"account": "", "path": ["Stray"], "deleted": false, "notes": [
            {"id": "x-coredata://A/ICNote/p8", "name": "Strayed", "modified": 2, "locked": false, "body": "<div>a</div>"}
        ]},
        {"account": "", "path": [], "deleted": false, "notes": [
            {"id": "x-coredata://A/ICNote/p9", "name": "Loose", "modified": 1, "locked": false, "body": "<div>b</div>"}
        ]}
    ]}"#;
    let read = parse(json).unwrap();
    let folders: Vec<(&str, Option<&str>)> = read
        .notes
        .iter()
        .map(|n| (n.title.as_str(), n.folder.as_deref()))
        .collect();
    assert_eq!(folders, [("Strayed", Some("Stray")), ("Loose", None)]);
}

/// Runs src/platform/apple-notes.js under Node against an invented Notes (scripts/apple-notes-fake.mjs), and reads
/// what it gives as Jot does. Needs Node, so not in CI: `cargo test -p nsh-app-jot apple_notes_script_under_node --
/// --ignored --nocapture`.
#[test]
#[ignore = "needs Node"]
fn apple_notes_script_under_node() {
    use std::process::Command;

    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    for odd in [false, true] {
        let mut node = Command::new("node");
        node.arg(root.join("scripts/apple-notes-fake.mjs"));
        if odd {
            node.arg("--odd");
        }
        let output = node.output().expect("node");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stderr = String::from_utf8(output.stderr).unwrap();
        println!("{stderr}");
        let progress: Vec<(u32, u32)> = stderr
            .lines()
            .filter_map(|line| progress_line(line.as_bytes()))
            .collect();
        assert_eq!(progress.first(), Some(&(0, 12 + if odd { 2 } else { 0 })));
        assert!(progress.windows(2).all(|w| w[1].0 == w[0].0 + 1));
        let events: u32 = stderr
            .lines()
            .find_map(|line| line.strip_prefix("apple events "))
            .unwrap()
            .parse()
            .unwrap();
        // Nine for every account, folder and note; one a folder for its notes' ids and one for their text, one a
        // note in a folder with a locked one or in no folder listed.
        assert_eq!(events, if odd { 41 } else { 38 });

        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.is_ascii());
        let read = parse(&stdout).unwrap();
        assert_eq!(read.locked, 1);
        assert_eq!(read.deleted, 2);
        assert!(read.unreadable.is_empty(), "{:?}", read.unreadable);
        assert_eq!(read.notes.len(), 51 + if odd { 2 } else { 0 });
        let folder = |title: &str| {
            let note = read.notes.iter().find(|n| n.title == title).unwrap();
            (note.folder.clone(), note.body.clone())
        };
        assert_eq!(
            folder("Note 3"),
            (
                Some("Work/Projects/Archive".to_owned()),
                "Line of note 3\n[image not imported]".to_owned()
            )
        );
        assert_eq!(folder("Note 11").0.as_deref(), Some("Ideas/Café 😀"));
        if odd {
            assert_eq!(folder("Loose").0, None);
            assert_eq!(folder("Strayed").0.as_deref(), Some("Stray"));
        }
    }
}

/// Imports what Notes' scripting gave on a real Mac, captured with
/// `osascript -l JavaScript src/platform/apple-notes.js > /tmp/apple-notes.json`, into a folder (never Jot's own):
/// `JOT_APPLE_NOTES_JSON=/tmp/apple-notes.json JOT_IMPORT_DIR=/tmp/jot-import cargo test -p nsh-app-jot
/// apple_notes_from_a_capture -- --ignored --nocapture`. Run it twice: the second imports nothing.
#[test]
#[ignore = "needs a capture of a real Notes: JOT_APPLE_NOTES_JSON, JOT_IMPORT_DIR"]
fn apple_notes_from_a_capture() {
    let json = std::fs::read_to_string(std::env::var("JOT_APPLE_NOTES_JSON").unwrap()).unwrap();
    let dir = std::env::var("JOT_IMPORT_DIR").unwrap();
    let read = parse(&json).unwrap();
    println!(
        "read {} notes ({} locked, {} in Recently Deleted, {} without text)",
        read.notes.len(),
        read.locked,
        read.deleted,
        read.unreadable.len()
    );
    let store = jot_store::Store::open(&dir).unwrap();
    let imported = store.import(&read.notes).unwrap();
    println!("{imported:#?}");
}
