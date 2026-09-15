import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  commitClosure, createBridge, createPublishPack, deepseekCompletion, generateDraft, improveDraft, listDrafts, markdownToPlatformText,
  obsidianToStandardMarkdown, prepareCsdnPayload, preparePlatformPayload, previewClosure, publicationAudit, reviewCsdnDraft,
  sanitizeFileName, saveDraft, searchNotes, splitXiaohongshuCards, writingPreflight,
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
    });
    assert.equal(approval.status, 200);
    const approvalHtml = await approval.text();
    assert.match(approvalHtml, /连接成功/);
    const encodedApprovalUrl = approvalHtml.match(/window\.location\.replace\(("[^"]+")\)/)?.[1];
    assert.ok(encodedApprovalUrl);
    const approvalUrl = new URL(JSON.parse(encodedApprovalUrl));
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
    assert.equal(health.deepseek_configured, false);
    assert.equal('vault' in health, false);

    const actionHeaders = { Origin: 'https://example.github.io', 'X-Workbench-Token': pairedToken, 'Content-Type': 'application/json' };
    const configuredResponse = await fetch(`${url}/action`, { method: 'POST', headers: actionHeaders, body: JSON.stringify({ action: 'configure_deepseek', apiKey: 'sk-test-key-for-bridge-only' }) });
    const configured = await configuredResponse.json();
    assert.equal(configured.result.configured, true);
    assert.doesNotMatch(JSON.stringify(configured), /sk-test-key/);
    const configuredHealth = await fetch(`${url}/health`, { headers: actionHeaders }).then(response => response.json());
    assert.equal(configuredHealth.deepseek_configured, true);
    await fetch(`${url}/action`, { method: 'POST', headers: actionHeaders, body: JSON.stringify({ action: 'clear_deepseek' }) });
    const clearedHealth = await fetch(`${url}/health`, { headers: actionHeaders }).then(response => response.json());
    assert.equal(clearedHealth.deepseek_configured, false);

    const auditResponse = await fetch(`${url}/action`, { method: 'POST', headers: actionHeaders, body: JSON.stringify({ action: 'publication_audit', title: '就绪文章', content: '---\ntitle: 就绪文章\ndescription: 已核对\ntags: [测试]\ncover: https://example.com/cover.png\nstatus: ready\nreviewed: true\n---\n\n# 就绪文章\n\n## 正文\n\n已核对。\n\n## 结论\n\n完成。' }) });
    assert.equal(auditResponse.status, 200);
    assert.equal((await auditResponse.json()).result.platforms.length, 5);

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
  assert.match(result.content, /正文来自 \[测试笔记\]\(30-领域\/测试.md\)/);
  assert.match(result.content, /!\[截图\]\(截图.png\)/);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.editorUrl, 'https://editor.csdn.net/md/');

  const platforms = ['csdn', 'juejin', 'zhihu', 'wechat', 'xiaohongshu'].map(platform => preparePlatformPayload({
    platform,
    title: '多平台文章',
    content: '# 多平台文章\n\n正文来自 [[知识笔记]]。',
  }));
  assert.deepEqual(platforms.map(item => item.platform), ['csdn', 'juejin', 'zhihu', 'wechat', 'xiaohongshu']);
  assert.match(platforms.find(item => item.platform === 'csdn').content, /正文来自 \[知识笔记\]\(知识笔记.md\)/);
  assert.equal(platforms.filter(item => !['csdn', 'juejin'].includes(item.platform)).every(item => item.content.includes('正文来自 知识笔记')), true);
  assert.match(platforms.find(item => item.platform === 'wechat').warnings.join('；'), /富文本/);
  for (const marker of ['#', '*', '[', ']', '`']) assert.equal(platforms.find(item => item.platform === 'xiaohongshu').content.includes(marker), false);
  assert.ok(platforms.find(item => item.platform === 'xiaohongshu').cardPages.length > 0);
  assert.match(platforms.find(item => item.platform === 'xiaohongshu').conversions.join('；'), /纯文本.*图卡/);
  assert.equal(Array.from(preparePlatformPayload({ platform: 'xiaohongshu', title: '这是一个超过二十个字符的小红书文章标题需要自动截取', content: '# 正文\n\n内容' }).title).length, 20);
  assert.throws(() => preparePlatformPayload({ platform: 'unknown', title: '标题', content: '正文' }), error => error.code === 'invalid_platform');
});

