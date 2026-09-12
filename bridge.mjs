import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_VAULT = 'E:\\ObsidianVault';
const DEFAULT_PORT = 8766;
const ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
const IGNORED = new Set(['.obsidian', '.git', 'node_modules', '.data']);

function apiError(message, code = 'bad_request') {
  const error = new Error(message);
  error.code = code;
  return error;
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

export function prepareCsdnPayload({ title, content }) {
  const cleanTitle = String(title || '').trim();
  const source = String(content || '').replace(/\r\n?/g, '\n');
  if (!cleanTitle || !source.trim()) throw apiError('标题和正文不能为空');
  if (source.length > 200000) throw apiError('草稿过长，请控制在 20 万字符以内', 'draft_too_large');

  const warnings = [];
  if (/!\[\[[^\]]+\]\]/.test(source)) warnings.push('Obsidian 附件不会自动上传，已在正文中标记待重新上传');
  if (/!\[[^\]]*\]\((?!https?:\/\/|data:)[^)]+\)/i.test(source)) warnings.push('检测到本地 Markdown 图片，请在 CSDN 中重新上传');
  if (/待补充|待确认|TODO/i.test(source)) warnings.push('正文仍包含待补充或待确认标记');

  let markdown = withoutFrontmatter(source)
    .replace(/!\[\[([^\]]+)\]\]/g, (_, target) => `> ⚠️ 请在 CSDN 重新上传 Obsidian 附件：${target}`)
    .replace(/\[\[([^\]]+)\]\]/g, (_, value) => {
      const [target, alias] = value.split('|');
      if (alias?.trim()) return alias.trim();
      return target.trim().split('/').at(-1).replace('#', ' · ');
    })
    .trim();
  if (!/^#\s+/m.test(markdown)) markdown = `# ${cleanTitle}\n\n${markdown}`;
  return {
    title: cleanTitle,
    content: `${markdown}\n`,
    characters: markdown.replace(/\s/g, '').length,
    warnings,
    editorUrl: 'https://editor.csdn.net/md/'
  };
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
  return `---\ntitle: ${JSON.stringify(title)}\ntype: Content\ncreated: ${date}\nupdated: ${date}\nsource: ${source}\nsource_type: knowledge\ntopics: [CSDN]\ntags: [CSDN, 草稿]\nstatus: draft\nconfidence: 0.6\nai_generated: ${aiGenerated}\nreviewed: false\n---`;
}

function templateBody(title, sourcePath, sourceContent, instruction) {
  const excerpt = withoutFrontmatter(sourceContent).slice(0, 5000);
  return `# ${title}\n\n> 写作要求：${instruction || '面向学生读者，保留来源，不虚构结果。'}\n\n## 先说结论\n\n待补充：用 2～3 句话说明这篇文章解决什么问题。\n\n## 背景与目标\n\n本文基于 [[${sourcePath.replace(/\.md$/i, '')}]] 整理。请在发布前核对原始资料。\n\n## 来源笔记要点\n\n${excerpt || '待补充：来源笔记暂无正文。'}\n\n## 实践步骤\n\n- 待补充：环境与前置条件\n- 待补充：核心操作\n- 待补充：验证方法\n\n## 常见问题\n\n待补充：只记录真实遇到或来源明确的问题。\n\n## 总结\n\n待补充：回顾结论，并给出可执行的下一步。`;
}

