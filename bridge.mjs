import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_VAULT = process.env.OBSIDIAN_VAULT || path.join(process.cwd(), '.obsidian-vault-not-configured');
const DEFAULT_PORT = 8766;
const DEFAULT_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://cjy0722.github.io',
]);
const IGNORED = new Set(['.obsidian', '.git', 'node_modules', '.data']);

function apiError(message, code = 'bad_request') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === 'null') throw new Error();
    return url.origin;
  } catch {
    throw apiError(`无效网页来源：${value || '空值'}`, 'invalid_origin');
  }
}

function safeTokenEqual(left, right) {
  const actual = Buffer.from(String(left || ''));
  const expected = Buffer.from(String(right || ''));
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}

async function readRequestBody(request, limit = 2_000_000) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > limit) throw apiError('请求内容过大', 'payload_too_large');
  }
  return raw;
}

async function vaultStatus(vault) {
  const vaultExists = await fs.stat(vault).then(stat => stat.isDirectory()).catch(() => false);
  const obsidianConfigured = vaultExists && await fs.stat(path.join(vault, '.obsidian')).then(stat => stat.isDirectory()).catch(() => false);
  return { vault_exists: vaultExists, obsidian_configured: obsidianConfigured };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function returnUrlWithToken(target, token) {
  const returnUrl = new URL(target);
  const tab = returnUrl.hash.replace(/^#/, '') || 'overview';
  returnUrl.hash = new URLSearchParams({ bridge_token: token, tab }).toString();
  return returnUrl.href;
}

function pairingPage({ origin, vaultName, nonce = '', token = '', returnTarget = '', error = '' }) {
  const approved = Boolean(token);
  const approvedTarget = approved && returnTarget ? returnUrlWithToken(returnTarget, token) : '';
  const action = error ? '' : approved
    ? approvedTarget
      ? `<a class="return" href="${escapeHtml(approvedTarget)}">返回工作台</a><script>window.location.replace(${JSON.stringify(approvedTarget)});</script>`
      : `<script>window.opener?.postMessage(${JSON.stringify({ type: 'cjy-workbench-paired', token })}, ${JSON.stringify(origin)}); window.close();</script>`
    : `<form method="post" action="/pair"><input type="hidden" name="origin" value="${escapeHtml(origin)}"><input type="hidden" name="nonce" value="${escapeHtml(nonce)}"><button type="submit">允许连接</button></form>`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>连接 Obsidian</title><style>body{max-width:520px;margin:12vh auto;padding:24px;font:16px/1.7 system-ui;color:#20241f;background:#f7f8f5}main{padding:28px;border:1px solid #dfe2dc;border-radius:12px;background:white}code{word-break:break-all}button,.return{display:block;width:100%;box-sizing:border-box;margin-top:18px;padding:12px;border:0;border-radius:8px;color:white;background:#35624a;font-weight:700;text-align:center;text-decoration:none}</style><main><h1>${error || (approved ? '连接成功' : '连接自己的 Obsidian')}</h1><p>${approved ? '正在返回工作台；如果没有自动返回，请点击下方按钮。' : `知识库：<strong>${escapeHtml(vaultName)}</strong><br>请求来源：<code>${escapeHtml(origin)}</code>${error ? '' : '<br>允许后，该网页可以通过本机桥接读写此知识库。'}`}</p>${action}</main></html>`;
}

export function sanitizeFileName(value) {
  const safe = Array.from(String(value || ''), char => '<>:"/\\|?*'.includes(char) || char.charCodeAt(0) <= 0x1f ? '-' : char).join('');
  return safe.replace(/[. ]+$/g, '').trim().slice(0, 100) || '未命名草稿';
}

function ensureInside(root, relativePath) {
  const base = path.resolve(root);
  const target = path.resolve(base, String(relativePath || '').replaceAll('/', path.sep));
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw apiError('路径超出知识库范围', 'invalid_path');
  return target;
}

async function markdownFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORED.has(entry.name)) await visit(path.join(directory, entry.name));
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(path.join(directory, entry.name));
    }
  }
  await visit(root);
  return files;
}

function titleFromMarkdown(content, fallback) {
  const frontmatterTitle = content.match(/^---[\s\S]*?^title:\s*["']?([^\n"']+)/m)?.[1]?.trim();
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return frontmatterTitle || heading || fallback;
}

function withoutFrontmatter(content) {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
}

function frontmatterEntry(content, key) {
  const metadata = String(content || '').match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || '';
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = metadata.split('\n');
  const index = lines.findIndex(line => new RegExp(`^${escapedKey}:`, 'i').test(line));
  if (index < 0) return { inline: '', block: [] };
  const inline = lines[index].replace(new RegExp(`^${escapedKey}:\\s*`, 'i'), '').trim();
  const block = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line && !/^\s/.test(line)) break;
    if (line.trim()) block.push(line.trim());
  }
  return { inline, block };
}

