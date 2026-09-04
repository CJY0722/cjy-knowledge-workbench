'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Archive, Bot, Box, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, Circle, Database, File,
  FileText, Folder, GitBranch, Globe2, Grid2X2, Inbox, Layers3, Link2,
  Menu, Network, PanelLeft, Plus, RefreshCw, Rss, Search, Settings,
  ShieldCheck, Sparkles, TerminalSquare, TriangleAlert, XCircle,
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
type DialogMode = 'research' | 'search' | 'capture' | null;

const BRIDGE = 'http://127.0.0.1:8765';
const fallbackBase = Date.UTC(2026, 8, 4);

const fallbackActivity = Array.from({ length: 84 }, (_, index) => ({
  date: new Date(fallbackBase - (83 - index) * 86400000).toISOString().slice(0, 10),
  count: [0, 0, 1, 0, 2, 0, 0, 3, 1, 0, 4, 0][index % 12],
}));

const fallbackSnapshot: Snapshot = {
  generatedAt: '2026-09-04T00:00:00+08:00', notes: 163, chunks: 3359,
  healthScore: 92, linkIntegrity: 99, metadataCoverage: 79,
  inboxCount: 2, taskFlow: 0,
  tasks: [
    { title: '整理新增收件箱', path: '00-收件箱', done: false },
    { title: '更新向量索引', path: '20-项目/智能体工作台', done: false },
    { title: '回流项目经验与方法', path: '40-资源', done: false },
  ],
  recentNotes: [
    { name: '知识库运行日志', path: '40-资源/知识库运行日志.md', updated: '2026-09-04T00:00:00+08:00' },
    { name: '知识库智能体操作中心', path: '30-领域/知识库智能体操作中心.md', updated: '2026-09-04T00:00:00+08:00' },
    { name: '知识库索引', path: '40-资源/知识库索引.md', updated: '2026-09-04T00:00:00+08:00' },
    { name: 'Obsidian主页升级视频', path: '40-资源/知识库/来源', updated: '2026-09-04T00:00:00+08:00' },
  ],
  activity: fallbackActivity,
  issues: { brokenLinks: [], orphans: [], stale: [] },
};

const folders = [
  ['00-收件箱', Inbox], ['10-日记', CalendarDays], ['20-项目', Layers3],
  ['30-领域', Grid2X2], ['40-资源', Database], ['90-归档', Archive],
] as const;

const tokenWindows = [
  { label: '3h rolling', value: 16, detail: '32k / 200k' },
  { label: 'Weekly', value: 38, detail: '1.9m / 5m' },
  { label: 'Billing cycle', value: 57, detail: '14.2m / 25m' },
];

const fallbackPulse: PulseData = {
  updatedAt: '2026-09-04T00:00:00+08:00',
  rss: [
    { title: 'Agent workflow patterns worth testing this week', url: '#', source: 'Hacker News' },
    { title: 'Local-first knowledge systems and durable memory', url: '#', source: 'GitHub Blog' },
  ],
  github: [
    { title: 'agentic-workbench', url: '#', description: 'A compact local agent workspace', stars: 1280 },
    { title: 'knowledge-graph-rag', url: '#', description: 'Graph-aware retrieval for notes', stars: 842 },
  ],
};

function shortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function activityLevel(count: number) {
  if (!count) return 0;
  if (count < 3) return 1;
  if (count < 8) return 2;
  if (count < 20) return 3;
  return 4;
}

function MetricCard({ label, value, hint, accent = 'coral' }: { label: string; value: string | number; hint: string; accent?: string }) {
  return (
    <article className={`metric-card accent-${accent}`}>
      <p>{label}</p><strong>{value}</strong><span>{hint}</span>
    </article>
  );
}

function Donut({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <article className="donut-card">
      <div className="donut" style={{ '--score': `${value * 3.6}deg`, '--donut-color': color } as React.CSSProperties}>
        <span>{value}</span>
      </div>
      <div><strong>{label}</strong><small>{value >= 90 ? 'Excellent' : value >= 75 ? 'Stable' : 'Needs attention'}</small></div>
    </article>
  );
}

