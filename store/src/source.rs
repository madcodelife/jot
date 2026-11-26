//! Who created a note: the user, or an AI app through the MCP server, as the frontmatter's `source` key says.
//!
//! `source` is a common frontmatter key (web clippers write the page's URL there, reading notes a book's title), so
//! only values Jot writes count as an AI app: a known app's key (`claude`, `cursor`, …, or `agent` for an app that
//! gave no name), or `agent:<name>` for any other app. Every other value is the user's own.

/// Who created a note.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Source {
    /// Written by the user: no `source` key in the frontmatter, or one Jot did not write.
    #[default]
    User,
    /// Created by an AI app through the MCP server: the frontmatter's `source` value, a known app's key
    /// (`claude`, `claude-code`, `cursor`, …: [`Source::from_client`]) or `agent:<name>` for any other app. Notes
    /// from before this distinction say `claude`, Claude's key.
    Agent(String),
}

/// The apps Jot knows by name: their key in the frontmatter, the name shown, the MCP `clientInfo.name`s that are
/// exactly that app, and what else such a name contains (lowercase). Tried in order: Cursor before VS Code, whose
/// names it resembles. Claude's apps are matched by name only, so third-party apps named after Claude stay apart.
const KNOWN: &[Known] = &[
    Known {
        key: "claude-code",
        label: "Claude Code",
        names: &["claude-code", "claude code"],
        contains: &[],
    },
    Known {
        key: "claude",
        label: "Claude",
        names: &["claude-ai", "claude", "claude desktop", "claude-desktop"],
        contains: &[],
    },
    Known {
        key: "cursor",
        label: "Cursor",
        names: &[],
        contains: &["cursor"],
    },
    Known {
        key: "codex",
        label: "Codex",
        names: &[],
        contains: &["codex"],
    },
    Known {
        key: "windsurf",
        label: "Windsurf",
        names: &[],
        contains: &["windsurf", "codeium"],
    },
    Known {
        key: "gemini",
        label: "Gemini CLI",
        names: &[],
        contains: &["gemini"],
    },
    Known {
        key: "vscode",
        label: "VS Code",
        names: &[],
        contains: &["visual studio code", "vscode", "vs code"],
    },
    Known {
        key: "zed",
        label: "Zed",
        names: &["zed"],
        contains: &[],
    },
];

struct Known {
    key: &'static str,
    label: &'static str,
    names: &'static [&'static str],
    contains: &'static [&'static str],
}

/// The key a client that gave no usable name is written with, and the prefix of any other's name.
const UNNAMED: &str = "agent";
const PREFIX: &str = "agent:";
/// The longest name kept from a client, in characters.
const MAX_NAME: usize = 64;

impl Source {
    /// An app's source from its value as the frontmatter has it: a known key, `agent` or `agent:<name>`.
    pub fn agent(key: impl Into<String>) -> Source {
        Source::Agent(key.into())
    }

    /// The source for an MCP client that calls itself `name` (its `clientInfo.name`): a known app by its key
    /// (`claude-ai` → `claude`, `Visual Studio Code` → `vscode`), any other as `agent:<name>`, the name made one
    /// line of at most 64 characters without quotes or backslashes.
    pub fn from_client(name: &str) -> Source {
        let lower = name.trim().to_lowercase();
        let known = KNOWN.iter().find(|known| {
            lower == known.key
                || known.names.contains(&lower.as_str())
                || known.contains.iter().any(|needle| lower.contains(needle))
        });
        if let Some(known) = known {
            return Source::agent(known.key);
        }
        let cleaned: String = name
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .filter(|c| !matches!(c, '"' | '\\'))
            .take(MAX_NAME)
            .collect();
        let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
        Source::Agent(if cleaned.is_empty() {
            UNNAMED.to_owned()
        } else {
            format!("{PREFIX}{cleaned}")
        })
    }

    /// The name shown for it: a known app's ("Claude", "Claude Code", "Cursor", "VS Code"), the name after
    /// `agent:`, "AI" for `agent`; `None` for the user.
    pub fn label(&self) -> Option<String> {
        let Source::Agent(key) = self else {
            return None;
        };
        if let Some(known) = KNOWN.iter().find(|known| known.key == key) {
            return Some(known.label.to_owned());
        }
        match key.strip_prefix(PREFIX).map(str::trim) {
            Some(name) if !name.is_empty() => Some(name.to_owned()),
            _ => Some("AI".to_owned()),
        }
    }