function frontmatterValue(content, key) {
  const { inline, block } = frontmatterEntry(content, key);
  if (['|', '>-', '>', '|-'].includes(inline)) return block.join(inline.startsWith('>') ? ' ' : '\n');
  return (inline || block.join('\n')).replace(/^(["'])(.*)\1$/s, '$2');
}

function frontmatterBoolean(content, key) {
  return /^(true|yes|1)$/i.test(frontmatterValue(content, key));
}

function frontmatterList(content, key) {
  const { inline, block } = frontmatterEntry(content, key);
  const raw = inline || block.join('\n');
  if (!raw) return [];
  const values = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1).split(',') : raw.split('\n').map(value => value.replace(/^-\s*/, ''));
  return values.map(value => value.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean);
}

function blogStatus(content) {
  const raw = frontmatterValue(content, 'status').toLowerCase();
  if (frontmatterBoolean(content, 'draft') || /^(draft|草稿)$/.test(raw)) return 'draft';
  if (/^(idea|planned|构思|选题)$/.test(raw)) return 'idea';
  if (/^(review|reviewing|待审核|审核中)$/.test(raw)) return 'review';
  if (/^(published|已发布)$/.test(raw) || frontmatterBoolean(content, 'published') || /^(false|no|0)$/i.test(frontmatterValue(content, 'draft'))) return 'published';
  if (/^(ready|scheduled|可发布|待发布)$/.test(raw) || frontmatterBoolean(content, 'publish') || frontmatterBoolean(content, 'share') || frontmatterBoolean(content, 'dg-publish')) return 'ready';
  if (frontmatterBoolean(content, 'reviewed')) return 'review';
  return 'draft';
}

function draftMetadata(content) {
  const summary = frontmatterValue(content, 'description') || frontmatterValue(content, 'summary');
  return {
    status: blogStatus(content),
    reviewed: frontmatterBoolean(content, 'reviewed'),
    tags: frontmatterList(content, 'tags'),
    summary,
    cover: frontmatterValue(content, 'cover') || frontmatterValue(content, 'image'),
  };
}

function draftReadiness(title, content) {
  const review = reviewCsdnDraft({ title, content });
  const metadata = draftMetadata(content);
  const metadataIssues = [!metadata.tags.length && '缺少标签', !metadata.summary && '缺少摘要'].filter(Boolean);
  const issueCount = review.blockers.length + review.warnings.length + metadataIssues.length;
  return { metadata, review, metadataIssues, issueCount, qualityScore: Math.max(0, 100 - review.blockers.length * 18 - (review.warnings.length + metadataIssues.length) * 5) };
}

function displayWidth(value) {
  return Array.from(String(value)).reduce((width, char) => width + ((char.codePointAt(0) || 0) > 0xff ? 2 : 1), 0);
}

function splitMarkdownSections(content) {
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n');
  const sections = [];
  let current = [];
  let fenced = false;
  for (const line of lines) {
    if (!fenced && /^##\s+/.test(line) && current.length) {
      sections.push(current.join('\n'));
      current = [];
    }
    current.push(line);
    if (line.trim().startsWith('```')) fenced = !fenced;
  }
  if (current.length) sections.push(current.join('\n'));
  return sections.filter(section => section.trim());
}

const WRITING_CATEGORIES = [
  ['元知识 - 坑', ['元知识 - 坑', '踩坑记录']],
  ['元知识 - 偏好', ['元知识 - 偏好', '写作偏好']],
  ['元知识 - 文风', ['元知识 - 文风', '文风']],
  ['元知识 - 需求', ['元知识 - 需求', '写作需求']],
  ['博客索引', ['博客索引']],
];

function noteId(value) {
  return String(value || '').replaceAll('\\', '/').replace(/\.md$/i, '').toLowerCase();
}

function topicScore(record, tokens) {
  if (!tokens.length) return 0;
  const title = record.title.toLowerCase();
  const relative = record.relative.toLowerCase();
  const content = record.content.toLowerCase();
  return tokens.reduce((score, token) => score + (title.includes(token) ? 5 : 0) + (relative.includes(token) ? 3 : 0) + (content.includes(token) ? 1 : 0), 0);
}

function retrievalMatch(record) {
  const text = withoutFrontmatter(record.content).replace(/\s+/g, ' ').trim();
  return { path: record.relative, title: record.title, preview: text.slice(0, 240), excerpt: text.slice(0, 2400), updated: record.updated };
}

export async function writingPreflight({ topic = '' } = {}, root = DEFAULT_VAULT) {
  const files = await markdownFiles(root);
  const records = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const content = await fs.readFile(file, 'utf8');
    const stat = await fs.stat(file);
    records.push({ relative, content, title: titleFromMarkdown(content, path.basename(file, '.md')), updated: stat.mtimeMs });
  }
  const tokens = String(topic || '').trim().toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 1);
  const byId = new Map();
  for (const record of records) {
    byId.set(noteId(record.relative), record);
    byId.set(path.basename(noteId(record.relative)), record);
  }
  const rank = (left, right) => topicScore(right, tokens) - topicScore(left, tokens) || right.updated - left.updated;
  const searchedAt = new Date().toISOString();
  const retrieval = WRITING_CATEGORIES.map(([category, names]) => {
    const categoryRecords = records.filter(record => names.some(name => `${record.relative}\n${record.title}`.toLowerCase().includes(name.toLowerCase()))).sort(rank);
    let selected = categoryRecords.slice(0, 5);
    if (category === '博客索引') {
      const linked = categoryRecords.flatMap(record => [...record.content.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
        .map(match => byId.get(noteId(match[1])) || byId.get(path.basename(noteId(match[1]))))
        .filter(Boolean)).sort(rank);
      const seen = new Set(categoryRecords.map(record => record.relative));
      const examples = linked.filter(record => !seen.has(record.relative) && seen.add(record.relative)).slice(0, 3);
      selected = [...categoryRecords.slice(0, 2), ...examples];
    }
    const matches = selected.map(retrievalMatch);
    return { category, query: names.join(' / '), topic: String(topic || ''), searchedAt, matches };
  });
  return { complete: true, searchedAt, retrieval };
}

function writingContext(preflight) {
  return preflight.retrieval.map(item => {
    const details = item.matches.length
      ? item.matches.map(match => `[${match.path}]\n${match.excerpt || match.preview || ''}`).join('\n\n')
      : '本类已检索，但没有命中。';
    return `## ${item.category}\n${details}`.slice(0, 2000);
  }).join('\n\n');
}

export function reviewCsdnDraft({ title, content }) {
  const cleanTitle = String(title || '').trim();
  const markdown = String(content || '').replace(/\r\n?/g, '\n');
  const lines = markdown.split('\n');
  const blockers = [];
  const warnings = [];
  if (!cleanTitle) blockers.push('缺少文章标题');
  if (!markdown.trim()) blockers.push('正文为空');
  if (!/^#\s+/m.test(markdown)) blockers.push('正文缺少一级标题');
  if ((markdown.match(/^##\s+/gm) || []).length < 2) blockers.push('正文结构少于两个二级章节');
  if (/待补充|待确认|TODO/i.test(markdown)) blockers.push('正文仍包含待补充或待确认标记');
  if (!/source:/i.test(markdown) && !/\[\[[^\]]+\]\]/.test(markdown)) warnings.push('没有发现可追踪来源');
  if (/首先[，,]|其次[，,]|综上所述|值得注意的是|众所周知/.test(markdown)) warnings.push('检测到模板化表达，建议进行人工去 AI 味检查');
  if (/!\[\[[^\]]+\]\]|!\[[^\]]*\]\((?!https?:\/\/|data:)[^)]+\)/i.test(markdown)) warnings.push('检测到本地图片，发布前需要重新上传');

  const diagramLines = [];
  let fenced = false;
  let diagram = false;
  let largeBlocks = 0;
  let blockLines = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith('```')) {
      if (!fenced) {
        const language = line.trim().slice(3).trim().toLowerCase();
        diagram = !language || ['text', 'txt', 'plaintext', 'ascii', 'diagram'].includes(language);
        blockLines = 0;
      } else if (blockLines >= 20 || diagram) largeBlocks += 1;
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      blockLines += 1;
      if (diagram && displayWidth(line) > 60) diagramLines.push({ line: index + 1, width: displayWidth(line) });
      if (diagram && /[┌┐└┘├┤┬┴┼─│→←↑↓]/.test(line)) blockers.push(`第 ${index + 1} 行图示使用了非 ASCII 几何符号`);
    }
  }
  if (diagramLines.length) blockers.push(`有 ${diagramLines.length} 行图示超过 60 个半角显示列`);
  return {
    blockers,
    warnings: [...new Set(warnings)],
    diagramLines,
    lines: lines.length,
    characters: markdown.length,
    longArticle: lines.length > 150 || markdown.length > 6000 || largeBlocks >= 2,
  };
}

