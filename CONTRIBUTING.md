# Contributing to Glassmark

Use Node.js 22+, Rust stable and the system dependencies required by Tauri for your platform.

```sh
npm ci
npm run desktop
```

For frontend work without a native window:

```sh
npm run build
npm run dev -- --demo
```

The demo uses a development fixture service. The desktop app always uses the Rust service.

## Validate a change

```sh
npm run check
npm test
cargo test --locked --manifest-path core/Cargo.toml
cargo clippy --locked --manifest-path core/Cargo.toml --all-targets -- -D warnings
npm run build
npm run test:e2e
```

Build the bridge before using the production backend:

```sh
cargo build --locked --manifest-path core/Cargo.toml --bin glassmark-bridge
npx playwright install --with-deps chromium firefox
GLASSMARK_BRIDGE_BIN=core/target/debug/glassmark-bridge npm run test:e2e
```

Without `GLASSMARK_BRIDGE_BIN`, browser tests use the fixture service and do not validate native storage. CI also runs `tests/extension.e2e.mjs` with an installed Chromium extension, `tests/firefox.e2e.mjs`, and `tests/firefox-extension.e2e.mjs` with an installed Firefox add-on and native persistence. The Firefox add-on test requires geckodriver; CI pins and verifies its download. All three desktop installer builds must pass before release.

`npm run test:e2e` includes navigation, Zhihu loading, reply extraction, target identity, media interactions and virtual-gallery/page-metadata tests. Keep a multiple-attachment regression whenever media ownership or source selection changes.

During development, event format changes may require a fresh local data directory. Version 2 events require explicit causal parents; there is no legacy history conversion. Back up data before resetting the internal library. The destination's `glassmark/` folder is separate from the app's internal `content-v2/` folder.

Keep capture logic, library UI and storage changes in their respective modules. Use the shared localization layer for user-facing strings, and preserve archived text and user-defined names. See [localization](docs/I18N.md) and [architecture](docs/ARCHITECTURE.md).

Run `npm run screenshots` to regenerate the product screenshots with sample content. Screenshots use a headless browser; `GLASSMARK_PORTABLE_CHROMIUM=1` enables the bundled portable Chromium in environments without an installed Playwright browser.
