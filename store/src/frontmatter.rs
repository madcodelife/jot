//! One top-level key of a note's frontmatter, read and written on its own: `locked` (`lock`), `icon` (`icon`) and
//! `pinned` (`pin`).
//! Writing it leaves every other line of the frontmatter and the body as they are.

use crate::split;

/// The value of `line` when it is the top-level `key` (not indented): unquoted, without a trailing `# comment`.
pub(crate) fn line_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(key)?.trim_start();
    let value = rest.strip_prefix(':')?;
    let value = match value.find(" #") {
        Some(at) => &value[..at],
        None => value,
    };
    let value = value.trim();
    Some(
        value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value),
    )
}

/// Every value of the top-level `key` in `content`'s frontmatter, in order (none without a frontmatter).
pub(crate) fn values<'a>(content: &'a str, key: &'a str) -> impl Iterator<Item = &'a str> {
    split(content)
        .frontmatter
        .into_iter()
        .flat_map(str::lines)
        .filter_map(move |line| line_value(line, key))
}

/// `content` with `key: <value>` in its frontmatter (`Some`: in place of the key's first line, else added last; a
/// frontmatter made when there is none), or without the key's lines (`None`: a frontmatter left empty goes). The rest
/// of the frontmatter, its line breaks and the body stay as they are. `value` is written as given (quoted or not).
pub(crate) fn with_value(content: &str, key: &str, value: Option<&str>) -> String {
    let parts = split(content);
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let Some(frontmatter) = parts.frontmatter else {
        return match value {
            Some(value) => format!("---{newline}{key}: {value}{newline}---{newline}{content}"),
            None => content.to_owned(),
        };
    };
    let line = value.map(|value| format!("{key}: {value}{newline}"));
    let mut kept = String::with_capacity(frontmatter.len() + line.as_ref().map_or(0, String::len));
    let mut placed = false;
    for existing in frontmatter.split_inclusive('\n') {
        if line_value(existing.trim_end_matches(['\n', '\r']), key).is_none() {
            kept.push_str(existing);
        } else if let Some(line) = line.as_deref()
            && !placed
        {
            kept.push_str(line);
            placed = true;
        }
    }
    if let Some(line) = line.as_deref()
        && !placed
    {
        kept.push_str(line);
    }
    if kept.trim().is_empty() {
        return parts.body.to_owned();
    }
    // What follows the closing `---` line.
    let closing = &parts.header[parts.header.len() - closing_len(parts.header)..];
    let mut out = String::with_capacity(content.len() + kept.len());
    out.push_str(&parts.header[..parts.header.len() - frontmatter.len() - closing.len()]);
    out.push_str(&kept);
    if !kept.ends_with('\n') {
        out.push_str(newline);
    }
    out.push_str(closing);
    out.push_str(parts.body);
    out
}

/// The length of the header's closing `---` line, its line break included.
fn closing_len(header: &str) -> usize {
    let without_break = header.trim_end_matches(['\n', '\r']);
    header.len() - without_break.len() + 3
}