function plainText(markdown) {
  return withoutFrontmatter(String(markdown || '').replace(/\r\n?/g, '\n'))
    .replace(/^>\s*写作要求：.*$/gm, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target.split('/').at(-1))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createPublishPack({ title, content }) {
  const cleanTitle = String(title || '').trim();
  const text = plainText(content).replace(new RegExp(`^${cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '');
  if (!cleanTitle || !text) throw apiError('标题和正文不能为空');
  const csdnIntro = text.slice(0, 256);
  const xiaohongshuTitle = cleanTitle.slice(0, 20);
  const xiaohongshuIntro = text.slice(0, 100);
  return { csdnIntro, xiaohongshuTitle, xiaohongshuIntro };
}

const CLOSURE_TARGETS = {
  preference: ['元知识 - 偏好', '30-领域/写作系统/元知识 - 偏好.md'],
  style: ['元知识 - 文风', '30-领域/写作系统/元知识 - 文风.md'],
  requirement: ['元知识 - 需求', '30-领域/写作系统/元知识 - 需求.md'],
  pitfall: ['元知识 - 坑', '30-领域/写作系统/元知识 - 坑.md'],
};
const KNOWLEDGE_FILE_MAX_LINES = 200;
const KNOWLEDGE_FILE_MAX_CHARS = 10000;

async function fileTextOrEmpty(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

async function knowledgeFamily(relative, root) {
  const directory = path.posix.dirname(relative);
  const stem = path.posix.basename(relative, '.md');
  const absoluteDirectory = ensureInside(root, directory);
  const names = await fs.readdir(absoluteDirectory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return names.filter(name => name === `${stem}.md` || name.startsWith(`${stem} - `) && name.endsWith('.md')).map(name => `${directory}/${name}`);
}

async function knowledgeFamilyText(relative, root) {
  const files = await knowledgeFamily(relative, root);
  return (await Promise.all(files.map(file => fileTextOrEmpty(ensureInside(root, file))))).join('\n');
}

function normalizedEntry(value) {
  return String(value || '').toLowerCase().replace(/[\s，。；：、,.!！?？“”"'（）()【】_-]+/g, '').replaceAll('[', '').replaceAll(']', '');
}

function hasSimilarEntry(existing, value) {
  const target = normalizedEntry(value);
  if (!target) return false;
  if (normalizedEntry(existing).includes(target)) return true;
  if (target.length < 8) return false;
  const grams = new Set(Array.from({ length: target.length - 1 }, (_, index) => target.slice(index, index + 2)));
  return existing.split(/\r?\n/).some(line => {
    const candidate = normalizedEntry(line.replace(/^[-*]\s*/, '').replace(/^\d{4}-\d{2}-\d{2}·?/, ''));
    if (candidate.length < 8) return false;
    const other = new Set(Array.from({ length: candidate.length - 1 }, (_, index) => candidate.slice(index, index + 2)));
    const overlap = [...grams].filter(gram => other.has(gram)).length;
    return 2 * overlap / (grams.size + other.size) >= 0.88;
  });
}

function knowledgeDocument(category, value, existing = '') {
  const date = new Date().toISOString().slice(0, 10);
  const prefix = existing ? '' : `---\ntags: [写作系统, ${category}]\ncreated: ${date}\n---\n\n# ${category}\n`;
  return `${existing}${prefix}\n- ${date} · ${value}\n`;
}

function withinKnowledgeLimit(content) {
  return content.length <= KNOWLEDGE_FILE_MAX_CHARS && content.split(/\r?\n/).length <= KNOWLEDGE_FILE_MAX_LINES;
}

async function chooseKnowledgeTarget(relative, category, value, root) {
  const current = await fileTextOrEmpty(ensureInside(root, relative));
  if (withinKnowledgeLimit(knowledgeDocument(category, value, current))) return relative;
  const directory = path.posix.dirname(relative);
  const stem = path.posix.basename(relative, '.md');
  const month = new Date().toISOString().slice(0, 7);
  for (let index = 1; index <= 100; index += 1) {
    const suffix = index === 1 ? '' : ` - ${index}`;
    const candidate = `${directory}/${stem} - ${month}${suffix}.md`;
    const existing = await fileTextOrEmpty(ensureInside(root, candidate));
    if (withinKnowledgeLimit(knowledgeDocument(category, value, existing))) return candidate;
  }
  throw apiError(`${category}分篇数量超过限制`, 'knowledge_rollover_failed');
}

async function closureEntries(data, root) {
  const entries = [];
  for (const [key, [category, relative]] of Object.entries(CLOSURE_TARGETS)) {
    const value = String(data[key] || '').trim();
    if (!value) continue;
    if (value.length > 5000) throw apiError(`${category}内容过长`, 'entry_too_large');
    const existing = await knowledgeFamilyText(relative, root);
    const duplicate = hasSimilarEntry(existing, value);
    const target = duplicate ? relative : await chooseKnowledgeTarget(relative, category, value, root);
    entries.push({ category, value, target, baseTarget: relative, duplicate });
  }
  const title = String(data.title || '').trim();
  const draftPath = String(data.draftPath || '').trim();
  if (title && draftPath) {
    const value = `[[${draftPath.replace(/\.md$/i, '')}|${title}]]`;
    const target = '40-资源/博客索引.md';
    const existing = await knowledgeFamilyText(target, root);
    const duplicate = existing.includes(value);
    entries.push({ category: '博客索引', value, target: duplicate ? target : await chooseKnowledgeTarget(target, '博客索引', value, root), baseTarget: target, duplicate });
  }
  return entries;
}

export async function previewClosure(data, root = DEFAULT_VAULT) {
  const entries = await closureEntries(data, root);
  const event = `${new Date().toISOString()} · 博客定稿：${String(data.title || '未命名文章').trim()}`;
  const summary = entries.length ? entries.map(item => `- ${item.duplicate ? '跳过重复' : '拟写入'} ${item.category}：${item.value}`).join('\n') : '- 没有新增元知识；仅追加本次写作事件日志';
  return { summary: `本次拟写入知识库：\n${summary}\n\n本次拟追加事件日志：\n- ${event}`, entries, event };
}

async function appendKnowledgeEntry(relative, category, value, root) {
  const target = await chooseKnowledgeTarget(relative, category, value, root);
  const file = ensureInside(root, target);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = await fileTextOrEmpty(file);
  await fs.writeFile(file, knowledgeDocument(category, value, existing), 'utf8');
  return target;
}

export async function commitClosure(data, root = DEFAULT_VAULT) {
  if (data.approved !== true) throw apiError('收尾入库需要用户明确审批', 'approval_required');
  const entries = await closureEntries(data, root);
  const pending = entries.filter(entry => !entry.duplicate);
  const writtenTargets = [];
  const skipped = entries.length - pending.length;
  for (let index = 0; index < pending.length; index += 1) {
    const entry = pending[index];
    try {
      writtenTargets.push(await appendKnowledgeEntry(entry.baseTarget, entry.category, entry.value, root));
    } catch (error) {
      const remaining = pending.slice(index).map(item => item.baseTarget).join('、') || '无';
      throw apiError(`收尾入库部分失败；已写入：${writtenTargets.join('、') || '无'}；未完成：${remaining}；错误：${error.message}`, 'partial_write');
    }
  }
  const eventTarget = '10-日记/写作事件日志.md';
  const eventValue = `博客定稿：${String(data.title || '未命名文章').trim()}${data.draftPath ? ` · [[${String(data.draftPath).replace(/\.md$/i, '')}]]` : ''}`;
  const eventExisting = await knowledgeFamilyText(eventTarget, root);
  const eventLogged = !eventExisting.includes(eventValue);
  if (eventLogged) {
    try { await appendKnowledgeEntry(eventTarget, '写作事件日志', eventValue, root); }
    catch (error) { throw apiError(`元知识已写入但事件日志失败；已写入：${writtenTargets.join('、') || '无'}；未完成：${eventTarget}；错误：${error.message}`, 'partial_write'); }
  }
  return { written: writtenTargets.length, skipped, eventLogged, writtenTargets };
}

const PUBLISH_PLATFORMS = {
  csdn: { name: 'CSDN', editorUrl: 'https://editor.csdn.net/md/', format: '标准 Markdown', kind: 'markdown' },
  juejin: { name: '掘金', editorUrl: 'https://juejin.cn/editor/drafts/new?v=2', format: '标准 Markdown', kind: 'markdown' },
  zhihu: { name: '知乎', editorUrl: 'https://zhuanlan.zhihu.com/write', format: '富文本兼容稿', kind: 'rich-text' },
  wechat: { name: '微信公众号', editorUrl: 'https://mp.weixin.qq.com/', format: '富文本兼容稿', kind: 'rich-text' },
  xiaohongshu: { name: '小红书', editorUrl: 'https://creator.xiaohongshu.com/publish/publish', format: '长文纯文本 + 3:4 图卡', kind: 'plain-text' },
};
const XIAOHONGSHU_MAX_IMAGES = 18;

const CALLOUT_LABELS = {
  note: '备注', tip: '提示', info: '说明', warning: '注意', caution: '注意',
  important: '重要', question: '问题', example: '示例', quote: '引用', bug: '问题',
  success: '完成', failure: '警告', danger: '警告',
};

function markdownTarget(rawTarget) {
  const [notePart, ...headingParts] = String(rawTarget).trim().split('#');
  let note = notePart.trim();
  if (note && !/\.[a-z0-9]+$/i.test(note)) note += '.md';
  const heading = headingParts.join('#').trim();
  return `${note.replaceAll(' ', '%20')}${heading ? `#${heading.replaceAll(' ', '-')}` : ''}`;
}

export function obsidianToStandardMarkdown(value) {
  const source = withoutFrontmatter(String(value || '').replace(/\r\n?/g, '\n'));
  return source
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/```(?:dataview|dataviewjs|query)[^\n]*\n[\s\S]*?```/gi, '> **需要手动补充：原 Obsidian 查询块已移除，请粘贴静态结果。**')
    .replace(/^>\s*\[!([a-z-]+)\][+-]?\s*(.*)$/gim, (_, kind, title) => {
      const label = CALLOUT_LABELS[String(kind).toLowerCase()] || String(kind).toUpperCase();
      return `> **${label}${title.trim() ? `：${title.trim()}` : ''}**`;
    })
    .replace(/!\[\[([^\]]+)\]\]/g, (_, value) => {
      const [rawTarget, rawAlias] = value.split('|');
      const target = rawTarget.trim();
      const fileName = target.split('/').at(-1).split('#')[0];
      const isImage = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(fileName);
      const alias = rawAlias?.trim() && !/^\d+(?:x\d+)?$/i.test(rawAlias.trim()) ? rawAlias.trim() : fileName.replace(/\.[^.]+$/, '');
      return isImage ? `![${alias}](${target.replaceAll(' ', '%20')})` : `[嵌入：${alias}](${markdownTarget(target)})`;
    })
    .replace(/\[\[([^\]]+)\]\]/g, (_, value) => {
      const [rawTarget, rawAlias] = value.split('|');
      const target = rawTarget.trim();
      const alias = rawAlias?.trim() || target.split('/').at(-1).replace('#', ' · ');
      return `[${alias}](${markdownTarget(target)})`;
    })
    .replace(/==([^=\n]+)==/g, '**$1**')
    .replace(/\s+\^[a-z0-9-]+$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function markdownToPlatformText(value) {
  const code = [];
  const protectedValue = String(value || '').replace(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g, (_, block, inline) => {
    code.push(block === undefined ? inline : `【代码】\n${block.trim()}\n【代码结束】`);
    return `\uE000${code.length - 1}\uE001`;
  });
  return protectedValue
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '• ')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1、')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_, row) => row.split('|').map(cell => cell.trim()).join(' ｜ '))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `【图片：${alt || url}，请重新上传】`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1（$2）')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\[\^([^\]]+)\]:\s*/gm, '注$1：')
    .replace(/\[\^([^\]]+)\]/g, '（注$1）')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/<[^>\n]+>/g, '')
    .replace(/\uE000(\d+)\uE001/g, (_, index) => code[Number(index)])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitXiaohongshuCards(value, maxLines = 16, maxCharacters = 18) {
  const lines = [];
  for (const rawLine of String(value || '').split('\n')) {
    const characters = Array.from(rawLine.trim());
    if (!characters.length) {
      if (lines.at(-1) !== '') lines.push('');
      continue;
    }
    for (let index = 0; index < characters.length; index += maxCharacters) {
      lines.push(characters.slice(index, index + maxCharacters).join(''));
    }
  }
  while (lines.at(-1) === '') lines.pop();
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines).join('\n'));
  return pages.length ? pages : [''];
}