export function WorkspaceDashboard() {
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
  const [result, setResult] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [done, setDone] = useState<number[]>([]);
  const [now, setNow] = useState(() => new Date(0));
  const [notice, setNotice] = useState('');

  const refreshBridge = async () => {
    setSyncing(true);
    try {
      const response = await fetch(`${BRIDGE}/snapshot`, { cache: 'no-store' });
      if (!response.ok) throw new Error('bridge unavailable');
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
      if (!response.ok) throw new Error('pulse unavailable');
      setPulse(await response.json());
    } catch {
      setNotice('资讯源暂时不可用，已保留最近快照。');
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
    if (!response.ok || data.error) throw new Error(data.error || 'Action failed');
    return data.result;
  };

  const runIndex = async () => {
    setActionBusy(true); setNotice('正在执行增量索引...');
    try {
      const response = await bridgeAction({ action: 'index' }) as { indexed?: number; chunks?: number; total_chunks?: number };
      setNotice(`索引完成：${response.indexed ?? 0} 篇更新，${response.chunks ?? response.total_chunks ?? 0} 个片段。`);
      await refreshBridge();
    } catch {
      setNotice('本地桥接未连接。请先运行 start-dashboard-bridge.ps1。');
    } finally { setActionBusy(false); }
  };

  const openDialog = (mode: DialogMode) => {
    setDialog(mode); setQuery(''); setTitle(''); setContent(''); setResult('');
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
          `${item.path || '未命名笔记'}${item.score ? `  ·  ${Number(item.score).toFixed(3)}` : ''}\n${item.text || ''}`
        ).join('\n\n'));
      } else {
        const saved = await bridgeAction({ action: 'capture', title, content, tags: ['待整理', '工作台采集'] }) as { path?: string };
        setResult(`已写入 00-收件箱\n${saved.path || JSON.stringify(saved)}`);
        await refreshBridge();
      }
      setBridgeOnline(true);
    } catch (error) {
      setBridgeOnline(false);
      setResult(`本地桥接调用失败：${error instanceof Error ? error.message : '未知错误'}\n\n先运行：.\\scripts\\start-dashboard-bridge.ps1`);
    } finally { setActionBusy(false); }
  };

  const visibleTasks = snapshot.tasks.slice(0, 6);
  const completed = Math.min(visibleTasks.length, done.length);
  const taskPercent = visibleTasks.length ? Math.round(completed / visibleTasks.length * 100) : snapshot.taskFlow;
  const maxActivity = Math.max(...snapshot.activity.map((day) => day.count), 1);
  const trend = useMemo(() => snapshot.activity.slice(-14).map((day) => Math.round(day.count / maxActivity * 100)), [snapshot.activity, maxActivity]);

  return (
    <main className="obsidian-app">
      <aside className="obsidian-ribbon" aria-label="Obsidian 工具栏">
        <button aria-label="菜单"><Menu /></button><button className="active" aria-label="工作台"><Grid2X2 /></button>
        <button aria-label="搜索" onClick={() => openDialog('search')}><Search /></button><button aria-label="知识图谱"><Network /></button>
        <button aria-label="新建笔记" onClick={() => openDialog('capture')}><Plus /></button>
        <div className="ribbon-spacer" /><button aria-label="设置"><Settings /></button>
      </aside>

      <aside className="file-tree">
        <div className="vault-title"><Box /><strong>自生长知识库</strong><ChevronDown /></div>
        <div className="tree-actions"><button><FileText /></button><button><Folder /></button><button><RefreshCw /></button></div>
        <nav className="folder-list" aria-label="知识库文件目录">
          {folders.map(([name, Icon], index) => (
            <button key={name} className={index === 2 ? 'selected' : ''}><ChevronRight /><Icon /><span>{name}</span></button>
          ))}
          <button><ChevronRight /><Folder /><span>attachments</span></button>
          <button><File /><span>AGENTS.md</span></button>
        </nav>
        <div className="tree-status"><span className={bridgeOnline ? 'status-dot online' : 'status-dot'} /><div><strong>{bridgeOnline ? 'LOCAL BRIDGE ONLINE' : 'SNAPSHOT MODE'}</strong><small>{bridgeOnline ? '127.0.0.1:8765' : '启动桥接以读取实时数据'}</small></div></div>
      </aside>

      <section className="editor-shell">
        <div className="editor-tabs"><button><PanelLeft /><span>知识库智能体操作中心</span><XCircle /></button><button className="active"><Grid2X2 /><span>Agent Dashboard</span><XCircle /></button><div className="editor-tab-space" /></div>

        <div className="dashboard-wrap">
          <header className="dashboard-header">
            <div><p>OBSIDIAN / AGENT WORKSPACE</p><h1>SELF-GROWING AGENT DASHBOARD</h1></div>
            <div className="sync-state"><Badge className={bridgeOnline ? 'live-badge' : 'snapshot-badge'}><span />{bridgeOnline ? 'LIVE' : 'SNAPSHOT'}</Badge><span>Last sync {shortTime(snapshot.generatedAt)}</span><Button variant="outline" size="sm" onClick={refreshBridge} disabled={syncing}><RefreshCw className={syncing ? 'spin' : ''} />Refresh</Button></div>
          </header>

          <Tabs value={tab} onValueChange={changeTab} className="workspace-tabs">
            <TabsList variant="line" className="main-tab-list">
              <TabsTrigger value="overview">OVERVIEW</TabsTrigger><TabsTrigger value="today">TODAY</TabsTrigger><TabsTrigger value="vault">VAULT</TabsTrigger><TabsTrigger value="pulse">PULSE</TabsTrigger>
            </TabsList>

            <div className="action-bar">
              <Button variant="outline" onClick={() => openDialog('research')}><Sparkles />DEEP RESEARCH</Button>
              <Button variant="outline" onClick={refreshPulse} disabled={pulseLoading}><Rss className={pulseLoading ? 'spin' : ''} />PULL RSS FEEDS</Button>
              <Button variant="outline" onClick={() => { changeTab('pulse'); void refreshPulse(); }}><GitBranch />GITHUB FEEDS</Button>
              <Button variant="outline" onClick={() => openDialog('capture')}><Inbox />INBOX INSERT</Button>
              <Button className="run-index" onClick={runIndex} disabled={actionBusy}><Database />RUN INDEX</Button>
            </div>

            {notice && <div className="notice"><TerminalSquare /><span>{notice}</span><button onClick={() => setNotice('')}><XCircle /></button></div>}

            <TabsContent value="overview" className="tab-panel">
              <section className="token-panel panel">
                <div className="panel-title"><div><span className="section-index">01</span><h2>TOKEN PLAN BURN</h2></div><strong>16%</strong></div>
                <div className="token-bars">{tokenWindows.map((item) => <div className="token-row" key={item.label}><span>{item.label}</span><div><i style={{ width: `${item.value}%` }} /></div><strong>{item.value}%</strong><small>{item.detail}</small></div>)}</div>
              </section>

              <section className="metrics-grid">
                <MetricCard label="VAULT HEALTH SCORE" value={snapshot.healthScore} hint={`${snapshot.notes} notes indexed`} accent="coral" />
                <MetricCard label="INBOX BACKLOG" value={snapshot.inboxCount} hint="Items awaiting triage" accent="yellow" />
                <MetricCard label="TASK FLOW" value={`${taskPercent}%`} hint={`${completed} / ${visibleTasks.length} complete`} accent="green" />
                <MetricCard label="VECTOR CHUNKS" value={snapshot.chunks.toLocaleString()} hint="Local semantic memory" accent="purple" />
              </section>

              <section className="activity-panel panel">
                <div className="panel-title"><div><span className="section-index">02</span><h2>KNOWLEDGE ACTIVITY</h2></div><span>LAST 84 DAYS</span></div>
                <div className="activity-layout"><div className="weekday-labels"><span>MON</span><span>WED</span><span>FRI</span></div><div className="heatmap">{snapshot.activity.map((day) => <i key={day.date} data-level={activityLevel(day.count)} title={`${day.date}: ${day.count} updates`} />)}</div></div>
                <div className="heatmap-foot"><span>{snapshot.activity.reduce((sum, day) => sum + day.count, 0)} note updates</span><div>LESS {[0, 1, 2, 3, 4].map((item) => <i key={item} data-level={item} />)} MORE</div></div>
              </section>

              <section className="overview-lower">
                <article className="panel recent-panel"><div className="panel-title"><div><span className="section-index">03</span><h2>RECENT NOTES</h2></div><FileText /></div><div className="dense-list">{snapshot.recentNotes.slice(0, 6).map((note) => <div key={note.path}><FileText /><span><strong>{note.name}</strong><small>{note.path}</small></span><time>{shortTime(note.updated)}</time></div>)}</div></article>
                <article className="panel queue-panel"><div className="panel-title"><div><span className="section-index">04</span><h2>AGENT QUEUE</h2></div><Bot /></div><div className="dense-list">{visibleTasks.map((task, index) => <button key={`${task.path}-${index}`} onClick={() => toggleTask(index)} className={done.includes(index) ? 'done' : ''}>{done.includes(index) ? <CheckCircle2 /> : <Circle />}<span><strong>{task.title}</strong><small>{task.path}</small></span></button>)}</div></article>
              </section>
            </TabsContent>

            <TabsContent value="today" className="tab-panel">
              <section className="today-layout">
                <article className="panel day-clock"><p>LOCAL TIME</p><strong>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}</strong><span>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now)}</span><div className="clock-orbit"><i /><Bot /></div></article>
                <article className="panel today-focus"><div className="panel-title"><div><span className="section-index">01</span><h2>TODAY FOCUS</h2></div><Badge>{completed}/{visibleTasks.length}</Badge></div><div className="task-stack">{visibleTasks.map((task, index) => <button key={`${task.title}-${index}`} onClick={() => toggleTask(index)} className={done.includes(index) ? 'done' : ''}>{done.includes(index) ? <CheckCircle2 /> : <Circle />}<span><strong>{task.title}</strong><small>{task.path}</small></span><ChevronRight /></button>)}</div></article>
              </section>
              <section className="today-bottom"><article className="panel timeline"><div className="panel-title"><div><span className="section-index">02</span><h2>AGENT TIMELINE</h2></div><Activity /></div>{['Refresh knowledge index', 'Review inbox material', 'Link reusable methods', 'Write operations log'].map((name, index) => <div className="timeline-row" key={name}><time>{String(9 + index * 2).padStart(2, '0')}:00</time><i /><span><strong>{name}</strong><small>{index === 0 ? 'Ready via local bridge' : 'Scheduled workflow'}</small></span></div>)}</article><article className="panel bridge-panel"><ShieldCheck /><h2>LOCAL BRIDGE</h2><strong>{bridgeOnline ? 'CONNECTED' : 'OFFLINE'}</strong><p>只允许读取统计、检索、Agent 问答、增量索引，以及向 00-收件箱新增笔记。</p><Button variant="outline" onClick={refreshBridge}><RefreshCw />CHECK CONNECTION</Button></article></section>
            </TabsContent>

            <TabsContent value="vault" className="tab-panel">
              <section className="vault-score-grid"><Donut label="VAULT HEALTH SCORE" value={snapshot.healthScore} color="#ff7d6a" /><Donut label="LINK INTEGRITY" value={snapshot.linkIntegrity} color="#75d6a2" /><Donut label="METADATA COVERAGE" value={snapshot.metadataCoverage} color="#e5b95d" /></section>
              <section className="vault-issues">
                <article className="panel issue-card"><div className="panel-title"><div><TriangleAlert /><h2>ZOMBIE FILES</h2></div><span>{snapshot.issues.stale.length}</span></div><div className="issue-list">{snapshot.issues.stale.length ? snapshot.issues.stale.map((item) => <p key={item}><File />{item}</p>) : <div className="empty-state"><Check />NO STALE FILES DETECTED</div>}</div></article>
                <article className="panel issue-card"><div className="panel-title"><div><Link2 /><h2>ORPHAN NOTES</h2></div><span>{snapshot.issues.orphans.length}</span></div><div className="issue-list">{snapshot.issues.orphans.slice(0, 7).map((item) => <p key={item}><File />{item}</p>)}</div></article>
                <article className="panel issue-card"><div className="panel-title"><div><FileText /><h2>MISSING FRONT MATTER</h2></div><span>{100 - snapshot.metadataCoverage}%</span></div><div className="empty-state amber"><TerminalSquare />RUN HEALTH REPORT FOR FULL LIST</div></article>
                <article className="panel issue-card"><div className="panel-title"><div><XCircle /><h2>BROKEN LINKS</h2></div><span>{snapshot.issues.brokenLinks.length}</span></div><div className="issue-list">{snapshot.issues.brokenLinks.map((item) => <p key={`${item.source}-${item.target}`}><Link2 /><span>{item.source}<small>→ [[{item.target}]]</small></span></p>)}</div></article>
              </section>
            </TabsContent>

            <TabsContent value="pulse" className="tab-panel">
              <section className="pulse-top">
                <article className="panel funnel"><div className="panel-title"><div><span className="section-index">01</span><h2>RESEARCH FUNNEL</h2></div><Globe2 /></div>{[['Captured', snapshot.inboxCount + pulse.rss.length + pulse.github.length], ['Triaged', snapshot.inboxCount], ['Synthesized', Math.max(0, snapshot.notes - snapshot.inboxCount)]].map(([label, value], index) => <div className="funnel-row" key={label as string}><span>{label}</span><div><i style={{ width: `${[100, 62, 38][index]}%` }} /></div><strong>{value}</strong></div>)}</article>
                <article className="panel source-mix"><div className="panel-title"><div><span className="section-index">02</span><h2>SOURCE MIX</h2></div><Rss /></div><div className="source-bars"><div><span>RSS / HN</span><i><b style={{ width: '56%' }} /></i><strong>{pulse.rss.length}</strong></div><div><span>GITHUB</span><i><b style={{ width: '44%' }} /></i><strong>{pulse.github.length}</strong></div><div><span>OBSIDIAN</span><i><b style={{ width: '84%' }} /></i><strong>{snapshot.notes}</strong></div></div></article>
                <article className="panel trend-matrix"><div className="panel-title"><div><span className="section-index">03</span><h2>AGENT TREND MATRIX</h2></div><Activity /></div><div className="mini-chart">{trend.map((value, index) => <i key={index} style={{ height: `${Math.max(8, value)}%` }} />)}</div><p><span>LOW SIGNAL</span><span>HIGH SIGNAL</span></p></article>
              </section>
              <section className="feed-grid">
                <article className="panel feed-panel"><div className="panel-title"><div><Rss /><h2>HACKER NEWS STREAM</h2></div><span>{shortTime(pulse.updatedAt)}</span></div>{pulse.rss.map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><small>{item.source || 'RSS feed'}</small></div><ChevronRight /></a>)}</article>
                <article className="panel feed-panel"><div className="panel-title"><div><GitBranch /><h2>GITHUB RADAR</h2></div><span>AI AGENT REPOS</span></div>{pulse.github.map((item, index) => <a href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><small>{item.description || 'GitHub repository'}</small></div><b>★ {item.stars?.toLocaleString() || 0}</b></a>)}</article>
              </section>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="agent-dialog">
          <form onSubmit={submitDialog}>
            <DialogHeader><DialogTitle>{dialog === 'research' ? 'DEEP RESEARCH' : dialog === 'search' ? 'SEARCH VAULT' : 'INBOX INSERT'}</DialogTitle><DialogDescription>{dialog === 'capture' ? '只会在 00-收件箱新增一篇 Markdown 笔记。' : '通过本地桥接访问你的私有 Obsidian 知识库。'}</DialogDescription></DialogHeader>
            <div className="dialog-fields">{dialog === 'capture' ? <><label htmlFor="capture-title">标题</label><Input id="capture-title" value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="资料标题" /><label htmlFor="capture-content">内容</label><Textarea id="capture-content" value={content} onChange={(event) => setContent(event.target.value)} required placeholder="粘贴需要长期保留的内容" rows={8} /></> : <><label htmlFor="agent-query">{dialog === 'research' ? '研究问题' : '检索关键词'}</label><Textarea id="agent-query" value={query} onChange={(event) => setQuery(event.target.value)} required placeholder={dialog === 'research' ? '例如：总结知识库中关于 Agent memory 的关键结论' : '输入主题、概念或问题'} rows={4} /></>}{result && <pre className="dialog-result">{result}</pre>}</div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialog(null)}>CANCEL</Button><Button type="submit" disabled={actionBusy}>{actionBusy ? <RefreshCw className="spin" /> : dialog === 'capture' ? <Inbox /> : <Bot />}{dialog === 'capture' ? 'SAVE TO INBOX' : 'RUN AGENT'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