test('converts Obsidian syntax and creates plain-text image pages', () => {
  const standard = obsidianToStandardMarkdown(`---\ntags: [test]\n---\n# 标题\n\n> [!NOTE] 核心\n> 这是提示\n\n[[30-领域/知识库|知识库]] 与 ==重点==。 %%内部备注%%\n\n![[附件/结构图.png|架构图]]\n\n\`\`\`dataview\nLIST FROM #项目\n\`\`\`\n\n段落 ^block-id`);
  assert.doesNotMatch(standard, /tags:|\[\[|==|%%|\^block-id|LIST FROM/);
  assert.match(standard, /> \*\*备注：核心\*\*/);
  assert.match(standard, /\[知识库\]\(30-领域\/知识库.md\)/);
  assert.match(standard, /!\[架构图\]\(附件\/结构图.png\)/);
  const plain = markdownToPlatformText(`${standard}\n\n- [x] 已完成\n1. 第一步\n\n[官网](https://example.com)\n\n\`\`\`typescript\nconst render = <T>(value: T) => [value];\n\`\`\``);
  const prose = plain.split('【代码】')[0];
  for (const marker of ['#', '*', '[', ']', '`']) assert.equal(prose.includes(marker), false);
  assert.match(plain, /• 已完成/);
  assert.match(plain, /1、第一步/);
  assert.match(plain, /官网（https:\/\/example.com）/);
  assert.match(plain, /const render = <T>\(value: T\) => \[value\];/);
  const pages = splitXiaohongshuCards('第一段内容很长，需要按照固定字符宽度自动换行。'.repeat(20), 4, 12);
  assert.ok(pages.length > 1);
  assert.ok(pages.every(page => page.split('\n').length <= 4));
});

test('builds a read-only content pipeline and publication audit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-workbench-publishing-'));
  const blogDir = path.join(root, '06-Content', 'CSDN');
  const noteDir = path.join(root, '30-领域');
  const assetDir = path.join(root, 'assets');
  await mkdir(blogDir, { recursive: true });
  await mkdir(noteDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(noteDir, '已存在.md'), '---\ntags: [公开]\ncreated: 2026-09-14\nstatus: published\n---\n\n# 已存在', 'utf8');
  await writeFile(path.join(noteDir, '私有冲突.md'), '---\nstatus: draft\ndg-publish: true\n---\n\n# 私有冲突', 'utf8');
  await writeFile(path.join(assetDir, '存在.png'), 'image', 'utf8');
  await writeFile(path.join(root, 'manual.pdf'), 'pdf', 'utf8');
  await writeFile(path.join(root, 'relative-only.png'), 'image', 'utf8');
  const article = `---
title: "发布检查"
description: >
  检查元数据、链接与附件
tags:
  - CSDN
  - 测试
cover: https://example.com/cover.png
status: review
reviewed: true
---

# 发布检查

## 链接

[[30-领域/已存在]]、[[30-领域/私有冲突]]、[[缺失笔记]]、[[manual.pdf]]、![[assets/存在.png]]、![[assets/缺失.png]]。

![相对图片](relative-only.png)

## 结论

TODO：发布前补全。`;
  const articlePath = path.join(blogDir, '发布检查.md');
  await writeFile(articlePath, article, 'utf8');
  const before = await readFile(articlePath, 'utf8');
  const beforeMtime = (await stat(articlePath)).mtimeMs;

  const drafts = await listDrafts(root);
  assert.equal(drafts[0].status, 'review');
  assert.equal(drafts[0].reviewed, true);
  assert.deepEqual(drafts[0].tags, ['CSDN', '测试']);
  assert.equal(typeof drafts[0].qualityScore, 'number');
  assert.ok(drafts[0].issueCount > 0);

  const audit = await publicationAudit({ path: '06-Content/CSDN/发布检查.md', title: '发布检查', content: article }, root);
  assert.equal(audit.ready, false);
  assert.equal(audit.metadata.status, 'review');
  assert.deepEqual(audit.links.broken, ['缺失笔记']);
  assert.deepEqual(audit.links.unpublished, ['30-领域/私有冲突']);
  assert.deepEqual(audit.assets.missing, ['assets/缺失.png', 'relative-only.png']);
  assert.equal(audit.platforms.length, 5);
  assert.match(audit.blockers.join('；'), /待补充或待确认|链接|附件/);
  assert.match(audit.fixableBlockers.join('；'), /待补充或待确认/);
  assert.doesNotMatch(audit.fixableBlockers.join('；'), /链接|附件|内容状态/);
  assert.equal(await readFile(articlePath, 'utf8'), before);
  assert.equal((await stat(articlePath)).mtimeMs, beforeMtime);

  const ready = await publicationAudit({ title: '可发布文章', content: '---\ntitle: 可发布文章\ndescription: 已核对\ntags:\n  - CSDN\ncover: https://example.com/cover.png\nstatus: ready\nreviewed: true\n---\n\n# 可发布文章\n\n## 正文\n\n内容已核对。\n\n## 结论\n\n完成。' }, root);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.fixableBlockers, []);
  await assert.rejects(() => publicationAudit({ path: '../越界.md', title: '越界', content: '# 越界' }, root), error => error.code === 'invalid_path');
});

