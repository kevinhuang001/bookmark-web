# Glassmark user guide

## Capture and organization

Use the extension on an HTTP or HTTPS page. Normal pages offer whole-page and multi-region capture. Post detail pages offer structured capture for X, Reddit and Xiaohongshu. Pick a webpage folder or the platform's tags before saving.

X automatically loads replies within the configured time and post limits. You can save loaded content immediately or cancel from the source-page control. Reddit and Xiaohongshu capture comments already loaded in the page; expand the comments you want before saving.

Webpages live in nested folders. Social sources have independent tag collections and search. Global search covers all sources, including sources hidden from the sidebar. Repeated captures create independent saves. Delete a save from its toolbar or detail menu.

## Media and reports

Settings controls image, avatar and video capture, concurrent downloads, the shared MB budget, resource count and timeouts. The extension reads these preferences when each job starts. All workers share the same budget; exceeding it prompts for a decision.

Direct MP4/WebM and unencrypted, finite HLS video are supported. HLS includes one quality rendition and its associated audio and segments. Unsupported DASH, live, DRM and inaccessible resources appear in the save report. A resource failure does not stop other downloads.

## Language

Open **Settings → General → Language**. Choose English, Simplified Chinese, Japanese, or Follow system, then save. The app reloads in the chosen language; the extension uses it on its next open or capture. A disconnected extension remembers its last language.

UI labels, dialogs, capture progress and known error messages are localized. Dates follow the interface locale. English count labels use singular/plural forms. Archived content, folder names and custom tags are never translated.

## Storage and WebDAV

Content is stored in the app's data directory under `content-v2/`. Webpages retain one reading file plus assets. Social captures store structured posts, comments and media references. Settings and paired browser credentials are stored locally.

Configure an HTTPS directory, username and app password in **Settings → WebDAV**. Sync runs on startup, after changes and every minute. The service uses only the `glassmark/content-v2/` subdirectory on your server:

```text
glassmark/content-v2/
  events/<revision>.json
  archives/<id>/
    manifest.json
    content.html
    assets/<sha256>.<extension>
```

Content, folders, tags and deletions sync. UI preferences remain local. Remote content is stored as ordinary files without end-to-end encryption, so choose a server you trust. Do not commit your application data or credentials to a repository.

## Distribution

GitHub Releases includes a universal macOS DMG, Windows x64 EXE/MSI, Linux x64 AppImage/DEB, Chromium and Firefox extension ZIPs, test reports and checksums. The macOS app is ad-hoc signed. Windows installers and Firefox ZIPs are not store-signed. Firefox temporary add-ons must be reloaded after a browser restart.

## Getting help

Include your app version, operating system, browser and the relevant resource report in an [issue](https://github.com/kevinhuang001/bookmark-web/issues). Remove private URLs and account details before sharing.