async function generateWithOpenAI(sourcePath, sourceContent, instruction, writingContext = '', revise = false) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'YOUR_API_KEY_HERE') throw apiError('尚未配置 OPENAI_API_KEY', 'openai_not_configured');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      store: false,
      instructions: revise
        ? '你是严谨的中文技术编辑。保留用户原文的结构、文风与事实含义，只按要求修改；资料不足处标记“待确认”。不得虚构运行结果、踩坑、数据或经验。输出完整 Markdown，不要输出 YAML frontmatter。'
        : '你是严谨的 CSDN 技术写作助手。只依据给定知识源写中文 Markdown；资料不足处标记“待确认”。不得虚构代码运行结果、踩坑经历、数据或个人经验。解释关键代码并保留来源 WikiLink。不要输出 YAML frontmatter。',
      input: `写作要求：${instruction}\n来源路径：${sourcePath}\n\n知识源：\n${sourceContent.slice(0, 30000)}\n\n已检索的协作偏好与博客索引：\n${writingContext.slice(0, 10000)}`
    })
  });
  const data = await response.json();
  if (!response.ok) throw apiError(data?.error?.message || 'OpenAI 生成失败', 'openai_failed');
  const text = data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!text) throw apiError('OpenAI 未返回正文', 'empty_generation');
  return withoutFrontmatter(text);
}

export async function generateDraft({ sourcePath, instruction = '', useAi = false, preflightConfirmed = false }, root = DEFAULT_VAULT) {
  if (preflightConfirmed !== true) throw apiError('生成初稿前必须完成知识库预检', 'preflight_required');
  const source = ensureInside(root, sourcePath);
  if (path.extname(source).toLowerCase() !== '.md') throw apiError('知识源必须是 Markdown 文件', 'invalid_source');
  const sourceContent = await fs.readFile(source, 'utf8');
  const sourceTitle = titleFromMarkdown(sourceContent, path.basename(source, '.md'));
  const title = sourceTitle;
  const preflight = await writingPreflight({ topic: title }, root);
  const context = writingContext(preflight);
  const body = useAi ? await generateWithOpenAI(sourcePath, sourceContent, instruction, context) : templateBody(title, sourcePath, sourceContent, instruction);
  return { title, content: `${frontmatter(title, sourcePath, useAi)}\n\n${body.trim()}\n`, source: { path: sourcePath, title: sourceTitle }, mode: useAi ? 'ai' : 'template' };
}

export async function reviseDraft({ title, content, instruction = '', useAi = true, preflightConfirmed = false }, root = DEFAULT_VAULT) {
  if (preflightConfirmed !== true) throw apiError('修改初稿前必须完成知识库预检', 'preflight_required');
  const cleanTitle = String(title || '').trim() || titleFromMarkdown(String(content || ''), '未命名文章');
  if (!String(content || '').trim()) throw apiError('已有文章不能为空');
  const preflight = await writingPreflight({ topic: cleanTitle }, root);
  const context = writingContext(preflight);
  const body = useAi ? await generateWithOpenAI('用户已有文章', withoutFrontmatter(String(content)), instruction, context, true) : withoutFrontmatter(String(content));
  return { title: cleanTitle, content: `${frontmatter(cleanTitle, '', useAi)}\n\n${body.trim()}\n`, mode: useAi ? 'ai-revise' : 'unchanged' };
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
  const normalized = `${String(content).trim()}\n`;
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
      items.push({ path: `06-Content/CSDN/${entry.name}`, title: titleFromMarkdown(content, path.basename(entry.name, '.md')), updated: stat.mtime.toISOString(), mtime: String(stat.mtimeMs) });
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

async function noteConnections({ path: relativePath, limit = 6 }, root = DEFAULT_VAULT) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  const targetFile = ensureInside(root, normalized);
  const targetContent = await fs.readFile(targetFile, 'utf8');
  const targetId = normalized.replace(/\.md$/i, '').toLowerCase();
  const targetBase = path.basename(normalized, '.md').toLowerCase();
  const records = await vaultRecords(root);
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

async function askVault({ question, limit = 8 }, root = DEFAULT_VAULT) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'YOUR_API_KEY_HERE') throw apiError('尚未配置 OPENAI_API_KEY', 'openai_not_configured');
  const matches = await searchNotes(question, limit, root);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      store: false,
      instructions: '只依据提供的 Obsidian 检索结果回答。信息不足时明确说明，不得虚构。引用结论时标出对应笔记路径。',
      input: `问题：${String(question || '')}\n\n检索结果：\n${matches.map(item => `[${item.path}]\n${item.text}`).join('\n\n')}`,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw apiError(data?.error?.message || 'OpenAI 问答失败', 'openai_failed');
  const answer = data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!answer) throw apiError('OpenAI 未返回答案', 'empty_generation');
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

