/** Supported rendered websites and their capture selectors. */
export function platform(host) {
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return "x";
  if (/(^|\.)reddit\.com$/.test(host)) return "reddit";
  if (/(^|\.)xiaohongshu\.com$/.test(host)) return "xiaohongshu";
  if (/(^|\.)zhihu\.com$/.test(host)) return "zhihu";
  return "web";
}
export function adapterFor(kind, doc = document) {
  const configs = {
    x: {
      selector: 'article[data-testid="tweet"]',
      body: '[data-testid="tweetText"]',
      author: '[data-testid="User-Name"]',
      link: 'a[href*="/status/"]',
      title: "X · 讨论串",
    },
    reddit: {
      selector: "shreddit-post,shreddit-comment,.thing.link,.thing.comment",
      body: '[slot="text-body"],[data-test-id="comment"],.md',
      author: "[author],.author",
      link: 'a[href*="/comments/"]',
      title: "Reddit · 讨论",
    },
    xiaohongshu: {
      selector: ".note-detail-mask .note-container,.note-container",
      body: "#detail-desc,.note-text,.desc",
      author: ".author-container .username,.author .username",
      link: 'a[href*="/explore/"],a[href*="/discovery/item/"]',
      title: "小红书 · 笔记",
    },
    zhihu: {
      selector: ".AnswerItem,.Post-Main",
      body: ".RichContent-inner,.Post-RichTextContainer",
      title: "知乎",
    },
    web: {
      selector: "body",
      body: "body",
      author: "",
      link: "",
      title: doc.title,
    },
  };
  return configs[kind] || configs.web;
}