    /// The frontmatter that records it: none for the user, else `source: <value>`, in double quotes unless YAML
    /// reads it as that plain string (`cursor`, but `"agent:Goose"`, `"true"`, `"123"`, `"-x"`).
    pub(crate) fn header(&self) -> String {
        match self {
            Source::User => String::new(),
            Source::Agent(key) => format!("---\nsource: {}\n---\n", yaml_string(key)),
        }
    }

    /// The source a note's frontmatter records: its top-level `source` value (unquoted, without a trailing
    /// comment) when Jot wrote it (a known app's key, `agent`, `agent:<name>`, in any case), else the user.
    pub(crate) fn of_frontmatter(frontmatter: &str) -> Source {
        let Some(value) = frontmatter
            .lines()
            .find_map(|line| top_level_string(line, "source"))
        else {
            return Source::User;
        };
        let value = value.trim();
        if let Some(known) = KNOWN
            .iter()
            .find(|known| known.key.eq_ignore_ascii_case(value))
        {
            return Source::agent(known.key);
        }
        if value.eq_ignore_ascii_case(UNNAMED) {
            return Source::agent(UNNAMED);
        }
        match value.get(..PREFIX.len()) {
            Some(prefix) if prefix.eq_ignore_ascii_case(PREFIX) => {
                let name = value[PREFIX.len()..].trim();
                Source::Agent(if name.is_empty() {
                    UNNAMED.to_owned()
                } else {
                    format!("{PREFIX}{name}")
                })
            }
            _ => Source::User,
        }
    }
}

/// A line's value when it is the top-level key `name` (not indented): unquoted, without a trailing comment.
pub(crate) fn top_level_string(line: &str, name: &str) -> Option<String> {
    let (key, value) = line.split_once(':')?;
    if key.trim_end() != name {
        return None;
    }
    let value = value.trim_start();
    let parsed = if let Some(rest) = value.strip_prefix('"') {
        // Double quotes: backslash escapes, up to the closing quote.
        let mut out = String::new();
        let mut chars = rest.chars();
        loop {
            match chars.next()? {
                '"' => break,
                '\\' => match chars.next()? {
                    'n' => out.push('\n'),
                    't' => out.push('\t'),
                    c => out.push(c),
                },
                c => out.push(c),
            }
        }
        out
    } else if let Some(rest) = value.strip_prefix('\'') {
        // Single quotes: `''` is a quote, up to the closing one.
        let mut out = String::new();
        let mut chars = rest.chars().peekable();
        loop {
            match chars.next()? {
                '\'' if chars.peek() == Some(&'\'') => {
                    chars.next();
                    out.push('\'');
                }
                '\'' => break,
                c => out.push(c),
            }
        }
        out
    } else {
        // Plain: a comment starts at a `#` after a space (or at the start).
        let end = value
            .char_indices()
            .find(|&(i, c)| c == '#' && (i == 0 || value[..i].ends_with([' ', '\t'])))
            .map_or(value.len(), |(i, _)| i);
        value[..end].trim().to_owned()
    };
    Some(parsed)
}