test('saves a self-authored article with Obsidian metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-workbench-manual-'));
  const content = '# 我的原创文章\n\n## 观点\n\n这是原创内容。\n\n## 结论\n\n完成。';
  const result = await saveDraft({ title: '我的原创文章', content, approved: true, preflightConfirmed: true, focusDecision: 'confirmed', reviewConfirmed: true }, root);
  const saved = await readFile(path.join(root, result.path), 'utf8');
  assert.match(saved, /source: "用户原创"/);
  assert.match(saved, /source_type: original/);
  assert.match(saved, /ai_generated: false/);
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

test('fixes blockers and humanizes a draft without losing frontmatter', async () => {
  const original = `---\ntitle: "测试"\nsource: "[[来源]]"\n---\n\n# 测试\n\n## 开始\n\n首先，TODO`;
  const fixed = await improveDraft(
    { title: '测试', content: original, kind: 'fix', issues: ['正文结构少于两个二级章节', '正文仍包含待补充或待确认标记'] },
    'test-key',
    async (system, user) => {
      assert.match(system, /只修正列出的审核问题/);
      assert.match(user, /TODO/);
      return '# 测试\n\n## 背景\n\n原文资料有限。\n\n## 结论\n\n保留来源。';
    },
  );
  assert.match(fixed.content, /^---[\s\S]*source: "\[\[来源\]\]"/);
  assert.equal(fixed.review.blockers.length, 0);

  const humanized = await improveDraft(
    { title: '测试', content: fixed.content, kind: 'humanize' },
    'test-key',
    async (system) => {
      assert.match(system, /删除套话/);
      return '# 测试\n\n## 背景\n\n自然表达。\n\n## 结论\n\n明确收尾。';
    },
  );
  assert.match(humanized.content, /^---[\s\S]*source: "\[\[来源\]\]"/);
  assert.equal(humanized.review.blockers.length, 0);
});

test('turns DeepSeek authentication failures into a safe actionable error', async () => {
  await assert.rejects(
    () => deepseekCompletion('system', 'user', 'sk-test-key-for-auth-failure', async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Authentication Fails, Your api key is invalid' } }),
    })),
    error => error.code === 'invalid_deepseek_key' && /已从本机桥接清除/.test(error.message) && !/Authentication Fails/.test(error.message),
  );
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
