import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  commitClosure, createBridge, createPublishPack, generateDraft, listDrafts, prepareCsdnPayload,
  previewClosure, reviewCsdnDraft, sanitizeFileName, saveDraft, searchNotes, writingPreflight,
} from './bridge.mjs';

test('protects a personal vault behind origin checks and pairing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-workbench-bridge-'));
  await mkdir(path.join(root, '.obsidian'));
  const { server } = createBridge({ root, port: 0, allowedOrigins: ['https://example.github.io'] });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const blocked = await fetch(`${url}/health`, { headers: { Origin: 'https://evil.example', 'X-Workbench-Token': 'not-authorized' } });
    assert.equal(blocked.status, 403);

    const unpaired = await fetch(`${url}/health`, { headers: { Origin: 'https://example.github.io' } });
    assert.equal(unpaired.status, 401);

    const preflight = await fetch(`${url}/health`, { method: 'OPTIONS', headers: { Origin: 'https://example.github.io', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

    const returnTarget = 'https://example.github.io/workbench/#blog';
    const pairing = await fetch(`${url}/pair?origin=${encodeURIComponent('https://example.github.io')}&return=${encodeURIComponent(returnTarget)}`);
    assert.equal(pairing.status, 200);
    const pairingHtml = await pairing.text();
    assert.match(pairingHtml, /允许连接/);
    const nonce = pairingHtml.match(/name="nonce" value="([^"]+)"/)?.[1];
    assert.ok(nonce);

    const approval = await fetch(`${url}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ origin: 'https://example.github.io', nonce }),
      redirect: 'manual',
    });
    assert.equal(approval.status, 303);
    const approvalUrl = new URL(approval.headers.get('location'));
    assert.equal(approvalUrl.origin, 'https://example.github.io');
    assert.equal(approvalUrl.pathname, '/workbench/');
    const approvalParams = new URLSearchParams(approvalUrl.hash.replace(/^#/, ''));
    assert.equal(approvalParams.get('tab'), 'blog');
    const pairedToken = approvalParams.get('bridge_token');
    assert.ok(pairedToken);

    const healthResponse = await fetch(`${url}/health`, { headers: { Origin: 'https://example.github.io', 'X-Workbench-Token': pairedToken } });
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.vault_name, path.basename(root));
    assert.equal(health.vault_exists, true);
    assert.equal(health.obsidian_configured, true);
    assert.equal('vault' in health, false);

    const forbiddenPairing = await fetch(`${url}/pair?origin=${encodeURIComponent('https://evil.example')}`);
    assert.equal(forbiddenPairing.status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('sanitizes draft names', () => {
  assert.equal(sanitizeFileName('Java: 入门/实践?'), 'Java- 入门-实践-');
});

test('prepares Obsidian markdown for the official CSDN editor', () => {
  const result = prepareCsdnPayload({
    title: '测试文章',
    content: '---\ntags: [CSDN]\n---\n\n正文来自 [[30-领域/测试|测试笔记]]。\n\n![[截图.png]]\n\nTODO：补充结果。'
  });
  assert.doesNotMatch(result.content, /^---/);
  assert.match(result.content, /^# 测试文章/);
  assert.match(result.content, /正文来自 测试笔记/);
  assert.match(result.content, /请在 CSDN 重新上传 Obsidian 附件：截图.png/);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.editorUrl, 'https://editor.csdn.net/md/');
});

test('searches a source, generates a safe template, and versions saves', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-workbench-'));
  const sourceDir = path.join(root, '01-Knowledge');
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, 'Python测试.md'), '# Python 测试\n\npytest 通过断言验证行为。', 'utf8');
  const matches = await searchNotes('Python 测试', 5, root);
  assert.equal(matches[0].path, '01-Knowledge/Python测试.md');
  const draft = await generateDraft({ sourcePath: matches[0].path, instruction: '面向学生', useAi: false, preflightConfirmed: true }, root);
  assert.match(draft.content, /ai_generated: false/);
  assert.match(draft.content, /\[\[01-Knowledge\/Python测试\]\]/);
  const approved = { approved: true, preflightConfirmed: true, focusDecision: 'confirmed', reviewConfirmed: true };
  const validContent = `${draft.content.replaceAll('待补充', '已核对')}\n\n## 验证\n\n验证内容已核对。`;
  const first = await saveDraft({ title: draft.title, content: validContent, sourcePath: matches[0].path, ...approved }, root);
  await assert.rejects(() => saveDraft({ title: draft.title, content: `${validContent}\n更新`, sourcePath: matches[0].path, ...approved }, root), error => error.code === 'confirm_overwrite');
  const second = await saveDraft({ title: draft.title, content: `${validContent}\n更新`, sourcePath: matches[0].path, expectedUpdated: first.updated, overwriteConfirmed: true, ...approved }, root);
  assert.equal(second.versionArchived, true);
  assert.match(await readFile(path.join(root, second.path), 'utf8'), /更新/);
  assert.equal((await listDrafts(root)).length, 1);
});

test('reviews diagrams and creates bounded publish copy', () => {
  const review = reviewCsdnDraft({ title: '图示测试', content: `# 图示测试\n\n## 结构\n\n\`\`\`plaintext\n${'-'.repeat(61)}\n┌--┐\n\`\`\`\n\n## 结论\n\nTODO` });
  assert.equal(review.diagramLines.length, 1);
  assert.equal(review.blockers.length, 3);
  const pack = createPublishPack({ title: '一个很长的文章标题用于测试长度限制', content: '# 一个很长的文章标题用于测试长度限制\n\n> 写作要求：面向学生。\n\n' + '正文内容'.repeat(100) });
  assert.ok(pack.csdnIntro.length <= 256);
  assert.doesNotMatch(pack.csdnIntro, /写作要求/);
  assert.ok(pack.xiaohongshuTitle.length <= 20);
  assert.ok(pack.xiaohongshuIntro.length <= 100);
});

test('records preflight misses and writes approved closure with deduplication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-workbench-closure-'));
  const styleDir = path.join(root, '30-领域', '写作系统');
  await mkdir(styleDir, { recursive: true });
  await writeFile(path.join(styleDir, '元知识 - 文风.md'), '---\ntags: [写作系统]\ncreated: 2026-09-12\n---\n\n# 元知识 - 文风\n', 'utf8');
  const blogDir = path.join(root, '06-Content', 'CSDN');
  const resourceDir = path.join(root, '40-资源');
  await mkdir(blogDir, { recursive: true });
  await mkdir(resourceDir, { recursive: true });
  await writeFile(path.join(blogDir, '旧文.md'), '# 旧文\n\n这是一篇测试主题的既有博客，用于学习表达风格。', 'utf8');
  await writeFile(path.join(resourceDir, '博客索引.md'), '# 博客索引\n\n- [[06-Content/CSDN/旧文]]', 'utf8');
  const preflight = await writingPreflight({ topic: '测试' }, root);
  assert.equal(preflight.retrieval.length, 5);
  assert.equal(preflight.retrieval.find(item => item.category === '元知识 - 文风').matches.length, 1);
  assert.equal(preflight.retrieval.find(item => item.category === '博客索引').matches.some(item => item.path === '06-Content/CSDN/旧文.md'), true);
  const data = { title: '闭环测试', draftPath: '06-Content/CSDN/闭环测试.md', style: '短句优先', approved: true };
  const preview = await previewClosure(data, root);
  assert.equal(preview.entries.some(item => item.duplicate), false);
  const first = await commitClosure(data, root);
  assert.equal(first.written, 2);
  assert.equal(first.eventLogged, true);
  const second = await commitClosure(data, root);
  assert.equal(second.written, 0);
  assert.equal(second.skipped, 2);
  assert.equal(second.eventLogged, false);
});

