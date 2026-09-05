'use client';

import { useEffect, useState } from 'react';
import {
  Activity, BookOpen, Bot, CalendarDays, Check, CheckCircle2, Circle,
  Command, Database, ExternalLink, FileText, GitBranch, History, Inbox, Library, Link2, ListTodo,
  Network, Pin, PinOff, RefreshCw, Rss, Search, Settings, ShieldCheck, Sparkles,
  TriangleAlert, X,
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

type Task = { title: string; path: string; done: boolean; dueDate?: string | null; priority?: string };
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
type ClippingItem = { path: string; title: string; section: string; updated: string; preview: string; links: number };
type ClippingsData = { generatedAt: string; total: number; items: ClippingItem[] };
type GraphNode = { id: string; label: string; group: string; degree: number };
type GraphEdge = { source: string; target: string };
type GraphData = { generatedAt: string; scope: string; nodes: GraphNode[]; edges: GraphEdge[]; totalNodes: number; orphanCount: number };

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
    { title: '整理新增收件箱', path: '00-收件箱', done: false, dueDate: '2026-09-05', priority: '高' },
    { title: '更新向量索引', path: '20-项目/智能体工作台', done: false, dueDate: '2026-09-06', priority: '普通' },
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

function TaskRows({ tasks, isDone, onToggle, empty = '暂无任务' }: { tasks: Task[]; isDone(task: Task): boolean; onToggle(task: Task): void; empty?: string }) {
  if (!tasks.length) return <div className="plain-empty compact"><Check />{empty}</div>;
  return <div className="plain-task-list large">{tasks.map((task) => {
    const complete = isDone(task);
    return <button key={`${task.path}-${task.title}`} className={complete ? 'done' : ''} onClick={() => onToggle(task)} disabled={task.done}>
      {complete ? <CheckCircle2 /> : <Circle />}
      <span><strong>{task.title}</strong><small>{task.dueDate ? `${task.dueDate} · ${task.priority || '普通'}优先级 · ` : ''}{task.path}</small></span>
    </button>;
  })}</div>;
}

function obsidianUrl(path: string) {
  return `obsidian://open?vault=${encodeURIComponent('自生长知识库')}&file=${encodeURIComponent(path)}`;
}

function RelationGraph({ data, selected, onSelect }: { data: GraphData; selected: string; onSelect(path: string): void }) {
  const positions = new Map<string, { x: number; y: number }>();
  data.nodes.forEach((node, index) => {
    if (index === 0) {
      positions.set(node.id, { x: 450, y: 300 });
      return;
    }
    const ring = index <= 12 ? { start: 1, count: 12, radius: 105 } : index <= 40 ? { start: 13, count: 28, radius: 195 } : { start: 41, count: Math.max(1, data.nodes.length - 41), radius: 280 };
    const angle = ((index - ring.start) / ring.count) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.id, { x: 450 + Math.cos(angle) * ring.radius, y: 300 + Math.sin(angle) * ring.radius });
  });
  const selectedNode = data.nodes.find((node) => node.id === selected) || data.nodes[0];

  return <div className="plain-graph-layout">
    <div className="plain-graph-canvas">
      {data.nodes.length ? <svg viewBox="0 0 900 600" role="img" aria-label={`Clippings 关系图谱，共 ${data.nodes.length} 个节点`}>
        <g className="plain-graph-edges">{data.edges.map((edge) => {
          const source = positions.get(edge.source); const target = positions.get(edge.target);
          return source && target ? <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null;
        })}</g>
        <g>{data.nodes.map((node, index) => {
          const point = positions.get(node.id); if (!point) return null;
          const active = node.id === selectedNode?.id;
          return <g key={node.id} className={`plain-graph-node ${node.group === 'raw' ? 'raw' : 'wiki'} ${active ? 'active' : ''}`} role="button" tabIndex={0} aria-label={`${node.label}，${node.degree} 条关系`} onClick={() => onSelect(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(node.id); }}>
            <circle cx={point.x} cy={point.y} r={active ? 9 : Math.min(8, 4 + node.degree * 0.45)} />
            {(index < 10 || active) && <text x={point.x + 10} y={point.y - 8}>{node.label.slice(0, 18)}</text>}
          </g>;
        })}</g>
      </svg> : <div className="plain-empty"><Network />连接本地桥接后显示关系图谱</div>}
    </div>
    <aside className="plain-graph-detail">
      <span>当前节点</span>
      <strong>{selectedNode?.label || '尚未选择'}</strong>
      <small>{selectedNode?.id || '点击图中的节点查看信息'}</small>
      {selectedNode && <><p>{selectedNode.degree} 条显式 Wiki 链接关系</p><a href={obsidianUrl(selectedNode.id)}>在 Obsidian 打开<ExternalLink /></a></>}
      <div className="plain-graph-legend"><i className="wiki" />结构化知识<i className="raw" />原始剪藏</div>
    </aside>
  </div>;
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
  const [done, setDone] = useState<string[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  const [notice, setNotice] = useState('');
  const [clippings, setClippings] = useState<ClippingsData>({ generatedAt: '', total: 0, items: [] });
  const [graph, setGraph] = useState<GraphData>({ generatedAt: '', scope: 'Clippings', nodes: [], edges: [], totalNodes: 0, orphanCount: 0 });
  const [clipQuery, setClipQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState('');
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [pinnedNotes, setPinnedNotes] = useState<RecentNote[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

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

  const refreshKnowledgeViews = async (query = clipQuery) => {
    setKnowledgeLoading(true);
    try {
      const [libraryResponse, graphResponse] = await Promise.all([
        fetch(`${BRIDGE}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clippings', query, limit: 100 }) }),
        fetch(`${BRIDGE}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'graph', prefix: 'Clippings', limit: 120 }) }),
      ]);
      if (!libraryResponse.ok || !graphResponse.ok) throw new Error('读取失败');
      const libraryBody = await libraryResponse.json() as { result?: ClippingsData };
      const graphBody = await graphResponse.json() as { result?: GraphData };
      if (libraryBody.result) setClippings(libraryBody.result);
      if (graphBody.result) {
        setGraph(graphBody.result);
        setSelectedNode((current) => current || graphBody.result?.nodes[0]?.id || '');
      }
      setBridgeOnline(true);
    } catch {
      setNotice('无法读取 Clippings 与关系图谱，请先启动本地桥接。');
    } finally {
      setKnowledgeLoading(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const timer = window.setTimeout(() => {
      const hash = window.location.hash.replace('#', '');
      if (['overview', 'today', 'vault', 'clippings', 'graph', 'review', 'pulse'].includes(hash)) setTab(hash);
      try {
        const saved = JSON.parse(localStorage.getItem('workbench-task-state-v2') || '[]');
        setDone(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : []);
      } catch { setDone([]); }
      try {
        const saved = JSON.parse(localStorage.getItem('workbench-pinned-notes') || '[]');
        setPinnedNotes(Array.isArray(saved) ? saved : []);
      } catch { setPinnedNotes([]); }
      setNow(new Date());
      void refreshBridge();
      void refreshPulse();
      void refreshKnowledgeViews('');
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const changeTab = (value: string) => {
    setTab(value);
    window.history.replaceState(null, '', `#${value}`);
  };

  const taskKey = (task: Task) => `${task.path}\n${task.title}`;

  const isTaskDone = (task: Task) => task.done || done.includes(taskKey(task));

  const toggleTask = (task: Task) => {
    const key = taskKey(task);
    if (task.done) return;
    const next = done.includes(key) ? done.filter((item) => item !== key) : [...done, key];
    setDone(next);
    localStorage.setItem('workbench-task-state-v2', JSON.stringify(next));
  };

  const togglePinnedNote = (note: RecentNote) => {
    const next = pinnedNotes.some((item) => item.path === note.path)
      ? pinnedNotes.filter((item) => item.path !== note.path)
      : [...pinnedNotes, note].slice(-8);
    setPinnedNotes(next);
    localStorage.setItem('workbench-pinned-notes', JSON.stringify(next));
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

  const tasks = snapshot.tasks.slice(0, 12);
  const completed = tasks.filter(isTaskDone).length;
  const taskPercent = tasks.length ? Math.round(completed / tasks.length * 100) : snapshot.taskFlow;
  const updateCount = snapshot.activity.reduce((sum, day) => sum + day.count, 0);
  const clock = now ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(now) : '--:--';
  const date = now ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(now) : '正在读取日期';
  const todayIso = now ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now) : '';
  const datedTasks = tasks.filter((task) => task.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const overdueTasks = datedTasks.filter((task) => !isTaskDone(task) && String(task.dueDate) < todayIso);
  const todayTasks = datedTasks.filter((task) => !isTaskDone(task) && task.dueDate === todayIso);
  const upcomingTasks = datedTasks.filter((task) => !isTaskDone(task) && String(task.dueDate) > todayIso).slice(0, 6);
  const reviewCandidates = [...new Set([...snapshot.issues.stale, ...snapshot.issues.orphans])];
  const reviewPath = reviewCandidates.length ? reviewCandidates[reviewIndex % reviewCandidates.length] : '';
  const commandItems = [
    { label: '打开概览', detail: '回到知识库总览', run: () => changeTab('overview') },
    { label: '查看任务日程', detail: '查看今天、逾期和近期任务', run: () => changeTab('today') },
    { label: '查看固定笔记', detail: '回到概览中的固定笔记', run: () => changeTab('overview') },
    { label: '知识回顾', detail: '重新发现长期未更新或孤立笔记', run: () => changeTab('review') },
    { label: '搜索笔记', detail: '通过本地桥接检索知识库', run: () => openDialog('search') },
    { label: '存入收件箱', detail: '快速保存一条资料', run: () => openDialog('capture') },
    { label: '今日简报', detail: '生成当前行动建议', run: () => void runBrief() },
    { label: '更新索引', detail: '索引新增和变化的笔记', run: () => void runIndex() },
  ].filter((item) => `${item.label} ${item.detail}`.toLocaleLowerCase('zh-CN').includes(commandQuery.trim().toLocaleLowerCase('zh-CN')));

  return (
    <main className="plain-app">
      <aside className="plain-sidebar">
        <div className="plain-brand"><BookOpen /><div><strong>自生长知识库</strong><span>个人知识工作台</span></div></div>
        <Tabs value={tab} onValueChange={changeTab} orientation="vertical" className="plain-nav-tabs">
          <TabsList className="plain-nav" aria-label="工作台导航">
            <TabsTrigger value="overview"><Activity />概览</TabsTrigger>
            <TabsTrigger value="today"><ListTodo />今日</TabsTrigger>
            <TabsTrigger value="vault"><Database />知识库</TabsTrigger>
            <TabsTrigger value="clippings"><Library />剪藏</TabsTrigger>
            <TabsTrigger value="graph"><Network />图谱</TabsTrigger>
            <TabsTrigger value="review"><History />回顾</TabsTrigger>
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
            <Button variant="outline" onClick={() => { void refreshBridge(); void refreshKnowledgeViews(); }} disabled={syncing || knowledgeLoading}><RefreshCw className={syncing || knowledgeLoading ? 'spin' : ''} />刷新</Button>
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
          <Button variant="outline" onClick={() => setCommandOpen(true)}><Command />命令面板 <kbd>Ctrl K</kbd></Button>
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
                <div className="plain-list">{snapshot.recentNotes.slice(0, 6).map((note) => {
                  const pinned = pinnedNotes.some((item) => item.path === note.path);
                  return <div key={note.path}><FileText /><a href={obsidianUrl(note.path)}><strong>{note.name}</strong><small>{note.path}</small></a><time>{shortTime(note.updated)}</time><button aria-label={pinned ? `取消固定 ${note.name}` : `固定 ${note.name}`} onClick={() => togglePinnedNote(note)}>{pinned ? <PinOff /> : <Pin />}</button></div>;
                })}</div>
              </section>
              <section className="plain-block">
                <SectionTitle title="待办事项" note={`完成 ${taskPercent}%`} />
                <TaskRows tasks={tasks.slice(0, 6)} isDone={isTaskDone} onToggle={toggleTask} />
              </section>
            </div>

            <section className="plain-block plain-pinned">
              <SectionTitle title="固定笔记" note={`${pinnedNotes.length}/8`} />
              {pinnedNotes.length ? <div className="plain-pinned-grid">{pinnedNotes.map((note) => <article key={note.path}><Pin /><a href={obsidianUrl(note.path)}><strong>{note.name}</strong><small>{note.path}</small></a><button aria-label={`取消固定 ${note.name}`} onClick={() => togglePinnedNote(note)}><X /></button></article>)}</div> : <div className="plain-empty compact"><Pin />在“最近修改”中固定常用笔记</div>}
            </section>
          </TabsContent>

          <TabsContent value="today">
            <div className="plain-today-head"><div><span>{date}</span><strong>{clock}</strong></div><div><span>今日进度</span><strong>{completed}/{tasks.length}</strong><small>完成后会保存在当前浏览器</small></div></div>
            <div className="plain-agenda-grid">
              <section className="plain-block"><SectionTitle title="今天到期" note={`${todayTasks.length} 项`} /><TaskRows tasks={todayTasks} isDone={isTaskDone} onToggle={toggleTask} empty="今天没有到期任务" /></section>
              <section className="plain-block"><SectionTitle title="已逾期" note={`${overdueTasks.length} 项`} /><TaskRows tasks={overdueTasks} isDone={isTaskDone} onToggle={toggleTask} empty="没有逾期任务" /></section>
              <section className="plain-block"><SectionTitle title="接下来" note="按截止日期排序" /><TaskRows tasks={upcomingTasks} isDone={isTaskDone} onToggle={toggleTask} empty="暂无近期任务" /></section>
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

          <TabsContent value="clippings">
            <div className="plain-library-head">
              <div><strong>{clippings.generatedAt ? clippings.total : 90}</strong><span>篇 Clippings 内容</span><small>原文件保持在原目录，工作台只读展示</small></div>
              <form onSubmit={(event) => { event.preventDefault(); void refreshKnowledgeViews(clipQuery); }}><Input value={clipQuery} onChange={(event) => setClipQuery(event.target.value)} aria-label="检索 Clippings" placeholder="检索标题、正文或路径" /><Button type="submit" variant="outline" disabled={knowledgeLoading}><Search />检索</Button></form>
            </div>
            <div className="plain-clippings-list">{clippings.items.length ? clippings.items.map((item) => <article key={item.path}><div><Badge variant="outline">{item.section === 'raw' ? '原始资料' : '结构化知识'}</Badge><span>{item.links} 条链接</span><time>{shortTime(item.updated)}</time></div><h2>{item.title}</h2><p>{item.preview || '暂无可显示的摘要'}</p><footer><small>{item.path}</small><a href={obsidianUrl(item.path)}>在 Obsidian 打开<ExternalLink /></a></footer></article>) : <div className="plain-empty"><Library />连接本地桥接后显示 Clippings 内容</div>}</div>
          </TabsContent>

          <TabsContent value="graph">
            <div className="plain-graph-summary"><div><strong>{graph.generatedAt ? graph.totalNodes : 90}</strong><span>图谱节点</span></div><div><strong>{graph.edges.length}</strong><span>显式关系</span></div><div><strong>{graph.orphanCount}</strong><span>孤立节点</span></div><Button variant="outline" onClick={() => void refreshKnowledgeViews()} disabled={knowledgeLoading}><RefreshCw className={knowledgeLoading ? 'spin' : ''} />刷新图谱</Button></div>
            <RelationGraph data={graph} selected={selectedNode} onSelect={setSelectedNode} />
          </TabsContent>

          <TabsContent value="review">
            <div className="plain-review-focus">
              <div><span>本次回顾</span><strong>{reviewPath ? reviewPath.replace(/\.md$/, '').split('/').pop() : '暂无待回顾笔记'}</strong><small>{reviewPath || '当前没有长期未更新或孤立笔记'}</small></div>
              <div>{reviewPath && <a href={obsidianUrl(reviewPath)}>在 Obsidian 打开<ExternalLink /></a>}<Button variant="outline" onClick={() => setReviewIndex((index) => reviewCandidates.length ? (index + 1) % reviewCandidates.length : 0)} disabled={!reviewCandidates.length}><RefreshCw />换一篇</Button></div>
            </div>
            <div className="plain-two-columns">
              <section className="plain-block"><SectionTitle title="长期未更新" note={`${snapshot.issues.stale.length} 篇`} /><div className="plain-review-list">{snapshot.issues.stale.length ? snapshot.issues.stale.map((path) => <a href={obsidianUrl(path)} key={path}><History /><span><strong>{path.replace(/\.md$/, '').split('/').pop()}</strong><small>{path}</small></span><ExternalLink /></a>) : <div className="plain-empty compact"><Check />没有长期未更新笔记</div>}</div></section>
              <section className="plain-block"><SectionTitle title="孤立笔记" note={`${snapshot.issues.orphans.length} 篇`} /><div className="plain-review-list">{snapshot.issues.orphans.length ? snapshot.issues.orphans.map((path) => <a href={obsidianUrl(path)} key={path}><Network /><span><strong>{path.replace(/\.md$/, '').split('/').pop()}</strong><small>{path}</small></span><ExternalLink /></a>) : <div className="plain-empty compact"><Check />没有孤立笔记</div>}</div></section>
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

      <Dialog open={commandOpen} onOpenChange={setCommandOpen}>
        <DialogContent className="plain-dialog plain-command-dialog">
          <DialogHeader><DialogTitle>命令面板</DialogTitle><DialogDescription>搜索功能或直接跳转，快捷键 Ctrl K。</DialogDescription></DialogHeader>
          <Input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} aria-label="搜索命令" placeholder="输入命令名称" />
          <div className="plain-command-list">{commandItems.length ? commandItems.map((item) => <button key={item.label} onClick={() => { setCommandOpen(false); setCommandQuery(''); item.run(); }}><Command /><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>) : <div className="plain-empty compact">没有匹配命令</div>}</div>
        </DialogContent>
      </Dialog>

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
