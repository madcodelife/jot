# Contributing to Jot

Jot is built with [NSH](https://github.com/longbridge/nsh): the client is TSX, and the notes store, the reminders and
the platform code are Rust. Only macOS is supported for now.

## Setting up

- Rust stable, with `rustfmt` and `clippy`.
- The `nsh` CLI of the version `Cargo.lock` pins for the NSH crates (`nsh-core`, `nsh-extra`): the CLI and the crates
  must be the same. `scripts/install-nsh.sh` installs that one (a release, or a commit of NSH's repository built from
  source), as CI does; `scripts/install-nsh.sh --which` only prints which it would install. `NSH_INSTALL_DIR` sets
  where NSH goes (default `~/.nsh`); `nsh` is linked into `~/.local/bin`.

Jot builds against NSH's repository at a commit (`Cargo.toml`'s `nsh-core` and `nsh-extra`), not a release: the
note's live preview needs the editor decorations' labels and font sizes and a fix to them (NSH #3272), which no release
has yet (0.7.0 lacks them). Building that commit's CLI from source takes a while. It goes back to a crates.io version
once a release of NSH has them.

## Commands

```sh
nsh run                       # build and run the app
nsh check                     # cargo check, then type-check the TSX
nsh test                      # Rust tests, then the TSX tests, headless
cargo fmt --all               # format the Rust
cargo build -p jot-mcp        # the MCP server, which `nsh run` (a debug build) finds in cargo's target folder
scripts/package-macos.sh      # build Jot.app, with jot-mcp inside
scripts/native-fingerprint.sh # the native fingerprint of this checkout (docs/app.md, Updates)
scripts/demo-notes.sh         # English example notes for screenshots, in ~/Documents/Jot Demo
scripts/build-site.sh         # the website (site/) put together in _site/; preview: python3 -m http.server -d _site
```

While developing, `nsh run` (a debug build) finds `jot-mcp` in cargo's target folder: build it once with
`cargo build -p jot-mcp` to connect apps from Settings.

### Before you push

CI (`.github/workflows/ci.yml`) runs these, in this order; run them first:

```sh
cargo fmt --all --check
nsh check
cargo clippy --workspace --all-targets --locked -- -D warnings
nsh test
```

Some store tests are ignored because they need a real iCloud Drive folder; [docs/storage.md](docs/storage.md) and
[docs/locks.md](docs/locks.md) say how to run them.

### Packaging

`scripts/package-macos.sh` builds `jot-mcp`, runs `nsh package --target macos` (it passes on its options: `--arch
universal`, `--out`, `--name`, …), puts `jot-mcp` in `Jot.app/Contents/MacOS` and signs both again (ad hoc;
`SIGN_IDENTITY` for another identity, then with a secure timestamp and the hardened runtime). It runs the `nsh` on your
`PATH`, or `NSH=/path/to/nsh`, and warns when that is not the NSH `Cargo.toml`
names. It needs `jq`. CI packages `Jot.app` for arm64 and x86_64 only for a `v*` tag ([Releasing](#releasing)). How
the script works: [docs/app.md](docs/app.md#packaging-scriptspackage-macossh).

## Releasing

A release is a `v*` tag; `.github/workflows/release.yml` does the rest. Installed copies update themselves from it
([docs/app.md](docs/app.md#updates-appupdatests)).

1. In `nsh.json`, raise `version` (semver) and `build` (a whole number). `build` is one counter for apps and OTA
   packages: raise it by one for every release, never reuse one.
2. Commit, merge to `main`, then tag that commit `v<version>` and push the tag:

   ```sh
   git tag v0.2.0 && git push origin v0.2.0
   ```

The workflow then:

- checks the tag is `v` + nsh.json's `version`, and that `version` and `build` are higher than the last release tag's
  (it fails otherwise: fix nsh.json, tag again);
- fails while a secret below is missing: a release without a signed `latest.json` would leave every installed copy
  without updates;
- packages `Jot.app` for arm64 and x86_64 with the native fingerprint, and makes of each the zip `install.sh`
  downloads (`Jot-v0.2.0-macos-arm64.zip`) and the update archive (`Jot-0.2.0-macos-aarch64.tar.gz`);
- publishes the OTA package of the code (`com.madcodelife.jot-<build>.nshpkg`, its version
  `<version>+native.<fingerprint>`);
- writes `latest.json` for both archives and the package, with patches from the last release's archives, signs it
  (`latest.json.sig`), and makes the release with all of them.

A release that changed no native code reaches installed copies as the package; one that did, as the whole app (the
fingerprint decides, in the app). Notes of the release are GitHub's, generated from the pull requests.

### Keys and secrets (once)

Three keys ([NSH's OTA updates](https://github.com/longbridge/nsh/blob/main/website/docs/ota-updates.md#keys)), made
with the `nsh` CLI, outside the repository; never commit a `.secret`:

```sh
nsh keygen keys/root      # the root installed copies trust; keep keys/root.secret offline
nsh keygen keys/release   # signs the packages, in CI
nsh keygen keys/update    # signs latest.json, in CI
nsh certify --root keys/root.secret --key keys/release.pub --apps com.madcodelife.jot -o keys/release.cert
```

Put the contents of `keys/update.pub` in nsh.json's `updater.publicKey` and of `keys/root.pub` in
`updater.packages.roots`, then store the others as the repository's secrets:

```sh
gh secret set NSH_RELEASE_KEY < keys/release.secret
gh secret set NSH_RELEASE_CERT < keys/release.cert
gh secret set NSH_UPDATE_KEY < keys/update.secret
```

The certificate lasts 365 days: certify the release key again before then and update `NSH_RELEASE_CERT` (installed
copies trust the root, so they need no update). The keys in nsh.json are built into every app: a release that changes
the update key must still be signed with the old one, which the copies installed before it trust.

## Where code goes

[docs/architecture.md](docs/architecture.md) maps the folders and links a page per topic. In short:

| What | Where |
| --- | --- |
| A component, a window's view | `app/ui/` |
| Radii, sizes, type steps, materials, springs, key labels | `app/ui/tokens.ts`, by platform; colors in the themes (`app/ui/theme.json`, `app/ui/themes.json`) |
| Client logic and state, no components | `app/*.ts` (state in `app/store.ts`: components read its signals, its functions write them) |
| Wiring the windows, the tray and the global keys | `app/App.tsx` |
| Text the user reads | `locales/*.yml`, in all four languages (`en`, `zh`, `zh-Hant`, `ja`) |
| Something the client needs from the system or Rust | `src/`, exported to TSX as `jot/native`; platform code in `src/platform/<os>.rs` behind one interface |
| The notes folder: its format, reading, writing, to-dos, time phrases, locks | `store/` (jot-store), so the app and `jot-mcp` share it |
| A tool for AI apps | `mcp/` (jot-mcp) |
| TSX tests | `app/tests/*.test.tsx` (`nsh test` finds tests under `app/`, the entry's folder) |
| Rust tests | beside the code in each crate (`#[cfg(test)]` modules, `store/src/tests.rs`, `store/src/*_tests.rs`, `src/connect/tests.rs`), and `mcp/tests/` for the server |

## Docs

`docs/architecture.md` is the map; each topic has one page (`docs/storage.md`, `docs/locks.md`, `docs/todos.md`,
`docs/mcp.md`, `docs/app.md`), and `docs/product.md` defines the product. A change in behavior updates the page of its
topic in the same change.
