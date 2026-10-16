# Glassmark user guide

## Capture and organization

Use the extension on an HTTP or HTTPS page. Normal pages offer whole-page and multi-region capture. Post detail pages offer structured capture for X, Reddit, Xiaohongshu and Zhihu. Pick a webpage folder or the platform's tags before saving.

X automatically loads replies within the configured time and post limits. You can save loaded content immediately or cancel from the source-page control. Reddit, Xiaohongshu and Zhihu capture comments already loaded in the page; expand the comments you want before saving.

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

## Zhihu and keyboard navigation

Open an individual `/question/…/answer/…` answer or a `zhuanlan.zhihu.com/p/…` article. Expand the comments you want before saving. Recommendations and other answers are excluded. The Zhihu collection supports search, tags and sorting, with a full-text reader for saved content. Existing sidebar preferences are preserved; enable Zhihu in Settings → General if it is hidden.

Press ⌘/Ctrl + K for global search. Press Escape outside a text input or dialog to return from a discussion to its collection. Filtered empty states offer a reset, and the interface respects reduced-motion preferences.

## Webpage zoom

Use the reading toolbar to zoom a saved webpage from 50% to 200%. The scale is remembered separately for each page on this device. ⌘/Ctrl + plus or minus changes scale; ⌘/Ctrl + 0 resets it to 100%, including when focus is inside the page. Saved files and application controls retain their original scale.

## WebDAV conflicts

A settings badge and connection status indicate unresolved conflicts. In Settings → WebDAV, compare preserved versions and select one. For tag-only differences, “Merge all tags” combines both tag sets. A delete concurrent with an edit keeps the live record visible until you explicitly choose the deletion. If another change arrives while you are choosing, refresh and choose again. All clients should be updated to the same version to manage causal revisions consistently.

X saves require an individual status URL. Each capture has exactly one main post; the X count setting limits replies. Feed captures are blocked even if a whole-page capture is requested. Marked ads, posts before the selected root and recommendation sections are excluded. Source URLs and video players stay scoped to their own media tile.
