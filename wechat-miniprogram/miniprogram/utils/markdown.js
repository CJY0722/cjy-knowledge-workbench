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
  return {
    id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: fileName || '未命名.md',
    title: noteTitle(fileName, source),
    content: source,
    characters: source.replace(/\s/g, '').length,
    updated: new Date().toISOString(),
  };
}

module.exports = { cleanContent, extractTasks, makeNote, noteTitle };