export function preparePlatformPayload({ platform = 'csdn', title, content }) {
  const target = PUBLISH_PLATFORMS[platform];
  if (!target) throw apiError('不支持的发布平台', 'invalid_platform');
  const cleanTitle = String(title || '').trim();
  const source = String(content || '').replace(/\r\n?/g, '\n');
  if (!cleanTitle || !source.trim()) throw apiError('标题和正文不能为空');
  if (source.length > 200000) throw apiError('草稿过长，请控制在 20 万字符以内', 'draft_too_large');

  const warnings = [];
  const conversions = [];
  if (/^---\s*\n[\s\S]*?\n---/.test(source)) conversions.push('YAML 已移除');
  if (/!?\[\[[^\]]+\]\]/.test(source)) conversions.push('WikiLink / 嵌入已标准化');
  if (/^>\s*\[![^\]]+\]/mi.test(source)) conversions.push('Callout 已转引用');
  if (/==[^=\n]+==/.test(source)) conversions.push('高亮已转粗体');
  if (/%%[\s\S]*?%%/.test(source)) conversions.push('Obsidian 注释已移除');
  if (/\s+\^[a-z0-9-]+$/mi.test(source)) conversions.push('块标识已移除');
  if (/```(?:dataview|dataviewjs|query)/i.test(source)) conversions.push('查询块已转静态占位');
  if (/!\[\[[^\]]+\]\]/.test(source)) warnings.push(`Obsidian 附件已转为标准引用，但仍需在 ${target.name} 重新上传`);
  if (/!\[[^\]]*\]\((?!https?:\/\/|data:)[^)]+\)/i.test(source)) warnings.push(`检测到本地 Markdown 图片，请在 ${target.name} 中重新上传`);
  if (/待补充|待确认|TODO/i.test(source)) warnings.push('正文仍包含待补充或待确认标记');
  if (/```(?:dataview|dataviewjs)|```query/i.test(source)) warnings.push('Obsidian 查询块不会在外部平台运行，请转成静态文字或截图');

  let markdown = obsidianToStandardMarkdown(source);
  if (!/^#\s+/m.test(markdown)) markdown = `# ${cleanTitle}\n\n${markdown}`;
  let prepared = markdown;
  if (target.kind === 'rich-text') {
    prepared = markdownToPlatformText(markdown);
    conversions.push('Markdown 已转结构化粘贴稿');
    warnings.push(`${target.name} 已生成富文本兼容稿；粘贴后请检查图片、代码块、表格和标题层级`);
  }
  if (target.kind === 'plain-text') {
    prepared = markdownToPlatformText(markdown);
    conversions.push('Markdown 已转纯文本');
    warnings.push('已移除标题、链接、强调等 Markdown 标记，适合作为小红书长文底稿');
  }
  const generatedCardPages = platform === 'xiaohongshu' ? splitXiaohongshuCards(prepared) : undefined;
  const cardPages = generatedCardPages?.slice(0, XIAOHONGSHU_MAX_IMAGES);
  if (cardPages) {
    conversions.push('长文已分页为 3:4 图卡');
    warnings.push(generatedCardPages.length > XIAOHONGSHU_MAX_IMAGES
      ? `正文原需 ${generatedCardPages.length} 张图卡；小红书单篇最多上传 ${XIAOHONGSHU_MAX_IMAGES} 张，当前仅生成前 ${XIAOHONGSHU_MAX_IMAGES} 张。请缩短正文或改发长文，避免遗漏后续内容`
      : `已分页为 ${cardPages.length} 张 3:4 图卡，请下载后逐张上传`);
  }
  const preparedTitle = platform === 'xiaohongshu' ? Array.from(cleanTitle).slice(0, 20).join('') : cleanTitle;
  if (preparedTitle !== cleanTitle) warnings.push('小红书标题已截取为前 20 个字符，请发布前确认语义完整');
  return {
    platform,
    platformName: target.name,
    title: preparedTitle,
    content: `${prepared}\n`,
    characters: prepared.replace(/\s/g, '').length,
    warnings,
    editorUrl: target.editorUrl,
    format: target.format,
    conversions,
    ...(cardPages ? { cardPages } : {}),
  };
}

export function prepareCsdnPayload(data) {
  return preparePlatformPayload({ ...data, platform: 'csdn' });
}

