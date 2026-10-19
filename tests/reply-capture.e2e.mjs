import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { launchBrowser } from '../scripts/browser.mjs';
import { staticServer } from '../scripts/dev.mjs';
const server = await staticServer(null);
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:1420/fixtures/xiaohongshu.html');
  const bundle = await build({entryPoints:['extension/src/capture/adapters.js'], bundle:true, write:false, format:'iife', globalName:'ReplyAdapters'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const captured = await page.evaluate(() => {
    document.body.innerHTML = `<div class="parent-comment">
      <div class="comment-item" data-comment-id="p"><div class="author"><span class="name">甲</span></div><div class="content">父评论</div></div>
      <div class="comment-item" data-comment-id="c"><div class="author"><span class="name">乙</span></div><div class="content">回复 <span class="reply-user">甲</span>： 子回复</div><span class="date">6天前 江苏</span></div>
      <div class="comment-item" data-comment-id="g"><div class="author"><span class="name">甲</span></div><div class="content">回复 <span class="reply-user">乙</span>： 再次回复</div></div></div>`;
    return [...document.querySelectorAll('.comment-item')].map(el=>ReplyAdapters.extractPost(el,'xiaohongshu'));
  });
  assert.equal(captured[1].replyToName, '甲');
  assert.equal(captured[1].threadRootId, 'p');
  assert.equal(captured[1].text, '子回复');
  assert.equal(captured[1].postedAtText, '6天前 江苏');
  assert.equal(captured[2].replyToName, '乙');
  assert.equal(captured[0].text, '父评论');
  const zhihu = await page.evaluate(() => {
    document.body.innerHTML = `<div class="NestComment"><div class="CommentItem" data-comment-id="p"><div class="CommentItem-meta"><a class="UserLink-link">甲</a></div><div class="CommentItem-content">父评论</div></div><div class="CommentItem" data-comment-id="c"><div class="CommentItem-meta"><a class="UserLink-link">乙</a> 回复 <a class="UserLink-link">甲</a></div><div class="CommentItem-content">子回复</div></div></div>`;
    return ReplyAdapters.extractPost(document.querySelector('[data-comment-id="c"]'),'zhihu');
  });
  assert.equal(zhihu.authorName, '乙');
  assert.equal(zhihu.replyToName, '甲');
  assert.equal(zhihu.threadRootId, 'p');
  const reddit = await page.evaluate(() => {
    document.body.innerHTML = `<shreddit-comment thingid="t1_p" author="A"><div slot="text-body">Parent</div><shreddit-comment thingid="t1_c" author="B"><div slot="text-body">Child</div></shreddit-comment></shreddit-comment>`;
    return ReplyAdapters.extractPost(document.querySelector('[thingid="t1_c"]'),'reddit');
  });
  assert.equal(reddit.id, 'c');
  assert.equal(reddit.parentId, 'p');
  const x = await page.evaluate(() => {
    document.body.innerHTML = `<article data-testid="tweet" data-parent-id="111"><div data-testid="User-Name"><a>B</a> @b</div><a href="https://x.com/b/status/222"><time datetime="2026-10-19"></time></a><div data-testid="tweetText">Replying to @unrelated is part of the quoted text</div></article>`;
    const el = document.querySelector('article');
    const noTarget = ReplyAdapters.extractPost(el,'x');
    el.insertAdjacentHTML('beforeend','<div><span>Replying to @a</span></div>');
    return [noTarget, ReplyAdapters.extractPost(el,'x')];
  });
  assert.equal(x[0].replyToHandle, '');
  assert.equal(x[1].replyToHandle, '@a');
  assert.equal(x[1].parentId, '111');
  console.log('PASS all four adapters retain actual reply relationships without body mentions becoming parents');
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
