export function ownsXContent(el, node) {
  if (
    node.closest('article[data-testid="tweet"]') !== el ||
    node.closest('[data-testid="quoteTweet"]')
  )
    return false;
  const quote = node.closest('div[role="link"][tabindex]');
  return (
    !quote ||
    !el.contains(quote) ||
    !quote.querySelector('[data-testid="User-Name"],[data-testid="tweetText"]')
  );
}

/** Only a post's own permalink establishes identity; quoted statuses do not. */
export function xPostIdentity(el, doc = document) {
  const links = [...el.querySelectorAll('a[href*="/status/"]')].filter(
    (link) => {
      if (
        link.closest('article[data-testid="tweet"]') !== el ||
        link.closest('[data-testid="quoteTweet"]')
      )
        return false;
      const quote = link.parentElement?.closest('div[role="link"][tabindex]');
      return !quote || !el.contains(quote);
    },
  );
  const link =
    links.find((candidate) => candidate.querySelector("time")) ||
    links.find((candidate) => {
      try {
        return /^\/(?:i\/web|[^/]+)\/status\/\d+\/?$/.test(
          new URL(candidate.href, doc.URL).pathname,
        );
      } catch {
        return false;
      }
    });
  if (!link) return null;
  try {
    const url = new URL(link.getAttribute("href"), doc.URL);
    if (!/(^|\.)(?:x\.com|twitter\.com)$/.test(url.hostname)) return null;
    const id = url.pathname.match(
      /^\/(?:i\/web|[^/]+)\/status\/(\d+)(?:\/|$)/,
    )?.[1];
    return id
      ? {
          id,
          url:
            url.origin +
            url.pathname.replace(/\/(?:photo|video|analytics)\/?.*$/, ""),
        }
      : null;
  } catch {
    return null;
  }
}

export function noteIdentity(el, doc = document) {
  const explicit =
    el.getAttribute("data-note-id") || el.getAttribute("data-id");
  if (explicit) return String(explicit);
  const link = el.querySelector(
    'a[data-note-id],a.note-detail-link[href],meta[itemprop="url"]',
  );
  const value = link?.getAttribute("href") || link?.getAttribute("content");
  try {
    return value
      ? new URL(value, doc.URL).pathname.match(
          /\/(?:explore|discovery\/item)\/([a-z\d]+)(?:\/|$)/i,
        )?.[1] || null
      : null;
  } catch {
    return null;
  }
}
