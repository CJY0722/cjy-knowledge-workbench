const assert = require('node:assert/strict');
const { extractTasks, makeNote, noteTitle } = require('./miniprogram/utils/markdown');

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
console.log('微信小程序 Markdown 检查通过');
