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

Set `GLASSMARK_BRIDGE_BIN=core/target/debug/glassmark-bridge` to run browser integration tests against the production service. CI also validates an installed Chromium extension, the Firefox capture engine, and all three desktop builds.

Keep capture logic, library UI and storage changes in their respective modules. Use the shared localization layer for user-facing strings, and preserve archived text and user-defined names. See [localization](docs/I18N.md) and [architecture](docs/ARCHITECTURE.md).

Run `npm run screenshots` to regenerate the product screenshots with sample content. Screenshots use a headless browser; `GLASSMARK_PORTABLE_CHROMIUM=1` enables the bundled portable Chromium in environments without an installed Playwright browser.