/// `value` as a YAML scalar that reads back as this string: plain when it is a word YAML takes as a string
/// (a letter, then letters, digits, `-`, `_` and `.`; not `true`, `null`, `yes`, …), else in double quotes.
pub(crate) fn yaml_string(value: &str) -> String {
    const SPECIAL: &[&str] = &[
        "true", "false", "yes", "no", "on", "off", "y", "n", "null", "nan", "inf",
    ];
    let plain = value
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !SPECIAL.iter().any(|word| word.eq_ignore_ascii_case(value));
    if plain {
        return value.to_owned();
    }
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::{Source, yaml_string};

    fn key(name: &str) -> String {
        match Source::from_client(name) {
            Source::Agent(key) => key,
            Source::User => unreachable!(),
        }
    }

    #[test]
    fn known_clients_by_key() {
        assert_eq!(key("claude-ai"), "claude");
        assert_eq!(key("Claude"), "claude");
        assert_eq!(key("claude-code"), "claude-code");
        assert_eq!(key("cursor-vscode"), "cursor");
        assert_eq!(key("Visual Studio Code"), "vscode");
        assert_eq!(key("Visual Studio Code - Insiders"), "vscode");
        assert_eq!(key("codex-mcp-client"), "codex");
        assert_eq!(key("windsurf-client"), "windsurf");
        assert_eq!(key("gemini-cli-mcp-client"), "gemini");
        assert_eq!(key("Zed"), "zed");
        // Third-party apps named after Claude are not Claude.
        assert_eq!(key("claude-dev"), "agent:claude-dev");
        assert_eq!(key("Claude Helper"), "agent:Claude Helper");
        // Others keep their own name, cleaned, after `agent:`.
        assert_eq!(key("  My \"Agent\"\n2 "), "agent:My Agent 2");
        assert_eq!(key(""), "agent");
        assert_eq!(key(&"x".repeat(100)), format!("agent:{}", "x".repeat(64)));
    }

    #[test]
    fn labels() {
        assert_eq!(Source::User.label(), None);
        assert_eq!(Source::agent("claude").label().as_deref(), Some("Claude"));
        assert_eq!(
            Source::agent("claude-code").label().as_deref(),
            Some("Claude Code")
        );
        assert_eq!(Source::agent("vscode").label().as_deref(), Some("VS Code"));
        assert_eq!(
            Source::agent("gemini").label().as_deref(),
            Some("Gemini CLI")
        );
        assert_eq!(
            Source::agent("agent:goose").label().as_deref(),
            Some("goose")
        );
        assert_eq!(Source::agent("agent").label().as_deref(), Some("AI"));
        assert_eq!(Source::agent("agent:").label().as_deref(), Some("AI"));
    }

    #[test]
    fn frontmatter_round_trip() {
        for name in [
            "claude-ai",
            "claude-code",
            "cursor-vscode",
            "",
            "My Agent: v2 # x",
            "it's",
            "true",
            "123",
            "- dash",
        ] {
            let source = Source::from_client(name);
            let header = source.header();
            let inner = header.trim_start_matches("---\n").trim_end_matches("---\n");
            assert_eq!(Source::of_frontmatter(inner), source, "{header}");
        }
        assert_eq!(
            Source::agent("cursor").header(),
            "---\nsource: cursor\n---\n"
        );
        assert_eq!(Source::agent("agent").header(), "---\nsource: agent\n---\n");
        assert_eq!(
            Source::from_client("Goose").header(),
            "---\nsource: \"agent:Goose\"\n---\n"
        );
        assert_eq!(Source::User.header(), "");
    }

    #[test]
    fn only_values_jot_writes_are_an_app() {
        let of = Source::of_frontmatter;
        assert_eq!(of("title: x"), Source::User);
        assert_eq!(of("source: ''"), Source::User);
        assert_eq!(of("source: user"), Source::User);
        // What web clippers and reading notes put there.
        assert_eq!(of("source: \"https://example.com/a\""), Source::User);
        assert_eq!(of("source: https://example.com/a"), Source::User);
        assert_eq!(of("source: 某本书"), Source::User);
        assert_eq!(of("source: Goose"), Source::User);
        assert_eq!(of("source: claude-dev"), Source::User);
        // Jot's own values, in any case, quoted or not.
        assert_eq!(of("source: 'Claude'"), Source::agent("claude"));
        assert_eq!(of("source: CURSOR"), Source::agent("cursor"));
        assert_eq!(of("source: Agent"), Source::agent("agent"));
        assert_eq!(of("source: \"agent:Goose\""), Source::agent("agent:Goose"));
        assert_eq!(of("source: AGENT: Goose"), Source::agent("agent:Goose"));
        assert_eq!(of("source: \"agent:\""), Source::agent("agent"));
        // Only the top-level key, and not its comment.
        assert_eq!(of("meta:\n  source: claude"), Source::User);
        assert_eq!(of("source: claude # from MCP"), Source::agent("claude"));
        assert_eq!(of("source: \"claude\" # x"), Source::agent("claude"));
        assert_eq!(of("source: # claude"), Source::User);
        assert_eq!(of("source:claude"), Source::agent("claude"));
        assert_eq!(of("source: 'it''s'"), Source::User);
        assert_eq!(of("source: 'agent:it''s'"), Source::agent("agent:it's"));
    }

    #[test]
    fn yaml_strings() {
        assert_eq!(yaml_string("cursor"), "cursor");
        assert_eq!(yaml_string("claude-code"), "claude-code");
        for ambiguous in ["true", "No", "null", "123", "1.5", "-x", "a: b", "", "# x"] {
            assert!(yaml_string(ambiguous).starts_with('"'), "{ambiguous}");
        }
        assert_eq!(yaml_string("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }
}