async function route(action, data, root) {
  if (action === 'search') return searchNotes(data.query, data.limit, root);
  if (action === 'writing_preflight') return writingPreflight(data, root);
  if (action === 'generate_csdn') return generateDraft(data, root);
  if (action === 'revise_csdn') return reviseDraft(data, root);
  if (action === 'review_csdn') return reviewCsdnDraft(data);
  if (action === 'save_csdn') return saveDraft(data, root);
  if (action === 'prepare_csdn') return prepareCsdnPayload(data);
  if (action === 'publish_pack') return createPublishPack(data);
  if (action === 'closure_preview') return previewClosure(data, root);
  if (action === 'commit_closure') return commitClosure(data, root);
  if (action === 'list_csdn') return listDrafts(root);
  if (action === 'read_csdn') return readDraft(data.path, root);
  if (action === 'capture') return captureNote(data, root);
  if (action === 'clippings') return clippingsView(data, root);
  if (action === 'graph') return graphView(data, root);
  if (action === 'connections') return noteConnections(data, root);
  if (action === 'ask') return askVault(data, root);
  if (action === 'index') { const state = await snapshot(root); return { mode: 'scan', changed_files: 0, written_chunks: 0, total_chunks: 0, total_notes: state.notes }; }
  if (action === 'brief') {
    const state = await snapshot(root);
    const incomplete = state.tasks.filter(task => !task.done).slice(0, 3);
    const priorities = [...incomplete.map(task => ({ kind: '任务', text: task.title })), ...(state.inboxCount ? [{ kind: '收件箱', text: `整理 ${state.inboxCount} 条待处理资料` }] : []), { kind: '创作', text: '继续一篇可审核的博客草稿' }].slice(0, 4);
    return { summary: priorities.length ? '以下事项来自当前 Obsidian 快照。' : '当前没有明确待办。', priorities, recentNotes: state.recentNotes.slice(0, 5) };
  }
  throw apiError('未知动作', 'unknown_action');
}

export function createBridge({ root = process.env.OBSIDIAN_VAULT || DEFAULT_VAULT, port = Number(process.env.WORKBENCH_PORT || DEFAULT_PORT) } = {}) {
  const vault = path.resolve(root);
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    const allowed = ORIGINS.has(origin);
    const send = (status, payload) => {
      const body = JSON.stringify(payload);
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin' } : {}) });
      response.end(body);
    };
    if (request.method === 'OPTIONS') {
      if (!allowed) return send(403, { error: '来源未获允许', code: 'origin_not_allowed' });
      response.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin' });
      return response.end();
    }
    try {
      if (request.method === 'GET' && request.url === '/health') return send(200, { connected: true, vault, vault_exists: await fs.stat(vault).then(stat => stat.isDirectory()).catch(() => false), openai_configured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'YOUR_API_KEY_HERE') });
      if (request.method === 'GET' && request.url === '/snapshot') return send(200, await snapshot(vault));
      if (request.method !== 'POST' || request.url !== '/action') return send(404, { error: '未找到接口', code: 'not_found' });
      if (!allowed) return send(403, { error: '来源未获允许', code: 'origin_not_allowed' });
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > 2_000_000) throw apiError('请求内容过大', 'payload_too_large');
      }
      const data = JSON.parse(raw || '{}');
      send(200, { ok: true, result: await route(data.action, data, vault) });
    } catch (error) { send(error.code === 'ENOENT' ? 404 : 400, { error: error.message, code: error.code || 'bad_request' }); }
  });
  return { server, port, vault };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, port, vault } = createBridge();
  server.listen(port, '127.0.0.1', () => console.log(`CJY Workbench Bridge: http://127.0.0.1:${port} -> ${vault}`));
}
