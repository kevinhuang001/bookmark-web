<p align="center"><img src="assets/app-icon.svg" width="88" alt="Glassmark"></p>
<h1 align="center">Glassmark</h1>
<p align="center"><strong>A home for the web you want to keep.</strong></p>
<p align="center">Save webpages, conversations and ideas. Read them in a calm, familiar space.<br>Keep the content and its media on your own computer.</p>
<p align="center"><a href="https://github.com/kevinhuang001/bookmark-web/releases/latest">Download Glassmark</a> · <a href="#get-started">Get started</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a></p>
<p align="center"><a href="https://github.com/kevinhuang001/bookmark-web/actions/workflows/ci.yml"><img src="https://github.com/kevinhuang001/bookmark-web/actions/workflows/ci.yml/badge.svg" alt="CI"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a></p>

![Read a saved webpage in Glassmark](docs/images/webpages.jpg)

## More than a link

An article you want to return to. A thread that explains something well. A note that sparks an idea. Glassmark keeps the content, images and supported videos together, so the things you save remain useful when you come back.

- **Read without the surrounding noise.** Saved webpages fill the reading pane, with their layout and typography preserved.
- **Keep the conversation.** Save X threads, Reddit discussions and Xiaohongshu notes with their loaded replies, comments and media.
- **Make it yours.** Organize pages into nested folders, add tags, search across your library, and choose which sources appear in the sidebar.
- **Own your library.** Store content locally and optionally sync it between devices with your own WebDAV server. No Glassmark account is required.
- **Feel at home.** A softly frosted desktop interface for macOS, Windows and Linux, with English, 简体中文 and 日本語 UI.

## A familiar place for every save

### Webpages, with room to read

Keep whole pages or select several regions from a page. Read the saved content in a dedicated pane; its title, source and resource details stay within reach.

### X, focused on bookmarks

A familiar timeline for your saved posts and threads. Open a conversation, filter by author, or search just your X collection.

![X bookmarks and saved threads](docs/images/x.jpg)

### Reddit, focused on saved discussions

Browse your saved posts by community, sort the collection, and read archived comments in their original hierarchy.

![Reddit saved discussions and community filters](docs/images/reddit.jpg)

### Xiaohongshu, focused on the notes you love

Browse a cover-first collection. Open a note to view its images and videos on the left, with the text and saved comments on the right.

![Xiaohongshu saved notes](docs/images/xiaohongshu.jpg)

![A saved note with its image gallery and comments](docs/images/note-reader.jpg)

### Your language, across the app and extension

Choose **Settings → General → Language**. Follow your system language or select English, Simplified Chinese or Japanese. The browser extension follows the desktop client's choice. Your saved content, folder names and custom tags stay in their original language.

![Language and source preferences](docs/images/languages.jpg)

*Screenshots show the application with sample content.*

## Get started

### 1. Download the desktop app

Choose your installer from the [latest release](https://github.com/kevinhuang001/bookmark-web/releases/latest).

| Platform | Download |
| --- | --- |
| macOS · Apple Silicon and Intel | Universal `.dmg` |
| Windows · x64 | `.exe` installer or `.msi` |
| Linux · x64 | `.AppImage` or `.deb` |

### 2. Add the browser extension

The same release includes **glassmark-chromium.zip** and **glassmark-firefox.zip**.

- **Chrome, Edge and other Chromium browsers:** unzip the package, open the browser's extension manager, enable Developer mode, then choose **Load unpacked** and select the extracted folder.
- **Firefox:** open `about:debugging` → **This Firefox** → **Load Temporary Add-on**, then select the extension's `manifest.json` or ZIP. Temporary add-ons must be loaded again after restarting Firefox.

### 3. Connect and save

1. Open Glassmark, then **Settings → Browser connection**.
2. Copy the pairing code and paste it into the extension.
3. Open a webpage or a post's detail page and click the extension to save it.
4. Return to Glassmark to read, search and organize your collection.

Keep the desktop client running while saving. Pairing codes are valid for five minutes.

## Built around your library

**Local media.** Images, avatars, GIFs and supported videos are stored alongside your saves. Download limits, concurrency and timeouts are configurable in Settings.

**Your sync server.** Add an HTTPS WebDAV directory in **Settings → WebDAV** to sync saved content, folders, tags and deletions. Files are stored under `glassmark/content-v2/` on your server. See the [user guide](docs/USER-GUIDE.md) for storage and sync details.

**Clear capture boundaries.** X can load replies within configurable time and post limits. Reddit and Xiaohongshu save the comments already loaded on the page. Direct MP4/WebM and unencrypted, finite HLS video are supported; live streams, DRM and unavailable media cannot be preserved. Each capture includes a resource report.

## Open source

Glassmark is built with Tauri and a Rust local service. The code is available under the [MIT license](LICENSE).

[User guide](docs/USER-GUIDE.md) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) · [Localization](docs/I18N.md) · [Report an issue](https://github.com/kevinhuang001/bookmark-web/issues)

Desktop installers and extension ZIPs are distributed through GitHub Releases. The macOS app is ad-hoc signed; Windows packages and Firefox add-ons are not store-signed. Glassmark is an independent project and is not affiliated with the platforms it supports.
