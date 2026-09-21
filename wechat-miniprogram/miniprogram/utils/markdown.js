function cleanContent(value) {
  return String(value || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function noteTitle(fileName, content) {
  const source = cleanContent(content);
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const yamlTitle = frontmatter?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const heading = source.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').match(/^#\s+(.+)$/m)?.[1];
  return (yamlTitle || heading || String(fileName || '').replace(/\.(?:md|markdown|txt)$/i, '') || '未命名笔记').trim();
}

function extractTasks(content) {
  return cleanContent(content).split('\n').flatMap((line, index) => {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s+(.+)$/);
    if (!match) return [];
    const due = match[2].match(/📅\s*(\d{4}-\d{2}-\d{2})/)?.[1] || '';
    return [{ line: index + 1, done: match[1].toLowerCase() === 'x', text: match[2].replace(/📅\s*\d{4}-\d{2}-\d{2}/, '').trim(), due }];
  });
}

function makeNote(fileName, content, id = '') {
  const source = cleanContent(content);
  const yamlUpdated = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1].match(/^updated:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const updated = yamlUpdated && !Number.isNaN(Date.parse(yamlUpdated)) ? new Date(yamlUpdated).toISOString() : new Date().toISOString();
  return {
    id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: fileName || '未命名.md',
    title: noteTitle(fileName, source),
    content: source,
    characters: source.replace(/\s/g, '').length,
    updated,
    kind: /(?:^|\/)(?:Clippings|剪藏|00-收件箱)(?:\/|$)/i.test(fileName) || /^type:\s*(?:clipping|inbox)/mi.test(source) ? 'clipping' : 'note',
  };
}

function withoutFrontmatter(value) {
  return cleanContent(value).replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '');
}

function wikiLinks(value) {
  return [...cleanContent(value).matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map(match => match[1].trim());
}

function knowledgeStats(notes) {
  const byTitle = new Map(notes.map(note => [note.title.toLowerCase(), note]));
  const incoming = new Map(notes.map(note => [note.id, 0]));
  const edges = [];
  const brokenLinks = [];
  notes.forEach(note => wikiLinks(note.content).forEach(target => {
    const linked = byTitle.get(target.split('/').pop().replace(/\.md$/i, '').toLowerCase());
    if (!linked) return brokenLinks.push({ source: note.title, target });
    edges.push({ source: note.id, target: linked.id, sourceTitle: note.title, targetTitle: linked.title });
    incoming.set(linked.id, (incoming.get(linked.id) || 0) + 1);
  }));
  const orphans = notes.filter(note => !incoming.get(note.id) && !edges.some(edge => edge.source === note.id));
  const staleCutoff = Date.now() - 180 * 86400000;
  const stale = notes.filter(note => Date.parse(note.updated) < staleCutoff);
  const metadataCount = notes.filter(note => /^---\n[\s\S]*?\n---/m.test(note.content) && /^tags:\s*.+/mi.test(note.content)).length;
  const totalLinks = edges.length + brokenLinks.length;
  return {
    edges,
    brokenLinks,
    orphans,
    stale,
    metadataCoverage: notes.length ? Math.round(metadataCount / notes.length * 100) : 100,
    linkIntegrity: totalLinks ? Math.round(edges.length / totalLinks * 100) : 100,
  };
}

function obsidianToStandardMarkdown(value) {
  return withoutFrontmatter(value)
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/```(?:dataview|dataviewjs|query)[^\n]*\n[\s\S]*?```/gi, '> **需要手动补充：原 Obsidian 查询块已移除，请粘贴静态结果。**')
    .replace(/^>\s*\[!([a-z-]+)\][+-]?\s*(.*)$/gim, (_, kind, title) => `> **${kind.toUpperCase()}${title.trim() ? `：${title.trim()}` : ''}**`)
    .replace(/!\[\[([^\]]+)\]\]/g, (_, target) => `![${target.split('|')[0].split('/').pop()}](${target.split('|')[0].trim().replace(/ /g, '%20')})`)
    .replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
      const [path, alias] = target.split('|');
      return `[${(alias || path.split('/').pop()).replace('#', ' · ')}](${path.trim().replace(/ /g, '%20')})`;
    })
    .replace(/==([^=\n]+)==/g, '**$1**')
    .replace(/\s+\^[a-z0-9-]+$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function markdownToText(value) {
  const code = [];
  const protectedValue = String(value || '').replace(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g, (_, block, inline) => {
    code.push(block === undefined ? inline : `【代码】\n${block.trim()}\n【代码结束】`);
    return `\uE000${code.length - 1}\uE001`;
  });
  return protectedValue
    .replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '• ').replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1、').replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
    .replace(/^\s*\|(.+)\|\s*$/gm, (_, row) => row.split('|').map(cell => cell.trim()).join(' ｜ '))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `【图片：${alt || url}，请重新上传】`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1（$2）').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/~~([^~\n]+)~~/g, '$1').replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/<[^>\n]+>/g, '').replace(/\uE000(\d+)\uE001/g, (_, index) => code[Number(index)])
    .replace(/\n{3,}/g, '\n\n').trim();
}

function splitCards(value, maxLines = 16, maxCharacters = 18) {
  const lines = [];
  String(value || '').split('\n').forEach(rawLine => {
    const characters = Array.from(rawLine.trim());
    if (!characters.length) return lines.push('');
    for (let index = 0; index < characters.length; index += maxCharacters) lines.push(characters.slice(index, index + maxCharacters).join(''));
  });
  while (lines[lines.length - 1] === '') lines.pop();
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines).join('\n'));
  return (pages.length ? pages : ['']).slice(0, 18);
}

function preparePlatform(platform, title, content) {
  const markdown = obsidianToStandardMarkdown(content);
  const standard = /^#\s+/m.test(markdown) ? markdown : `# ${title}\n\n${markdown}`;
  const plain = markdownToText(standard);
  const names = { csdn: 'CSDN', juejin: '掘金', zhihu: '知乎', wechat: '微信公众号', xiaohongshu: '小红书' };
  const contentByPlatform = { csdn: standard, juejin: standard, zhihu: plain, wechat: plain, xiaohongshu: plain };
  const preparedTitle = platform === 'xiaohongshu' ? Array.from(title).slice(0, 20).join('') : title;
  return {
    platform,
    name: names[platform],
    title: preparedTitle,
    content: `${contentByPlatform[platform]}\n`,
    format: platform === 'xiaohongshu' ? '纯文本 + 图卡' : platform === 'zhihu' || platform === 'wechat' ? '富文本兼容稿' : '标准 Markdown',
    cardPages: platform === 'xiaohongshu' ? splitCards(plain) : [],
  };
}

function auditDraft(title, content) {
  const blockers = [];
  const warnings = [];
  if (!String(title || '').trim()) blockers.push('缺少标题');
  if (!String(content || '').trim()) blockers.push('缺少正文');
  if (/待补充|待确认|TODO/i.test(content)) blockers.push('正文包含待补充或 TODO');
  if (!/^---\n[\s\S]*?\n---/m.test(content)) warnings.push('缺少 YAML frontmatter');
  if (!/^##\s+/m.test(content)) warnings.push('正文没有二级标题');
  if (String(content || '').replace(/\s/g, '').length < 300) warnings.push('正文少于 300 字');
  return { ready: !blockers.length, blockers, warnings };
}

module.exports = {
  auditDraft,
  cleanContent,
  extractTasks,
  knowledgeStats,
  makeNote,
  markdownToText,
  noteTitle,
  obsidianToStandardMarkdown,
  preparePlatform,
  splitCards,
  wikiLinks,
};
