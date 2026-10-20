# Glassmark user guide

## Capture and organization

Use the extension on an HTTP or HTTPS page. Normal pages offer whole-page and multi-region capture. Post detail pages offer structured capture for X, Reddit, Xiaohongshu and Zhihu. Pick a webpage folder or the platform's tags before saving.

X automatically loads replies within the configured time and post limits. You can save loaded content immediately or cancel from the source-page control. Reddit and Xiaohongshu capture comments already loaded in the page; expand the comments you want before saving. Zhihu opens the selected answer's comments automatically and waits on the source page before starting capture.

Webpages live in nested folders. Social sources have independent tag collections and search. Use the tabs above each collection to switch between all saves and a platform tag; the plus button creates a tag. Long tab lists scroll horizontally, and arrow keys, Home and End switch tabs. Detail pages show a compact back action and preserve the selected tag and sort when returning. Global search covers all sources, including sources hidden from the sidebar. Repeated captures create independent saves. Delete a save from its toolbar or detail menu.

## Media and reports

Settings controls image, avatar and video capture, concurrent downloads, the shared MB budget, resource count and timeouts. The extension reads these preferences when each job starts. All workers share the same budget; exceeding it prompts for a decision.

Direct MP4/WebM and unencrypted, finite HLS video are supported. HLS includes one quality rendition and its associated audio and segments. Unsupported DASH, live, DRM and inaccessible resources appear in the save report. A resource failure does not stop other downloads.

X media and exact reply-parent IDs are supplemented from data exposed by the rendered page during capture. Xiaohongshu reads the URL-selected note's media list and walks available virtual gallery controls, restoring the starting slide. Lazy image attributes take priority over placeholders. Video posters belong to their video and do not count as separate images. Alternate renditions and unresolved DOM players merge into the matching attachment. Each distinct video keeps its own source; capture does not reduce a gallery to its first attachment. Hidden, restricted or unavailable content remains outside the capture boundary.

Comment attachments on all four platforms are compact thumbnails. Click to open the saved image or video, use Left/Right or viewer arrows to switch, and Escape to close. Root posts and comments show saved video posters with a play indicator. Clicking a video opens the viewer and starts playback, with native playback controls available there. Comment buttons expand or scroll to saved replies without navigating away. X lines connect known parents, and Reddit supports nested thread folding. Parents are not inferred from visual position alone. Missing files or reply IDs in an existing archive require a new capture.

## Language

Open **Settings → General → Language**. Choose English, Simplified Chinese, Japanese, or Follow system, then save. The app reloads in the chosen language; the extension uses it on its next open or capture. A disconnected extension remembers its last language.

UI labels, dialogs, capture progress and known error messages are localized. Dates follow the interface locale. English count labels use singular/plural forms. Archived content, folder names and custom tags are never translated.

## Storage and sync

Content is stored in the app's data directory under `content-v2/`. Webpages retain one reading file plus assets. Social captures store structured posts, comments and media references. Settings and paired browser credentials are stored locally.

Choose a local folder, or configure an HTTP/HTTPS WebDAV directory, username and app password in **Settings → Sync**. The selected method takes effect when saved; no separate enable switch is needed. Local-folder mode has only a path: changes are copied automatically and incoming files are checked every five seconds. WebDAV has its own automatic interval, Sync now button and conflict controls inside its configuration card. The local path field shows the actual default archive location; leaving it blank uses that location. Content remains local in WebDAV mode too. If a custom local folder is set, it is mirrored before WebDAV sync. Sync now starts a background task; the bottom-left sync icon rotates while active. The sidebar and settings show the current connection, upload, download or indexing stage and file. The last successful sync time includes seconds and survives restarts. Failures show the reason and keep the previous successful time. On failure, the status reads Not synced and WebDAV stays selected. The service uses only the `glassmark/` subdirectory in the chosen destination:

```text
glassmark/
  events/<revision>.json
  archives/<id>/
    manifest.json
    content.html
    assets/<sha256>.<extension>
```

`content.html` exists only for webpage archives; social archives use structured posts in the manifest. The sync destination has no extra `content-v2/` directory. The internal application data directory is separate.

Content, folders, tags and deletions sync. UI preferences remain local. Remote content is stored as ordinary files without end-to-end encryption, so choose a server you trust. Do not commit your application data or credentials to a repository.

## Distribution

GitHub Releases includes a universal macOS DMG, Windows x64 EXE/MSI, Linux x64 AppImage/DEB/RPM/Arch packages, Chromium and Firefox extension ZIPs and checksums. Browser test reports are available in CI artifacts. The macOS app is ad-hoc signed. Windows installers and Firefox ZIPs are not store-signed. Firefox temporary add-ons must be reloaded after a browser restart.

## Getting help

Include your app version, operating system, browser and the relevant resource report in an [issue](https://github.com/kevinhuang001/bookmark-web/issues). Remove private URLs and account details before sharing.

## Zhihu and keyboard navigation

On a Zhihu question or answer page, click “Select an answer and save comments” in the extension, click the answer you want, then confirm “Save answer and comments”. The picker highlights one whole answer at a time; Escape cancels. The opening timeout is at least 60 seconds (or the configured automatic loading time if longer). After comment bodies appear, Glassmark stays on the source for at least 3 seconds and waits until bodies, media, loading indicators and expansion controls have stayed stable for 1.5 seconds. A timeout or cancellation during this wait does not open the save page. Glassmark opens that answer’s comments and follows available reply expansion, pagination and comment-panel scrolling within the configured loading time. The shared reply-count limit also applies to Zhihu. Hidden cached comments are excluded, and a failure to open or load the selected answer’s comments is reported as an incomplete capture. The saved URL points to the selected answer, even when you started on a question page. Other answers and unrelated comment dialogs are excluded. Hidden, restricted or still-unloaded comments may be missing; see the capture report. `zhuanlan.zhihu.com/p/…` articles continue to save directly. The Zhihu collection supports search, tags and sorting, with a full-text reader for saved content. Existing sidebar preferences are preserved; enable Zhihu in Settings → General if it is hidden.

Press ⌘/Ctrl + K for global search. Press Escape outside a text input or dialog to return from a discussion to its collection. Filtered empty states offer a reset, and the interface respects reduced-motion preferences.

## Webpage zoom

Use the reading toolbar to zoom a saved webpage from 50% to 200%. The scale is remembered separately for each page on this device. ⌘/Ctrl + plus or minus changes scale; ⌘/Ctrl + 0 resets it to 100%, including when focus is inside the page. Saved files and application controls retain their original scale.

## WebDAV conflicts

A settings badge and connection status indicate unresolved conflicts. In Settings → Sync → WebDAV → Sync conflicts, compare preserved versions and select one. For tag-only differences, “Merge all tags” combines both tag sets. A delete concurrent with an edit keeps the live record visible until you explicitly choose the deletion. If another change arrives while you are choosing, refresh and choose again. All clients should be updated to the same version to manage causal revisions consistently.

X saves require an individual status URL. Each capture has exactly one main post; the shared comment/reply count setting limits replies. Feed captures are blocked even if a whole-page capture is requested. Marked ads, posts before the selected root and recommendation sections are excluded. Source URLs and video players stay scoped to their own media tile.

## Support

About → Support displays the developer’s EVM address with a Copy address button. Ethereum, Base, Arbitrum One and OP Mainnet links open that address in each network’s explorer. Choose the corresponding network in your wallet.
