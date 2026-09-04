'use client';

import { useEffect, useState } from 'react';
import {
  Activity, BookOpen, Bot, CalendarDays, Check, CheckCircle2, Circle,
  Database, FileText, GitBranch, Inbox, Link2, ListTodo, RefreshCw,
  Rss, Search, Settings, ShieldCheck, Sparkles, TriangleAlert, X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import './simple-workbench.css';

type Task = { title: string; path: string; done: boolean };
type RecentNote = { name: string; path: string; updated: string };
type ActivityDay = { date: string; count: number };
type Issue = { source: string; target: string };
type Snapshot = {
  generatedAt: string;
  notes: number;
  chunks: number;
  healthScore: number;
  linkIntegrity: number;
  metadataCoverage: number;
  inboxCount: number;
  taskFlow: number;
  tasks: Task[];
  recentNotes: RecentNote[];
  activity: ActivityDay[];
  issues: { brokenLinks: Issue[]; orphans: string[]; stale: string[] };
};
type FeedItem = { title: string; url: string; source?: string; description?: string; stars?: number };
type PulseData = { updatedAt: string; rss: FeedItem[]; github: FeedItem[] };
type DialogMode = 'research' | 'search' | 'capture' | 'connections' | 'brief' | null;
type ConnectionsResult = {
  note: string;
  outgoing: string[];
  backlinks: string[];
  related: Array<{ path: string; score: number; reason: string }>;
};
type DailyBrief = {
  summary: string;
  priorities: Array<{ kind: string; text: string }>;
  recentNotes: RecentNote[];
};

const BRIDGE = 'http://127.0.0.1:8765';
const fallbackBase = Date.UTC(2026, 8, 4);
const fallbackActivity = Array.from({ length: 84 }, (_, index) => ({
  date: new Date(fallbackBase - (83 - index) * 86400000).toISOString().slice(0, 10),
  count: [0, 0, 1, 0, 2, 0, 0, 3, 1, 0, 4, 0][index % 12],
}));

const fallbackSnapshot: Snapshot = {
  generatedAt: '2026-09-04T00:00:00+08:00', notes: 164, chunks: 3360,
  healthScore: 92, linkIntegrity: 99, metadataCoverage: 79, inboxCount: 2, taskFlow: 0,
  tasks: [
    { title: '整理新增收件箱', path: '00-收件箱', done: false },
    { title: '更新向量索引', path: '20-项目/智能体工作台', done: false },
    { title: '回流项目经验与方法', path: '40-资源', done: false },
  ],
  recentNotes: [
    { name: '知识库运行日志', path: '40-资源/知识库运行日志.md', updated: '2026-09-04T00:00:00+08:00' },
    { name: '知识库智能体操作中心', path: '30-领域/知识库智能体操作中心.md', updated: '2026-09-04T00:00:00+08:00' },
    { name: '知识库索引', path: '40-资源/知识库索引.md', updated: '2026-09-04T00:00:00+08:00' },
  ],
  activity: fallbackActivity,
  issues: { brokenLinks: [], orphans: [], stale: [] },
};

const fallbackPulse: PulseData = {
  updatedAt: '2026-09-04T00:00:00+08:00',
  rss: [
    { title: '本地优先知识系统的新实践', url: '#', source: '资讯订阅' },
    { title: '智能体工作流的近期进展', url: '#', source: '技术社区' },
  ],
  github: [
    { title: 'agentic-workbench', url: '#', description: '本地智能体工作台', stars: 1280 },
    { title: 'knowledge-graph-rag', url: '#', description: '面向笔记的知识图谱检索', stars: 842 },
  ],
};

const usage = [
  { name: '三小时额度', value: 16, detail: '32k / 200k' },
  { name: '本周额度', value: 38, detail: '1.9m / 5m' },
  { name: '本期额度', value: 57, detail: '14.2m / 25m' },
];

function shortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function activityLevel(count: number) {
  if (!count) return 0;
  if (count < 3) return 1;
  if (count < 8) return 2;
  if (count < 20) return 3;
  return 4;
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return <div className="plain-section-title"><h2>{title}</h2>{note && <span>{note}</span>}</div>;
}

function Score({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className="plain-score"><strong>{value}</strong><div><span>{label}</span><small>{note}</small></div></div>;
}

export function KnowledgeWorkbench() {
  const [snapshot, setSnapshot] = useState(fallbackSnapshot);
  const [pulse, setPulse] = useState(fallbackPulse);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pulseLoading, setPulseLoading] = useState(false);
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [notePath, setNotePath] = useState('');
  const [result, setResult] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [done, setDone] = useState<number[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  const [notice, setNotice] = useState('');

  const refreshBridge = async () => {
    setSyncing(true);
    try {
      const response = await fetch(`${BRIDGE}/snapshot`, { cache: 'no-store' });
      if (!response.ok) throw new Error('连接失败');
      setSnapshot(await response.json());
      setBridgeOnline(true);
    } catch {
      setBridgeOnline(false);
    } finally {
      setSyncing(false);
    }
  };

  const refreshPulse = async () => {
    setPulseLoading(true);
    try {
      const response = await fetch('/api/pulse', { cache: 'no-store' });
      if (!response.ok) throw new Error('更新失败');
      setPulse(await response.json());
    } catch {
      setNotice('资讯更新失败，当前显示最近一次可用内容。');
    } finally {
      setPulseLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const hash = window.location.hash.replace('#', '');
      if (['overview', 'today', 'vault', 'pulse'].includes(hash)) setTab(hash);
      try { setDone(JSON.parse(localStorage.getItem('workbench-task-state') || '[]')); } catch { setDone([]); }
      setNow(new Date());
      void refreshBridge();
      void refreshPulse();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const changeTab = (value: string) => {
    setTab(value);
    window.history.replaceState(null, '', `#${value}`);
  };

  const toggleTask = (index: number) => {
    const next = done.includes(index) ? done.filter((item) => item !== index) : [...done, index];
    setDone(next);
    localStorage.setItem('workbench-task-state', JSON.stringify(next));
  };

  const bridgeAction = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${BRIDGE}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json() as { error?: string; result?: unknown };
    if (!response.ok || data.error) throw new Error(data.error || '操作失败');
    return data.result;
  };

  const runIndex = async () => {
    setActionBusy(true);
    setNotice('正在更新本地索引...');
    try {
      const response = await bridgeAction({ action: 'index' }) as { changed_files?: number; written_chunks?: number; total_chunks?: number };
      setNotice(`索引已更新：处理 ${response.changed_files ?? 0} 篇变化笔记，新增 ${response.written_chunks ?? 0} 个片段。`);
      await refreshBridge();
    } catch {
      setNotice('无法连接本地桥接，请先启动桥接服务。');
    } finally {
      setActionBusy(false);
    }
  };

  const openDialog = (mode: DialogMode) => {
    setDialog(mode); setQuery(''); setTitle(''); setContent(''); setNotePath(''); setResult('');
  };

  const runBrief = async () => {
    openDialog('brief');
    setActionBusy(true);
    setResult('正在整理今日行动建议...');
    try {
      const brief = await bridgeAction({ action: 'brief' }) as DailyBrief;
      const priorities = brief.priorities.map((item, index) => `${index + 1}. [${item.kind}] ${item.text}`).join('\n');
      const recent = brief.recentNotes.map((item) => `- ${item.name}（${item.path}）`).join('\n');
      setResult(`${brief.summary}\n\n${priorities}\n\n最近修改\n${recent || '暂无最近修改'}`);
      setBridgeOnline(true);
    } catch (error) {
      setBridgeOnline(false);
      setResult(`本地桥接调用失败：${error instanceof Error ? error.message : '未知错误'}\n\n请先运行 start-dashboard-bridge.ps1`);
    } finally {
      setActionBusy(false);
    }
  };

  const submitDialog = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!dialog) return;
    setActionBusy(true); setResult('');
    try {
      if (dialog === 'research') {
        const answer = await bridgeAction({ action: 'ask', question: query, limit: 8 }) as string | { answer?: string };
        setResult(typeof answer === 'string' ? answer : answer.answer || JSON.stringify(answer, null, 2));
      } else if (dialog === 'search') {
        const matches = await bridgeAction({ action: 'search', query, limit: 8 }) as Array<{ path?: string; score?: number; text?: string }> | { results?: Array<{ path?: string; score?: number; text?: string }> };
        setResult((Array.isArray(matches) ? matches : matches.results || []).map((item) =>
          `${item.path || '未命名笔记'}${item.score ? `，相关度 ${Number(item.score).toFixed(3)}` : ''}\n${item.text || ''}`
        ).join('\n\n'));
      } else if (dialog === 'connections') {
        const connections = await bridgeAction({ action: 'connections', path: notePath, limit: 6 }) as ConnectionsResult;
        const outgoing = connections.outgoing.map((item) => `- ${item}`).join('\n') || '- 无';
        const backlinks = connections.backlinks.map((item) => `- ${item}`).join('\n') || '- 无';
        const related = connections.related.map((item) => `- ${item.path}，相关度 ${item.score.toFixed(3)}`).join('\n') || '- 暂无建议';
        setResult(`当前笔记\n${connections.note}\n\n出链\n${outgoing}\n\n反向链接\n${backlinks}\n\n建议连接\n${related}`);
      } else if (dialog === 'capture') {
        const saved = await bridgeAction({ action: 'capture', title, content, tags: ['待整理', '工作台采集'] }) as { path?: string };
        setResult(`已保存到收件箱\n${saved.path || JSON.stringify(saved)}`);
        await refreshBridge();
      }
      setBridgeOnline(true);
    } catch (error) {
      setBridgeOnline(false);
      setResult(`本地桥接调用失败：${error instanceof Error ? error.message : '未知错误'}\n\n请先运行 start-dashboard-bridge.ps1`);
    } finally {
      setActionBusy(false);
    }
  };

  const tasks = snapshot.tasks.slice(0, 6);
  const completed = Math.min(tasks.length, done.length);
  const taskPercent = tasks.length ? Math.round(completed / tasks.length * 100) : snapshot.taskFlow;
  const updateCount = snapshot.activity.reduce((sum, day) => sum + day.count, 0);
  const clock = now ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now) : '--:--';
  const date = now ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(now) : '正在读取日期';

  return (
    <main className="plain-app">
      <aside className="plain-sidebar">
        <div className="plain-brand"><BookOpen /><div><strong>自生长知识库</strong><span>个人知识工作台</span></div></div>
        <Tabs value={tab} onValueChange={changeTab} orientation="vertical" className="plain-nav-tabs">
          <TabsList className="plain-nav" aria-label="工作台导航">
            <TabsTrigger value="overview"><Activity />概览</TabsTrigger>
            <TabsTrigger value="today"><ListTodo />今日</TabsTrigger>
            <TabsTrigger value="vault"><Database />知识库</TabsTrigger>
            <TabsTrigger value="pulse"><Rss />资讯</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="plain-sidebar-bottom">
          <div className="plain-connection"><span className={bridgeOnline ? 'connected' : ''} /><div><strong>{bridgeOnline ? '本地桥接已连接' : '当前使用快照'}</strong><small>{bridgeOnline ? '实时读取本机知识库' : '点击刷新尝试连接'}</small></div></div>
          <button><Settings />设置</button>
        </div>
      </aside>

      <section className="plain-main">
        <header className="plain-header">
          <div><h1>知识工作台</h1><p>查看知识库状态，处理资料，调用本地智能体。</p></div>
          <div className="plain-header-actions">
            <Badge variant="outline" className={bridgeOnline ? 'plain-live' : 'plain-snapshot'}>{bridgeOnline ? '实时数据' : '本地快照'}</Badge>
            <span>更新于 {shortTime(snapshot.generatedAt)}</span>
            <Button variant="outline" onClick={refreshBridge} disabled={syncing}><RefreshCw className={syncing ? 'spin' : ''} />刷新</Button>
          </div>
        </header>

        <div className="plain-tools" aria-label="常用操作">
          <Button onClick={() => openDialog('research')}><Sparkles />深度研究</Button>
          <Button variant="outline" onClick={() => openDialog('search')}><Search />搜索笔记</Button>
          <Button variant="outline" onClick={() => openDialog('connections')} disabled={actionBusy}><Link2 />查看关联</Button>
          <Button variant="outline" onClick={() => void runBrief()} disabled={actionBusy}><CalendarDays />今日简报</Button>
          <Button variant="outline" onClick={() => openDialog('capture')}><Inbox />存入收件箱</Button>
          <Button variant="outline" onClick={runIndex} disabled={actionBusy}><Database />更新索引</Button>
          <Button variant="outline" onClick={() => { changeTab('pulse'); void refreshPulse(); }} disabled={pulseLoading}><Rss />更新资讯</Button>
        </div>

        {notice && <div className="plain-notice"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X /></button></div>}

        <Tabs value={tab} onValueChange={changeTab} className="plain-content-tabs">
          <TabsContent value="overview">
            <section className="plain-summary" aria-label="知识库摘要">
              <Score label="知识库健康度" value={snapshot.healthScore} note="整体运行稳定" />
              <Score label="笔记总数" value={snapshot.notes} note="已纳入统计" />
              <Score label="待整理资料" value={snapshot.inboxCount} note="位于收件箱" />
              <Score label="向量片段" value={snapshot.chunks} note="用于语义检索" />
            </section>

            <div className="plain-overview-grid">
              <section className="plain-block plain-activity">
                <SectionTitle title="知识活动" note={`最近 84 天，共更新 ${updateCount} 次`} />
                <div className="plain-heatmap">{snapshot.activity.map((day) => <i key={day.date} data-level={activityLevel(day.count)} title={`${day.date}：${day.count} 次更新`} />)}</div>
                <div className="plain-heatmap-legend"><span>较少</span>{[0, 1, 2, 3, 4].map((item) => <i key={item} data-level={item} />)}<span>较多</span></div>
              </section>

              <section className="plain-block plain-usage">
                <SectionTitle title="模型用量" note="仅作当前使用参考" />
                {usage.map((item) => <div className="plain-usage-row" key={item.name}><div><span>{item.name}</span><small>{item.detail}</small></div><strong>{item.value}%</strong><i><b style={{ width: `${item.value}%` }} /></i></div>)}
              </section>
            </div>

            <div className="plain-two-columns">
              <section className="plain-block">
                <SectionTitle title="最近修改" />
                <div className="plain-list">{snapshot.recentNotes.slice(0, 6).map((note) => <div key={note.path}><FileText /><span><strong>{note.name}</strong><small>{note.path}</small></span><time>{shortTime(note.updated)}</time></div>)}</div>
              </section>
              <section className="plain-block">
                <SectionTitle title="待办事项" note={`完成 ${taskPercent}%`} />
                <div className="plain-task-list">{tasks.map((task, index) => <button key={`${task.path}-${index}`} className={done.includes(index) ? 'done' : ''} onClick={() => toggleTask(index)}>{done.includes(index) ? <CheckCircle2 /> : <Circle />}<span><strong>{task.title}</strong><small>{task.path}</small></span></button>)}</div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="today">
            <div className="plain-today-head"><div><span>{date}</span><strong>{clock}</strong></div><div><span>今日进度</span><strong>{completed}/{tasks.length}</strong><small>完成后会保存在当前浏览器</small></div></div>
            <div className="plain-two-columns">
              <section className="plain-block"><SectionTitle title="今天要做" /><div className="plain-task-list large">{tasks.map((task, index) => <button key={`${task.title}-${index}`} className={done.includes(index) ? 'done' : ''} onClick={() => toggleTask(index)}>{done.includes(index) ? <CheckCircle2 /> : <Circle />}<span><strong>{task.title}</strong><small>{task.path}</small></span></button>)}</div></section>
              <section className="plain-block"><SectionTitle title="建议安排" /><div className="plain-schedule"><p><time>09:00</time><span><strong>更新知识索引</strong><small>扫描新增和变化的笔记</small></span></p><p><time>11:00</time><span><strong>整理收件箱</strong><small>保留原始资料，提炼可复用内容</small></span></p><p><time>15:00</time><span><strong>回流项目经验</strong><small>更新方法、模板和运行日志</small></span></p></div></section>
            </div>
            <section className="plain-bridge-box"><ShieldCheck /><div><strong>{bridgeOnline ? '本地桥接运行正常' : '本地桥接尚未连接'}</strong><p>桥接只提供统计、索引、检索、问答和收件箱新增，不允许删除、移动或执行任意命令。</p></div><Button variant="outline" onClick={refreshBridge}>检查连接</Button></section>
          </TabsContent>

          <TabsContent value="vault">
            <section className="plain-health"><Score label="健康度" value={snapshot.healthScore} note="综合评分" /><Score label="链接完整度" value={snapshot.linkIntegrity} note="双向链接检查" /><Score label="元数据覆盖" value={snapshot.metadataCoverage} note="标签与创建日期" /></section>
            <div className="plain-issues">
              <section className="plain-block"><SectionTitle title="失效链接" note={`${snapshot.issues.brokenLinks.length} 项`} /><div className="plain-issue-list">{snapshot.issues.brokenLinks.length ? snapshot.issues.brokenLinks.map((item) => <p key={`${item.source}-${item.target}`}><Link2 /><span><strong>{item.source}</strong><small>指向 [[{item.target}]]</small></span></p>) : <div className="plain-empty"><Check />未发现失效链接</div>}</div></section>
              <section className="plain-block"><SectionTitle title="孤立笔记" note={`${snapshot.issues.orphans.length} 项`} /><div className="plain-issue-list">{snapshot.issues.orphans.slice(0, 8).map((item) => <p key={item}><FileText /><span><strong>{item}</strong><small>尚未发现其他笔记链接到它</small></span></p>)}</div></section>
              <section className="plain-block"><SectionTitle title="长期未更新" note={`${snapshot.issues.stale.length} 项`} /><div className="plain-issue-list">{snapshot.issues.stale.length ? snapshot.issues.stale.map((item) => <p key={item}><CalendarDays /><span><strong>{item}</strong><small>超过 180 天未修改</small></span></p>) : <div className="plain-empty"><Check />暂无长期未更新笔记</div>}</div></section>
              <section className="plain-block"><SectionTitle title="元数据检查" /><div className="plain-empty warning"><TriangleAlert />仍有 {100 - snapshot.metadataCoverage}% 的笔记需要补充元数据</div></section>
            </div>
          </TabsContent>

          <TabsContent value="pulse">
            <div className="plain-pulse-summary"><div><strong>{pulse.rss.length}</strong><span>资讯条目</span></div><div><strong>{pulse.github.length}</strong><span>GitHub 项目</span></div><div><strong>{snapshot.inboxCount}</strong><span>待整理资料</span></div><Button variant="outline" onClick={refreshPulse} disabled={pulseLoading}><RefreshCw className={pulseLoading ? 'spin' : ''} />重新获取</Button></div>
            <div className="plain-two-columns">
              <section className="plain-block"><SectionTitle title="技术资讯" note={`更新于 ${shortTime(pulse.updatedAt)}`} /><div className="plain-feed">{pulse.rss.map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}><Rss /><span><strong>{item.title}</strong><small>{item.source || '资讯订阅'}</small></span></a>)}</div></section>
              <section className="plain-block"><SectionTitle title="GitHub 关注" note="近期 AI Agent 项目" /><div className="plain-feed">{pulse.github.map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}><GitBranch /><span><strong>{item.title}</strong><small>{item.description || 'GitHub 项目'}</small></span><b>{item.stars?.toLocaleString() || 0} 星</b></a>)}</div></section>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="plain-dialog">
          <form onSubmit={submitDialog}>
            <DialogHeader>
              <DialogTitle>{dialog === 'research' ? '深度研究' : dialog === 'search' ? '搜索知识库' : dialog === 'connections' ? '查看笔记关联' : dialog === 'brief' ? '今日简报' : '存入收件箱'}</DialogTitle>
              <DialogDescription>{dialog === 'capture' ? '只会在 00-收件箱中新建一篇笔记。' : dialog === 'connections' ? '只读分析出链、反向链接和未连接的相似笔记。' : dialog === 'brief' ? '根据当前知识库状态生成只读行动清单。' : '通过本地桥接访问你的 Obsidian 知识库。'}</DialogDescription>
            </DialogHeader>
            <div className="plain-dialog-fields">{dialog === 'capture' ? <><label htmlFor="capture-title">标题</label><Input id="capture-title" value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="输入资料标题" /><label htmlFor="capture-content">内容</label><Textarea id="capture-content" value={content} onChange={(event) => setContent(event.target.value)} required placeholder="粘贴需要长期保留的内容" rows={8} /></> : dialog === 'connections' ? <><label htmlFor="note-path">笔记路径</label><Input id="note-path" value={notePath} onChange={(event) => setNotePath(event.target.value)} required placeholder="例如：40-资源/知识库/概念/双向链接.md" /></> : dialog !== 'brief' ? <><label htmlFor="agent-query">{dialog === 'research' ? '研究问题' : '关键词或问题'}</label><Textarea id="agent-query" value={query} onChange={(event) => setQuery(event.target.value)} required placeholder={dialog === 'research' ? '例如：总结知识库中关于智能体记忆的关键结论' : '输入要查找的主题'} rows={4} /></> : null}{result && <pre className="plain-result">{result}</pre>}</div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialog(null)}>{dialog === 'brief' ? '关闭' : '取消'}</Button>{dialog !== 'brief' && <Button type="submit" disabled={actionBusy}>{actionBusy ? <RefreshCw className="spin" /> : dialog === 'capture' ? <Inbox /> : dialog === 'connections' ? <Link2 /> : <Bot />}{dialog === 'capture' ? '保存' : dialog === 'connections' ? '分析' : '开始'}</Button>}</DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
