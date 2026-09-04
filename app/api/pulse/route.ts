type FeedItem = {
  title: string;
  url: string;
  source?: string;
  description?: string;
  stars?: number;
};

function decodeEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function rssItems(xml: string, source: string): FeedItem[] {
  return [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, 6).map((match) => {
    const block = match[0];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'Untitled';
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]
      || block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] || '#';
    return { title: decodeEntities(title), url: decodeEntities(link), source };
  });
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'SelfGrowingKnowledgeWorkbench/1.0' },
    next: { revalidate: 600 },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

export async function GET() {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [hn, githubBlog, repositories] = await Promise.allSettled([
    fetchText('https://hnrss.org/frontpage'),
    fetchText('https://github.blog/feed/'),
    fetch(`https://api.github.com/search/repositories?q=topic%3Aai-agent+created%3A%3E${since}&sort=stars&order=desc&per_page=6`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SelfGrowingKnowledgeWorkbench/1.0' },
      next: { revalidate: 600 },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      return response.json();
    }),
  ]);

  const rss = [
    ...(hn.status === 'fulfilled' ? rssItems(hn.value, 'Hacker News') : []),
    ...(githubBlog.status === 'fulfilled' ? rssItems(githubBlog.value, 'GitHub Blog') : []),
  ].slice(0, 8);

  const repositoryData = repositories.status === 'fulfilled'
    ? repositories.value as { items: Array<{ full_name: string; html_url: string; description: string | null; stargazers_count: number }> }
    : { items: [] };
  const github: FeedItem[] = repositories.status === 'fulfilled'
    ? repositoryData.items.map((item) => ({
      title: item.full_name,
      url: item.html_url,
      description: item.description || 'AI agent repository',
      stars: item.stargazers_count,
    }))
    : [];

  return Response.json({ updatedAt: new Date().toISOString(), rss, github }, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600' },
  });
}
