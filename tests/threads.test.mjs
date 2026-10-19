import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentThreads } from '../app/threads.js';
const root = { id: 'root', authorName: 'OP' };
const summary = (posts) => commentThreads([root, ...posts]).map((group) => group.map(({post, depth}) => [post.id, depth]));
test('threads reorder out-of-order children and preserve separate root conversations', () => {
  assert.deepEqual(summary([
    { id:'child', parentId:'parent' }, { id:'other', parentId:'root' },
    { id:'parent', parentId:'root' }, { id:'grandchild', parentId:'child' },
  ]), [[['other',0]],[['parent',0],['child',1],['grandchild',2]]]);
});
test('explicit target groups flat replies only when the author is unique', () => {
  assert.deepEqual(summary([{ id:'a', authorName:'A' },{ id:'b', replyToName:'A' }]), [[['a',0],['b',1]]]);
  assert.equal(summary([{ id:'a', authorName:'A' },{ id:'b', authorName:'A' },{ id:'c', replyToName:'A' }]).length, 3);
});
test('DOM conversation groups keep sibling replies under the root without inventing targets', () => {
  assert.deepEqual(summary([{ id:'a' },{ id:'b', threadRootId:'a' },{ id:'c', threadRootId:'a' }]), [[['a',0],['b',1],['c',1]]]);
});
test('missing parents, self-references and cycles never hide or duplicate saved comments', () => {
  const posts=[{id:'a',parentId:'b'},{id:'b',parentId:'a'},{id:'self',parentId:'self'},{id:'orphan',parentId:'missing'}];
  const ids=summary(posts).flat().map(([id])=>id);
  assert.equal(ids.length,4);
  assert.equal(new Set(ids).size,4);
});
