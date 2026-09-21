const assert = require('node:assert/strict');
const { auditDraft, extractTasks, knowledgeStats, makeNote, noteTitle, preparePlatform } = require('./miniprogram/utils/markdown');

const source = `---\ntitle: "测试知识"\n---\n# 备用标题\n\n- [ ] 整理工作台 📅 2026-09-21\n- [x] 完成导入\n`;
assert.equal(noteTitle('fallback.md', source), '测试知识');
assert.deepEqual(extractTasks(source), [
  { line: 6, done: false, text: '整理工作台', due: '2026-09-21' },
  { line: 7, done: true, text: '完成导入', due: '' },
]);
const note = makeNote('fallback.md', source, 'fixed');
assert.equal(note.id, 'fixed');
assert.equal(note.title, '测试知识');
assert.ok(note.characters > 0);
const linked = makeNote('关联.md', '# 关联\n\n正文', 'linked');
const graph = knowledgeStats([note, linked, makeNote('引用.md', '# 引用\n\n[[关联]]\n[[不存在]]', 'source')]);
assert.equal(graph.edges.length, 1);
assert.deepEqual(graph.brokenLinks, [{ source: '引用', target: '不存在' }]);
const xhs = preparePlatform('xiaohongshu', '这是一个明确超过二十个中文字符的小红书标题示例用于测试', `${source}\n==重点==`);
assert.equal(Array.from(xhs.title).length, 20);
assert.ok(xhs.cardPages.length <= 18);
assert.equal(auditDraft('标题', '# 正文\n\nTODO').ready, false);
console.log('微信小程序 Markdown 检查通过');