export async function searchNotes(query = '', limit = 10, root = DEFAULT_VAULT) {
  const cleanQuery = String(query).trim().toLowerCase();
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  const results = [];
  for (const file of await markdownFiles(root)) {
    const content = await fs.readFile(file, 'utf8');
    const relative = path.relative(root, file).split(path.sep).join('/');
    const title = titleFromMarkdown(content, path.basename(file, '.md'));
    const haystack = `${title}\n${relative}\n${content}`.toLowerCase();
    if (tokens.length && !tokens.every(token => haystack.includes(token))) continue;
    const stat = await fs.stat(file);
    const score = tokens.length ? tokens.reduce((total, token) => total + (title.toLowerCase().includes(token) ? 3 : 1), 0) : stat.mtimeMs / 1e12;
    const preview = withoutFrontmatter(content).replace(/[#>*`]/g, '').replaceAll('[', '').replaceAll(']', '').replace(/\s+/g, ' ').slice(0, 120);
    results.push({ path: relative, title, preview, text: preview, score, updated: stat.mtime.toISOString() });
  }
  return results.sort((a, b) => b.score - a.score || b.updated.localeCompare(a.updated)).slice(0, Math.min(20, Math.max(1, Number(limit) || 10)));
}

function frontmatter(title, sourcePath, aiGenerated) {
  const date = new Date().toISOString().slice(0, 10);
  const source = sourcePath ? `"[[${sourcePath.replace(/\.md$/i, '')}]]"` : '"用户原创"';
  return `---\ntitle: ${JSON.stringify(title)}\ntype: Content\ncreated: ${date}\nupdated: ${date}\nsource: ${source}\nsource_type: ${sourcePath ? 'knowledge' : 'original'}\ntopics: [CSDN]\ntags: [CSDN, 草稿]\nstatus: draft\nconfidence: 0.6\nai_generated: ${aiGenerated}\nreviewed: false\n---`;
}

function templateBody(title, sourcePath, sourceContent, instruction) {
  const excerpt = withoutFrontmatter(sourceContent).slice(0, 5000);
  return `# ${title}\n\n> 写作要求：${instruction || '面向学生读者，保留来源，不虚构结果。'}\n\n## 先说结论\n\n待补充：用 2～3 句话说明这篇文章解决什么问题。\n\n## 背景与目标\n\n本文基于 [[${sourcePath.replace(/\.md$/i, '')}]] 整理。请在发布前核对原始资料。\n\n## 来源笔记要点\n\n${excerpt || '待补充：来源笔记暂无正文。'}\n\n## 实践步骤\n\n- 待补充：环境与前置条件\n- 待补充：核心操作\n- 待补充：验证方法\n\n## 常见问题\n\n待补充：只记录真实遇到或来源明确的问题。\n\n## 总结\n\n待补充：回顾结论，并给出可执行的下一步。`;
}

export async function deepseekCompletion(system, user, key = process.env.DEEPSEEK_API_KEY, fetcher = fetch) {
  if (!key || key === 'YOUR_API_KEY_HERE') throw apiError('尚未配置 DeepSeek API Key', 'deepseek_not_configured');
  const response = await fetcher('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
    })
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = String(data?.error?.message || '');
    const invalidKey = response.status === 401 || /authentication fails|api key.*invalid/i.test(detail);
    throw apiError(invalidKey ? 'DeepSeek API Key 无效或已失效，已从本机桥接清除；请在设置中填写新密钥。' : detail || 'DeepSeek 生成失败', invalidKey ? 'invalid_deepseek_key' : 'deepseek_failed');
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw apiError('DeepSeek 未返回正文', 'empty_generation');
  return text;
}

async function generateWithDeepSeek(sourcePath, sourceContent, instruction, writingContext = '', revise = false, key = process.env.DEEPSEEK_API_KEY) {
  const system = revise
    ? '你是严谨的中文技术编辑。保留用户原文的结构、文风与事实含义，只按要求修改；资料不足处标记“待确认”。不得虚构运行结果、踩坑、数据或经验。输出完整 Markdown，不要输出 YAML frontmatter。'
    : '你是严谨的 CSDN 技术写作助手。只依据给定知识源写中文 Markdown；资料不足处标记“待确认”。不得虚构代码运行结果、踩坑经历、数据或个人经验。解释关键代码并保留来源 WikiLink。不要输出 YAML frontmatter。';
  const user = `写作要求：${instruction}\n来源路径：${sourcePath}\n\n知识源：\n${sourceContent.slice(0, 30000)}\n\n已检索的协作偏好与博客索引：\n${writingContext.slice(0, 10000)}`;
  return withoutFrontmatter(await deepseekCompletion(system, user, key));
}

export async function generateDraft({ sourcePath, instruction = '', useAi = false, preflightConfirmed = false }, root = DEFAULT_VAULT, apiKey = process.env.DEEPSEEK_API_KEY) {
  if (preflightConfirmed !== true) throw apiError('生成初稿前必须完成知识库预检', 'preflight_required');
  const source = ensureInside(root, sourcePath);
  if (path.extname(source).toLowerCase() !== '.md') throw apiError('知识源必须是 Markdown 文件', 'invalid_source');
  const sourceContent = await fs.readFile(source, 'utf8');
  const sourceTitle = titleFromMarkdown(sourceContent, path.basename(source, '.md'));
  const title = sourceTitle;
  const preflight = await writingPreflight({ topic: title }, root);
  const context = writingContext(preflight);
  const body = useAi ? await generateWithDeepSeek(sourcePath, sourceContent, instruction, context, false, apiKey) : templateBody(title, sourcePath, sourceContent, instruction);
  return { title, content: `${frontmatter(title, sourcePath, useAi)}\n\n${body.trim()}\n`, source: { path: sourcePath, title: sourceTitle }, mode: useAi ? 'ai' : 'template' };
}

export async function reviseDraft({ title, content, instruction = '', useAi = true, preflightConfirmed = false }, root = DEFAULT_VAULT, apiKey = process.env.DEEPSEEK_API_KEY) {
  if (preflightConfirmed !== true) throw apiError('修改初稿前必须完成知识库预检', 'preflight_required');
  const cleanTitle = String(title || '').trim() || titleFromMarkdown(String(content || ''), '未命名文章');
  if (!String(content || '').trim()) throw apiError('已有文章不能为空');
  const preflight = await writingPreflight({ topic: cleanTitle }, root);
  const context = writingContext(preflight);
  const body = useAi ? await generateWithDeepSeek('用户已有文章', withoutFrontmatter(String(content)), instruction, context, true, apiKey) : withoutFrontmatter(String(content));
  return { title: cleanTitle, content: `${frontmatter(cleanTitle, '', useAi)}\n\n${body.trim()}\n`, mode: useAi ? 'ai-revise' : 'unchanged' };
}

export async function improveDraft({ title, content, kind, issues = [] }, apiKey = process.env.DEEPSEEK_API_KEY, complete = deepseekCompletion) {
  const source = String(content || '').replace(/\r\n?/g, '\n').trim();
  if (!source) throw apiError('正文不能为空', 'empty_draft');
  if (!['fix', 'humanize'].includes(kind)) throw apiError('未知的草稿改写方式', 'invalid_improvement');
  const metadata = source.match(/^---\s*\n[\s\S]*?\n---/)?.[0] || '';
  const body = withoutFrontmatter(source);
  const system = kind === 'fix'
    ? '你是严谨的中文技术编辑。只修正列出的审核问题，保留原文事实、结构意图、代码、链接和技术术语。不得虚构运行结果、数据、来源或个人经历。遇到资料不足的占位内容，应删除无法支持的主张或改成明确的资料边界，不得编造答案。形如 CJYPROTECTEDREF0TOKEN 的保护标记必须原样保留且只能出现一次。ASCII 图示每行不超过 60 个半角显示列。输出完整 Markdown 正文，不要输出 YAML frontmatter或解释。'
    : '你是克制的中文技术编辑。让文章像真实作者写作：删除套话、机械过渡、重复总结和夸张措辞，调整长短句与段落节奏；保留全部事实、代码、链接、标题层级、技术术语和作者观点，不新增经验、结论或数据。输出完整 Markdown 正文，不要输出 YAML frontmatter或解释。';
  const problemList = Array.isArray(issues) && issues.length ? issues.map(item => `- ${String(item)}`).join('\n') : '- 无指定问题，按任务目标检查全文';
  const rewritten = withoutFrontmatter(await complete(system, `文章标题：${String(title || '')}\n\n需要处理的问题：\n${problemList}\n\n当前 Markdown：\n${body.slice(0, 30000)}`, apiKey));
  const improved = `${metadata ? `${metadata}\n\n` : ''}${rewritten.trim()}\n`;
  return { content: improved, review: reviewCsdnDraft({ title, content: improved }), kind };
}

export async function saveDraft({
  title, content, sourcePath = '', expectedUpdated = '', overwriteConfirmed = false, approved = false,
  preflightConfirmed = false, focusDecision = 'pending', materialKind = 'markdown', visualVerified = false,
  visualEvidence = '', reviewConfirmed = false,
}, root = DEFAULT_VAULT) {
  if (approved !== true) throw apiError('写入 Markdown 需要用户明确确认', 'approval_required');
  if (preflightConfirmed !== true) throw apiError('写入前必须完成五类知识预检', 'preflight_required');
  if (!['confirmed', 'skipped'].includes(focusDecision)) throw apiError('写入前必须确认重点或明确跳过讨论', 'focus_required');
  if (materialKind === 'visual' && (!visualVerified || !String(visualEvidence).trim())) throw apiError('视觉材料必须留下渲染或 OCR 核验记录', 'visual_verification_required');
  if (reviewConfirmed !== true) throw apiError('写入前必须完成草稿审核', 'review_required');
  if (!String(title).trim() || !String(content).trim()) throw apiError('标题和正文不能为空');
  if (String(content).length > 200000) throw apiError('草稿过长，请控制在 20 万字符以内', 'draft_too_large');
  if (sourcePath) {
    const source = ensureInside(root, sourcePath);
    if (path.extname(source).toLowerCase() !== '.md') throw apiError('知识源路径无效', 'invalid_source');
  }
  const relative = `06-Content/CSDN/${sanitizeFileName(title)}.md`;
  const target = ensureInside(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let versionArchived = false;
  try {
    const stat = await fs.stat(target);
    if (!overwriteConfirmed) throw apiError('同名草稿已存在，需要确认覆盖', 'confirm_overwrite');
    if (expectedUpdated && Math.abs(stat.mtimeMs - Number(expectedUpdated)) > 2) throw apiError('草稿已在其他位置修改，请重新打开后再保存', 'draft_conflict');
    const archive = ensureInside(root, `90-归档/CSDN版本/${sanitizeFileName(title)}/${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    await fs.mkdir(path.dirname(archive), { recursive: true });
    await fs.copyFile(target, archive);
    versionArchived = true;
  } catch (error) {
    if (error.code && error.code !== 'ENOENT') throw error;
  }
  const authored = String(content).trim();
  const normalized = `${authored.startsWith('---\n') ? authored : `${frontmatter(String(title).trim(), sourcePath, false)}\n\n${authored}`}\n`;
  const audit = reviewCsdnDraft({ title, content: normalized });
  if (audit.blockers.length) throw apiError(`草稿仍有阻塞项：${audit.blockers.join('；')}`, 'review_blocked');
  const sections = audit.longArticle ? splitMarkdownSections(normalized) : [normalized];
  let sectionsWritten = 0;
  try {
    await fs.writeFile(target, '', 'utf8');
    for (const section of sections) {
      await fs.appendFile(target, `${sectionsWritten ? '\n' : ''}${section.trim()}\n`, 'utf8');
      sectionsWritten += 1;
    }
  } catch (error) {
    const lastHeading = sectionsWritten ? sections[sectionsWritten - 1].match(/^##\s+(.+)$/m)?.[1] || '文件开头' : '尚未写入正文';
    throw apiError(`长文写入失败；目标 ${relative}；已写入 ${sectionsWritten}/${sections.length} 段；最后完成 ${lastHeading}；错误：${error.message}`, 'partial_write');
  }
  const stat = await fs.stat(target);
  return { path: relative, updated: String(stat.mtimeMs), versionArchived, longArticle: audit.longArticle, sectionsWritten };
}

export async function listDrafts(root = DEFAULT_VAULT) {
  const directory = ensureInside(root, '06-Content/CSDN');
  try {
    const items = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const file = path.join(directory, entry.name);
      const content = await fs.readFile(file, 'utf8');
      const stat = await fs.stat(file);
      const title = titleFromMarkdown(content, path.basename(entry.name, '.md'));
      const { metadata, issueCount, qualityScore } = draftReadiness(title, content);
      items.push({
        path: `06-Content/CSDN/${entry.name}`,
        title,
        updated: stat.mtime.toISOString(),
        mtime: String(stat.mtimeMs),
        status: metadata.status,
        reviewed: metadata.reviewed,
        tags: metadata.tags,
        characters: withoutFrontmatter(content).replace(/\s/g, '').length,
        qualityScore,
        issueCount,
      });
    }
    return items.sort((a, b) => b.updated.localeCompare(a.updated));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readDraft(relativePath, root = DEFAULT_VAULT) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  if (!normalized.startsWith('06-Content/CSDN/') || !normalized.toLowerCase().endsWith('.md')) throw apiError('只能读取 CSDN 草稿目录', 'invalid_path');
  const file = ensureInside(root, normalized);
  const content = await fs.readFile(file, 'utf8');
  const stat = await fs.stat(file);
  const sourcePath = content.match(/^source:\s*["']?\[\[([^\]]+)\]\]/m)?.[1];
  return { title: titleFromMarkdown(content, path.basename(file, '.md')), content, path: normalized, updated: String(stat.mtimeMs), source: sourcePath ? { path: `${sourcePath}.md`, title: path.basename(sourcePath) } : null };
}

async function captureNote({ title, content, tags = ['待整理'] }, root = DEFAULT_VAULT) {
  const directory = ensureInside(root, '00-收件箱');
  await fs.mkdir(directory, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const file = path.join(directory, `${stamp}-${sanitizeFileName(title)}.md`);
  const body = `---\ntags: ${JSON.stringify(tags)}\ncreated: ${now.toISOString().slice(0, 10)}\nsource: 智能体工作台\n---\n\n# ${title}\n\n${String(content).trim()}\n`;
  await fs.writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
  return { path: path.relative(root, file).split(path.sep).join('/'), created: true };
}

async function vaultRecords(root) {
  const records = [];
  for (const file of await markdownFiles(root)) {
    const [content, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    const relative = path.relative(root, file).split(path.sep).join('/');
    const links = [...content.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map(match => match[1].trim());
    records.push({ file, relative, content, stat, links, title: titleFromMarkdown(content, path.basename(file, '.md')) });
  }
  return records;
}

function graphFromRecords(records, limit = 120) {
  const selected = records.slice(0, Math.min(300, Math.max(1, Number(limit) || 120)));
  const ids = new Set(selected.map(record => record.relative.replace(/\.md$/i, '').toLowerCase()));
  const basenameMap = new Map(selected.map(record => [path.basename(record.relative, '.md').toLowerCase(), record.relative.replace(/\.md$/i, '')]));
  const edges = [];
  const degrees = new Map();
  for (const record of selected) {
    const source = record.relative.replace(/\.md$/i, '');
    for (const link of record.links) {
      const normalized = link.replace(/\.md$/i, '').replaceAll('\\', '/');
      const target = ids.has(normalized.toLowerCase()) ? selected.find(item => item.relative.replace(/\.md$/i, '').toLowerCase() === normalized.toLowerCase())?.relative.replace(/\.md$/i, '') : basenameMap.get(path.basename(normalized).toLowerCase());
      if (!target || target === source) continue;
      edges.push({ source, target });
      degrees.set(source, (degrees.get(source) || 0) + 1);
      degrees.set(target, (degrees.get(target) || 0) + 1);
    }
  }
  const nodes = selected.map(record => {
    const id = record.relative.replace(/\.md$/i, '');
    return { id, label: record.title, group: /(^|\/)raw(\/|$)/i.test(record.relative) ? 'raw' : 'wiki', degree: degrees.get(id) || 0 };
  });
  return { nodes, edges, orphanCount: nodes.filter(node => !node.degree).length };
}

async function clippingsView({ query = '', limit = 100 } = {}, root = DEFAULT_VAULT) {
  const needle = String(query || '').trim().toLowerCase();
  const records = (await vaultRecords(root)).filter(record => /(^|\/)clippings(\/|$)/i.test(record.relative));
  const items = records.filter(record => !needle || `${record.title}\n${record.relative}\n${record.content}`.toLowerCase().includes(needle)).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, Math.min(200, Math.max(1, Number(limit) || 100))).map(record => ({
    path: record.relative,
    title: record.title,
    section: /(^|\/)raw(\/|$)/i.test(record.relative) ? 'raw' : 'wiki',
    updated: record.stat.mtime.toISOString(),
    preview: plainText(record.content).slice(0, 180),
    links: record.links.length,
  }));
  return { generatedAt: new Date().toISOString(), total: records.length, items };
}

async function graphView({ prefix = '', limit = 120 } = {}, root = DEFAULT_VAULT) {
  const all = await vaultRecords(root);
  const records = prefix ? all.filter(record => record.relative.toLowerCase().startsWith(String(prefix).toLowerCase())) : all;
  const graph = graphFromRecords(records, limit);
  return { generatedAt: new Date().toISOString(), scope: prefix || '全部知识库', totalNodes: graph.nodes.length, ...graph };
}

function connectionsFromRecords(records, normalized, targetContent, limit = 6) {
  const targetId = normalized.replace(/\.md$/i, '').toLowerCase();
  const targetBase = path.basename(normalized, '.md').toLowerCase();
  const outgoing = [...new Set([...targetContent.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map(match => match[1].trim()))];
  const backlinks = records.filter(record => record.relative !== normalized && record.links.some(link => {
    const id = link.replace(/\.md$/i, '').replaceAll('\\', '/').toLowerCase();
    return id === targetId || path.basename(id) === targetBase;
  })).map(record => record.relative);
  const words = new Set(plainText(targetContent).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1).slice(0, 80));
  const related = records.filter(record => record.relative !== normalized).map(record => {
    const sample = new Set(plainText(record.content).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1).slice(0, 120));
    const overlap = [...words].filter(word => sample.has(word)).length;
    return { path: record.relative, score: overlap / Math.max(1, Math.sqrt(words.size * sample.size)), reason: '正文关键词重合' };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.min(20, Math.max(1, Number(limit) || 6)));
  return { note: normalized, outgoing, backlinks, related };
}

async function noteConnections({ path: relativePath, limit = 6 }, root = DEFAULT_VAULT) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  const targetFile = ensureInside(root, normalized);
  const targetContent = await fs.readFile(targetFile, 'utf8');
  return connectionsFromRecords(await vaultRecords(root), normalized, targetContent, limit);
}

async function vaultFilePaths(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORED.has(entry.name)) await visit(path.join(directory, entry.name));
      else if (entry.isFile()) files.push(path.relative(root, path.join(directory, entry.name)).split(path.sep).join('/'));
    }
  }
  await visit(root);
  return files;
}

function normalizeLocalReference(value) {
  let target = String(value || '').trim().replace(/^<|>$/g, '').replace(/\s+["'][^"']*["']\s*$/, '');
  if (!target || /^(?:https?:|data:|mailto:|#)/i.test(target)) return '';
  target = target.split('#')[0].split('?')[0];
  try { target = decodeURIComponent(target); } catch { /* retain the original path */ }
  return path.posix.normalize(target.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, ''));
}

export async function publicationAudit({ path: relativePath = '', title, content } = {}, root = DEFAULT_VAULT) {
  const source = String(content || '').replace(/\r\n?/g, '\n');
  if (source.length > 200000) throw apiError('草稿过长，请控制在 20 万字符以内', 'draft_too_large');
  const normalizedPath = String(relativePath || '').replaceAll('\\', '/');
  if (normalizedPath && (!normalizedPath.startsWith('06-Content/CSDN/') || !normalizedPath.toLowerCase().endsWith('.md'))) throw apiError('只能检查 CSDN 草稿目录', 'invalid_path');
  const cleanTitle = String(title || '').trim() || titleFromMarkdown(source, '');
  const { metadata, review, metadataIssues } = draftReadiness(cleanTitle, source);
  const records = await vaultRecords(root);
  const byId = new Map();
  for (const record of records) {
    byId.set(noteId(record.relative), record);
    if (!byId.has(path.basename(noteId(record.relative)))) byId.set(path.basename(noteId(record.relative)), record);
  }
  const resolveNote = target => byId.get(noteId(target)) || byId.get(path.basename(noteId(target)));

  const linkTargets = [];
  const assetTargets = [];
  for (const match of source.matchAll(/(!?)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    const target = match[2].trim();
    const extension = path.posix.extname(target).toLowerCase();
    if (extension && extension !== '.md') assetTargets.push({ target: normalizeLocalReference(target), type: 'wiki', rooted: false });
    else linkTargets.push(target);
  }
  for (const match of source.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim();
    const target = normalizeLocalReference(rawTarget);
    if (target) assetTargets.push({ target, type: 'markdown', rooted: /^<?\//.test(rawTarget) });
  }
  const coverTarget = normalizeLocalReference(metadata.cover);
  if (coverTarget) assetTargets.push({ target: coverTarget, type: 'markdown', rooted: /^<?\//.test(metadata.cover) });
  for (const match of source.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/gi)) {
    const target = normalizeLocalReference(match[1]);
    if (target) linkTargets.push(target);
  }

  const uniqueLinks = [...new Set(linkTargets)];
  const brokenLinks = [];
  const unpublishedLinks = [];
  for (const target of uniqueLinks) {
    const record = resolveNote(target);
    if (!record) {
      brokenLinks.push(target);
      continue;
    }
    const status = frontmatterValue(record.content, 'status').toLowerCase();
    const explicitlyPrivate = /^(idea|draft|review|构思|草稿|待审核)$/.test(status)
      || frontmatterBoolean(record.content, 'draft')
      || ['publish', 'share', 'dg-publish'].some(key => /^(false|no|0)$/i.test(frontmatterValue(record.content, key)));
    const explicitlyPublic = /^(published|已发布)$/.test(status)
      || frontmatterBoolean(record.content, 'published')
      || ['publish', 'share', 'dg-publish'].some(key => frontmatterBoolean(record.content, key))
      || /^(false|no|0)$/i.test(frontmatterValue(record.content, 'draft'));
    if (explicitlyPrivate || !explicitlyPublic) unpublishedLinks.push(target);
  }

  const uniqueAssets = [...new Map(assetTargets.filter(item => item.target).map(item => [`${item.type}:${item.rooted}:${item.target}`, item])).values()];
  const allFiles = uniqueAssets.length ? await vaultFilePaths(root) : [];
  const fileIds = new Set(allFiles.map(file => file.toLowerCase()));
  const fileBasenames = new Set(allFiles.map(file => path.posix.basename(file).toLowerCase()));
  const sourceDirectory = normalizedPath ? path.posix.dirname(normalizedPath) : '';
  const missingAssets = uniqueAssets.filter(item => {
    if (item.type === 'wiki') {
      return !fileIds.has(item.target.toLowerCase())
        && (item.target.includes('/') || !fileBasenames.has(path.posix.basename(item.target).toLowerCase()));
    }
    const candidate = item.rooted || !sourceDirectory ? item.target : path.posix.normalize(path.posix.join(sourceDirectory, item.target));
    return candidate.startsWith('../') || !fileIds.has(candidate.toLowerCase());
  }).map(item => item.target);

  let connections = { backlinks: [], related: [] };
  if (normalizedPath) {
    connections = connectionsFromRecords(records, normalizedPath, source, 5);
  }

  const blockers = [...review.blockers];
  const warnings = [...review.warnings, ...metadataIssues];
  const statusLabel = { idea: '构思', draft: '草稿', review: '待审核', ready: '可发布', published: '已发布' }[metadata.status] || metadata.status;
  if (!['ready', 'published'].includes(metadata.status)) blockers.push(`内容状态为“${statusLabel}”，尚未标记为可发布`);
  if (brokenLinks.length) blockers.push(`存在 ${brokenLinks.length} 个无法解析的内部链接`);
  if (missingAssets.length) blockers.push(`存在 ${missingAssets.length} 个缺失附件`);
  if (unpublishedLinks.length) blockers.push(`有 ${unpublishedLinks.length} 个内部链接尚未明确公开`);
  if (!metadata.reviewed) warnings.push('frontmatter 尚未标记 reviewed: true');
  if (!metadata.cover) warnings.push('缺少封面字段，图文平台需要发布前补图');
  if (/```(?:dataview|dataviewjs|query)/i.test(source)) warnings.push('仍包含 Obsidian 查询块，出站时只能降级为静态占位');
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)];
  const score = Math.max(0, 100 - uniqueBlockers.length * 18 - uniqueWarnings.length * 5);
  const platforms = Object.keys(PUBLISH_PLATFORMS).map(platform => {
    const prepared = preparePlatformPayload({ platform, title: cleanTitle, content: source });
    return {
      platform: prepared.platform,
      platformName: prepared.platformName,
      format: prepared.format,
      characters: prepared.characters,
      warnings: prepared.warnings,
      conversions: prepared.conversions,
      ready: uniqueBlockers.length === 0,
    };
  });
  return {
    ready: uniqueBlockers.length === 0,
    score,
    metadata: {
      status: metadata.status,
      title: Boolean(frontmatterValue(source, 'title')),
      summary: Boolean(metadata.summary),
      tags: metadata.tags,
      cover: Boolean(metadata.cover),
      reviewed: metadata.reviewed,
    },
    links: { total: uniqueLinks.length, resolved: uniqueLinks.length - brokenLinks.length, broken: brokenLinks, unpublished: unpublishedLinks, backlinks: connections.backlinks },
    assets: { total: uniqueAssets.length, existing: uniqueAssets.length - missingAssets.length, missing: missingAssets },
    blockers: uniqueBlockers,
    fixableBlockers: [...new Set(review.blockers)],
    warnings: uniqueWarnings,
    platforms,
    related: connections.related,
  };
}

function withPublicationStatus(content, status = 'ready') {
  const source = String(content || '');
  const match = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return source;
  const metadata = /^status:\s*.*$/mi.test(match[1])
    ? match[1].replace(/^status:\s*.*$/mi, `status: ${status}`)
    : `${match[1]}\nstatus: ${status}`;
  return `---\n${metadata}\n---${source.slice(match[0].length)}`;
}

function protectPublicationReferences(content, report) {
  let prefix = 'CJYPROTECTEDREF';
  while (String(content).includes(prefix)) prefix += 'X';
  const blocked = new Set([...report.links.broken, ...report.links.unpublished].map(noteId));
  const replacements = [];
  let convertedLinks = 0;
  const protect = replacement => {
    const token = `${prefix}${replacements.length}TOKEN`;
    replacements.push({ token, replacement });
    return token;
  };
  const wikiProtected = String(content).replace(/(!?)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (whole, embed, rawTarget, rawAlias) => {
    const target = String(rawTarget).trim();
    if (!embed && blocked.has(noteId(target))) {
      convertedLinks += 1;
      return protect(String(rawAlias || path.posix.basename(target).replace(/\.md$/i, '')).trim());
    }
    return protect(whole);
  });
  const markdownProtected = wikiProtected.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (whole, embed, label, rawTarget) => {
    const target = normalizeLocalReference(rawTarget);
    if (!embed && target && blocked.has(noteId(target))) {
      convertedLinks += 1;
      return protect(String(label).trim());
    }
    return protect(whole);
  });
  return {
    content: markdownProtected,
    convertedLinks,
    restore(value) {
      let restored = String(value);
      for (const { token, replacement } of replacements) {
        if (restored.split(token).length !== 2) throw apiError('AI 未能安全保留受保护的链接或附件，改写结果未应用', 'unsafe_ai_rewrite');
        restored = restored.replace(token, replacement);
      }
      return restored;
    },
  };
}

export async function repairPublicationDraft({ path: relativePath = '', title, content } = {}, root = DEFAULT_VAULT, apiKey = process.env.DEEPSEEK_API_KEY, complete = deepseekCompletion) {
  const source = String(content || '').replace(/\r\n?/g, '\n').trim();
  if (!source) throw apiError('正文不能为空', 'empty_draft');
  const before = await publicationAudit({ path: relativePath, title, content: source }, root);
  if (!before.blockers.length) return { content: source, review: reviewCsdnDraft({ title, content: source }), publicationReport: before, convertedLinks: 0, statusAdjusted: false };
  const statusAdjusted = Boolean(relativePath && !['ready', 'published'].includes(before.metadata.status));
  const statusReady = statusAdjusted ? withPublicationStatus(source) : source;
  const protectedDraft = protectPublicationReferences(statusReady, before);
  const issues = [
    ...before.fixableBlockers,
    protectedDraft.convertedLinks && '本机已把不可发布的内部链接转换为受保护标记；只修正上下文衔接，不得改动保护标记',
    before.assets.missing.length && '缺失附件已由本机隐藏为受保护标记；不得删除、移动或改动保护标记，也不得声称附件存在',
    statusAdjusted && '内容状态已在本机编辑区调整为可发布；不要修改正文事实',
  ].filter(Boolean);
  const fixed = await improveDraft({ title, content: protectedDraft.content, kind: 'fix', issues }, apiKey, complete);
  const repaired = protectedDraft.restore(fixed.content);
  const publicationReport = await publicationAudit({ path: relativePath, title, content: repaired }, root);
  return {
    content: repaired,
    review: reviewCsdnDraft({ title, content: repaired }),
    publicationReport,
    convertedLinks: protectedDraft.convertedLinks,
    statusAdjusted,
  };
}

async function askVault({ question, limit = 8 }, root = DEFAULT_VAULT, apiKey = process.env.DEEPSEEK_API_KEY) {
  const matches = await searchNotes(question, limit, root);
  const answer = await deepseekCompletion(
    '只依据提供的 Obsidian 检索结果回答。信息不足时明确说明，不得虚构。引用结论时标出对应笔记路径。',
    `问题：${String(question || '')}\n\n检索结果：\n${matches.map(item => `[${item.path}]\n${item.text}`).join('\n\n')}`,
    apiKey,
  );
  return { answer };
}

async function snapshot(root = DEFAULT_VAULT) {
  const records = await vaultRecords(root);
  const activity = new Map();
  let metadata = 0;
  const tasks = [];
  for (const record of records) {
    const day = record.stat.mtime.toISOString().slice(0, 10);
    activity.set(day, (activity.get(day) || 0) + 1);
    const head = record.content.slice(0, 2000);
    if (/^---[\s\S]*?^tags:/m.test(head) && /^---[\s\S]*?^created:/m.test(head)) metadata += 1;
    for (const line of record.content.split(/\r?\n/)) {
      const match = line.match(/^\s*-\s+\[([ xX])\]\s+(.+)/);
      if (!match) continue;
      const dueDate = match[2].match(/📅\s*(\d{4}-\d{2}-\d{2})/)?.[1] || null;
      const priority = /⏫|🔺/.test(match[2]) ? '高' : /⏬|🔽/.test(match[2]) ? '低' : '普通';
      const title = match[2].replace(/📅\s*\d{4}-\d{2}-\d{2}/gu, '').replace(/[⏫🔺⏬🔽]/gu, '').trim();
      tasks.push({ title, path: record.relative, done: match[1].toLowerCase() === 'x', dueDate, priority });
    }
  }
  const ids = new Set(records.flatMap(record => [record.relative.replace(/\.md$/i, '').toLowerCase(), path.basename(record.relative, '.md').toLowerCase()]));
  const incoming = new Map(records.map(record => [record.relative.replace(/\.md$/i, '').toLowerCase(), 0]));
  const brokenLinks = [];
  let linkTotal = 0;
  let validLinks = 0;
  for (const record of records) {
    for (const link of record.links) {
      linkTotal += 1;
      const id = link.replace(/\.md$/i, '').replaceAll('\\', '/').toLowerCase();
      if (!ids.has(id) && !ids.has(path.basename(id))) brokenLinks.push({ source: record.relative, target: link });
      else {
        validLinks += 1;
        const exact = records.find(item => item.relative.replace(/\.md$/i, '').toLowerCase() === id || path.basename(item.relative, '.md').toLowerCase() === path.basename(id));
        if (exact) {
          const exactId = exact.relative.replace(/\.md$/i, '').toLowerCase();
          incoming.set(exactId, (incoming.get(exactId) || 0) + 1);
        }
      }
    }
  }
  const days = Array.from({ length: 84 }, (_, index) => {
    const date = new Date(Date.now() - (83 - index) * 86400000).toISOString().slice(0, 10);
    return { date, count: activity.get(date) || 0 };
  });
  const metadataCoverage = Math.round(100 * metadata / Math.max(1, records.length));
  const linkIntegrity = linkTotal ? Math.round(100 * validLinks / linkTotal) : 100;
  const orphans = records.filter(record => !record.links.length && !(incoming.get(record.relative.replace(/\.md$/i, '').toLowerCase()) || 0)).map(record => record.relative).slice(0, 100);
  const staleBefore = Date.now() - 180 * 86400000;
  const stale = records.filter(record => record.stat.mtimeMs < staleBefore).sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs).map(record => record.relative).slice(0, 100);
  const recentNotes = records.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, 12).map(record => ({ name: record.title, path: record.relative, updated: record.stat.mtime.toISOString() }));
  const incompleteTasks = tasks.filter(task => !task.done).length;
  return {
    generatedAt: new Date().toISOString(), notes: records.length, chunks: 0,
    healthScore: Math.round((metadataCoverage + linkIntegrity) / 2), linkIntegrity, metadataCoverage,
    inboxCount: records.filter(record => record.relative.startsWith('00-收件箱/')).length,
    taskFlow: tasks.length ? Math.round(100 * (tasks.length - incompleteTasks) / tasks.length) : 0,
    tasks: tasks.slice(0, 100), recentNotes, activity: days,
    issues: { brokenLinks: brokenLinks.slice(0, 100), orphans, stale },
  };
}

async function route(action, data, root, apiKey) {
  if (action === 'search') return searchNotes(data.query, data.limit, root);
  if (action === 'writing_preflight') return writingPreflight(data, root);
  if (action === 'generate_csdn') return generateDraft(data, root, apiKey);
  if (action === 'revise_csdn') return reviseDraft(data, root, apiKey);
  if (action === 'improve_csdn') return improveDraft(data, apiKey);
  if (action === 'review_csdn') return reviewCsdnDraft(data);
  if (action === 'save_csdn') return saveDraft(data, root);
  if (action === 'prepare_csdn') return prepareCsdnPayload(data);
  if (action === 'prepare_platform') return preparePlatformPayload(data);
  if (action === 'publication_audit') return publicationAudit(data, root);
  if (action === 'repair_publication') return repairPublicationDraft(data, root, apiKey);
  if (action === 'publish_pack') return createPublishPack(data);
  if (action === 'closure_preview') return previewClosure(data, root);
  if (action === 'commit_closure') return commitClosure(data, root);
  if (action === 'list_csdn') return listDrafts(root);
  if (action === 'read_csdn') return readDraft(data.path, root);
  if (action === 'capture') return captureNote(data, root);
  if (action === 'clippings') return clippingsView(data, root);
  if (action === 'graph') return graphView(data, root);
  if (action === 'connections') return noteConnections(data, root);
  if (action === 'ask') return askVault(data, root, apiKey);
  if (action === 'index') { const state = await snapshot(root); return { mode: 'scan', changed_files: 0, written_chunks: 0, total_chunks: 0, total_notes: state.notes }; }
  if (action === 'brief') {
    const state = await snapshot(root);
    const incomplete = state.tasks.filter(task => !task.done).slice(0, 3);
    const priorities = [...incomplete.map(task => ({ kind: '任务', text: task.title })), ...(state.inboxCount ? [{ kind: '收件箱', text: `整理 ${state.inboxCount} 条待处理资料` }] : []), { kind: '创作', text: '继续一篇可审核的博客草稿' }].slice(0, 4);
    return { summary: priorities.length ? '以下事项来自当前 Obsidian 快照。' : '当前没有明确待办。', priorities, recentNotes: state.recentNotes.slice(0, 5) };
  }
  throw apiError('未知动作', 'unknown_action');
}

export function createBridge({ root = process.env.OBSIDIAN_VAULT, port = Number(process.env.WORKBENCH_PORT || DEFAULT_PORT), allowedOrigins = [], token = process.env.WORKBENCH_TOKEN || '', deepseekApiKey = process.env.DEEPSEEK_API_KEY || '' } = {}) {
  if (!root) throw apiError('未配置 Obsidian Vault，请使用 --vault 指定路径', 'vault_required');
  const vault = path.resolve(root);
  const origins = new Set(DEFAULT_ORIGINS);
  const configuredOrigins = [...String(process.env.WORKBENCH_ORIGINS || '').split(','), ...allowedOrigins].map(value => String(value).trim()).filter(Boolean);
  for (const origin of configuredOrigins) origins.add(normalizeOrigin(origin));
  const tokens = new Set(token ? [token] : []);
  const pairingNonces = new Map();
  let deepseekKey = deepseekApiKey;
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    const allowed = !origin || origins.has(origin);
    const send = (status, payload) => {
      const body = JSON.stringify(payload);
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...(origin && allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin' } : {}) });
      response.end(body);
    };
    const sendHtml = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'" });
      response.end(body);
    };
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      if (requestUrl.pathname === '/pair' && request.method === 'GET') {
        const requestedOrigin = normalizeOrigin(requestUrl.searchParams.get('origin'));
        if (!origins.has(requestedOrigin)) return sendHtml(403, pairingPage({ origin: requestedOrigin, vaultName: path.basename(vault), error: '来源未获允许' }));
        const returnTarget = requestUrl.searchParams.get('return') || '';
        if (returnTarget && normalizeOrigin(returnTarget) !== requestedOrigin) return sendHtml(403, pairingPage({ origin: requestedOrigin, vaultName: path.basename(vault), error: '返回地址与请求来源不一致' }));
        const nonce = randomBytes(18).toString('base64url');
        pairingNonces.set(nonce, { origin: requestedOrigin, returnTarget, expires: Date.now() + 5 * 60_000 });
        for (const [key, value] of pairingNonces) if (value.expires < Date.now()) pairingNonces.delete(key);
        return sendHtml(200, pairingPage({ origin: requestedOrigin, vaultName: path.basename(vault), nonce }));
      }
      if (requestUrl.pathname === '/pair' && request.method === 'POST') {
        const form = new URLSearchParams(await readRequestBody(request, 10_000));
        const nonce = form.get('nonce') || '';
        const requestedOrigin = normalizeOrigin(form.get('origin'));
        const pairing = pairingNonces.get(nonce);
        pairingNonces.delete(nonce);
        if (!pairing || pairing.expires < Date.now() || pairing.origin !== requestedOrigin || !origins.has(requestedOrigin)) return sendHtml(403, pairingPage({ origin: requestedOrigin, vaultName: path.basename(vault), error: '配对请求已失效' }));
        const pairedToken = randomBytes(24).toString('base64url');
        tokens.add(pairedToken);
        if (pairing.returnTarget) return sendHtml(200, pairingPage({ origin: requestedOrigin, vaultName: path.basename(vault), token: pairedToken, returnTarget: pairing.returnTarget }));
        return sendHtml(200, pairingPage({ origin: requestedOrigin, vaultName: path.basename(vault), token: pairedToken }));
      }
      if (request.method === 'OPTIONS') {
        if (!origin || !allowed) return send(403, { error: '来源未获允许', code: 'origin_not_allowed' });
        response.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Workbench-Token', 'Access-Control-Allow-Private-Network': 'true', 'Cache-Control': 'no-store', Vary: 'Origin' });
        return response.end();
      }
      if (!allowed) return send(403, { error: '来源未获允许', code: 'origin_not_allowed' });
      const suppliedToken = request.headers['x-workbench-token'];
      if (![...tokens].some(value => safeTokenEqual(suppliedToken, value))) return send(401, { error: '请先在工作台设置中完成本地配对', code: 'pairing_required' });
      const status = await vaultStatus(vault);
      if (request.method === 'GET' && requestUrl.pathname === '/health') return send(200, { connected: true, vault_name: path.basename(vault), ...status, deepseek_configured: Boolean(deepseekKey && deepseekKey !== 'YOUR_API_KEY_HERE') });
      if (!status.vault_exists || !status.obsidian_configured) return send(400, { error: '指定目录不是可用的 Obsidian Vault', code: 'invalid_vault' });
      if (request.method === 'GET' && requestUrl.pathname === '/snapshot') return send(200, await snapshot(vault));
      if (request.method !== 'POST' || requestUrl.pathname !== '/action') return send(404, { error: '未找到接口', code: 'not_found' });
      const data = JSON.parse(await readRequestBody(request) || '{}');
      if (data.action === 'configure_deepseek') {
        const key = String(data.apiKey || '').trim();
        if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(key)) throw apiError('DeepSeek API Key 格式不正确', 'invalid_deepseek_key');
        deepseekKey = key;
        return send(200, { ok: true, result: { configured: true } });
      }
      if (data.action === 'clear_deepseek') {
        deepseekKey = '';
        return send(200, { ok: true, result: { configured: false } });
      }
      send(200, { ok: true, result: await route(data.action, data, vault, deepseekKey) });
    } catch (error) {
      if (error.code === 'invalid_deepseek_key') deepseekKey = '';
      send(error.code === 'ENOENT' ? 404 : 400, { error: error.message, code: error.code || 'bad_request' });
    }
  });
  return { server, port, vault };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const values = name => process.argv.slice(2).flatMap((value, index, args) => value === name && args[index + 1] ? [args[index + 1]] : []);
  const root = values('--vault')[0] || process.env.OBSIDIAN_VAULT;
  try {
    const { server, port, vault } = createBridge({ root, allowedOrigins: values('--origin') });
    const status = await vaultStatus(vault);
    if (!status.vault_exists || !status.obsidian_configured) throw apiError('指定目录不是可用的 Obsidian Vault', 'invalid_vault');
    server.listen(port, '127.0.0.1', () => {
      console.log(`CJY Workbench Bridge: http://127.0.0.1:${port}`);
      console.log(`Obsidian Vault: ${path.basename(vault)}`);
      console.log('请在工作台设置中点击“连接自己的 Obsidian”完成授权。');
    });
  } catch (error) {
    console.error(`桥接启动失败：${error.message}`);
    console.error('用法：npm run bridge -- --vault "你的 Obsidian Vault 路径"');
    process.exitCode = 1;
  }
}