test('writes long articles in complete sequential sections', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-workbench-long-'));
  const content = `# 长文\n\n## 第一节\n\n${'内容'.repeat(3100)}\n\n## 第二节\n\n完成。`;
  const saved = await saveDraft({ title: '长文', content, approved: true, preflightConfirmed: true, focusDecision: 'skipped', reviewConfirmed: true }, root);
  assert.equal(saved.longArticle, true);
  assert.equal(saved.sectionsWritten, 3);
  assert.match(await readFile(path.join(root, saved.path), 'utf8'), /## 第二节/);
});

test('enforces preflight, focus, review, and visual save gates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-workbench-gates-'));
  const content = '# 门禁测试\n\n## 结论\n\n已核对。\n\n## 步骤\n\n已完成。';
  await assert.rejects(() => saveDraft({ title: '门禁测试', content, approved: true }, root), error => error.code === 'preflight_required');
  await assert.rejects(() => saveDraft({ title: '门禁测试', content, approved: true, preflightConfirmed: true, focusDecision: 'confirmed' }, root), error => error.code === 'review_required');
  await assert.rejects(() => saveDraft({ title: '门禁测试', content, approved: true, preflightConfirmed: true, focusDecision: 'confirmed', reviewConfirmed: true, materialKind: 'visual' }, root), error => error.code === 'visual_verification_required');
});

test('rolls oversized knowledge files into bounded parts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-workbench-rollover-'));
  const directory = path.join(root, '30-领域', '写作系统');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, '元知识 - 偏好.md'), Array.from({ length: 201 }, (_, index) => `- 旧偏好 ${index}`).join('\n'), 'utf8');
  const result = await commitClosure({ title: '分篇测试', preference: '新的明确偏好', approved: true }, root);
  assert.equal(result.written, 1);
  const names = await readdir(directory);
  assert.equal(names.some(name => /^元知识 - 偏好 - \d{4}-\d{2}\.md$/.test(name)), true);
});
