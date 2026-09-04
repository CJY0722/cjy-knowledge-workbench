import {
  Archive, Bot, Braces, Check, ChevronRight, CircleDot, Database,
  FileText, GitBranch, LockKeyhole, Network, NotebookTabs, RefreshCw,
  Search, ServerCog, Sparkles, TimerReset,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WorkspaceDashboard } from './workspace-dashboard';

const tools = [
  { icon: Search, name: '语义检索', detail: '从 3357 个向量片段中找回上下文' },
  { icon: FileText, name: '安全读取', detail: '只读取知识库内的 Markdown 文件' },
  { icon: RefreshCw, name: '增量索引', detail: '只处理新增或变化的笔记' },
  { icon: Archive, name: '资料采集', detail: '新内容仅进入 00-收件箱' },
  { icon: Bot, name: 'Agent 问答', detail: '检索后生成带来源的答案' },
  { icon: ServerCog, name: '健康检查', detail: '确认路径、索引与连接状态' },
];

const flow = [
  { icon: NotebookTabs, label: 'Obsidian', note: '唯一长期记忆' },
  { icon: Braces, label: 'Python', note: '索引与 Agent' },
  { icon: Database, label: 'Vector DB', note: 'SQLite 本地持久化' },
  { icon: Network, label: 'MCP', note: '六个标准工具' },
  { icon: TimerReset, label: 'Scheduler', note: '按需自动更新' },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" aria-label="回到主页操作台">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span><strong>生长台</strong><small>KNOWLEDGE OS</small></span>
        </a>
        <nav aria-label="页面导航">
          <a className="nav-link active" href="#dashboard"><CircleDot />主页操作台</a>
          <a className="nav-link" href="#overview"><Sparkles />运行概览</a>
          <a className="nav-link" href="#architecture"><Network />系统链路</a>
          <a className="nav-link" href="#tools"><Braces />MCP 工具</a>
          <a className="nav-link" href="#privacy"><LockKeyhole />隐私边界</a>
        </nav>
        <div className="sidebar-foot">
          <span className="online-dot" />
          <span><strong>本地核心已就绪</strong><small>网站不读取私人笔记</small></span>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div><p className="eyebrow">第二大脑 / 工作台</p><h1>自生长知识库</h1></div>
          <Badge variant="outline" className="status-badge"><Check /> MCP 已连接</Badge>
        </header>

        <WorkspaceDashboard />

        <section id="overview" className="overview-grid">
          <div className="intro-panel">
            <div className="signal-line"><span>LOCAL-FIRST AGENT WORKBENCH</span><i /></div>
            <h2>让知识在使用中，<br /><em>持续生长。</em></h2>
            <p>Obsidian 保存长期记忆，Python 负责理解与检索，MCP 把能力交给 Agent。云端只展示工作台状态，不上传你的知识正文。</p>
            <div className="capability-row">
              <span><LockKeyhole /> 隐私优先</span>
              <span><GitBranch /> Git 可追溯</span>
              <span><Database /> 本地向量库</span>
            </div>
          </div>

          <Card className="status-card">
            <CardHeader>
              <div><CardDescription>最近验证快照</CardDescription><CardTitle>系统运行正常</CardTitle></div>
              <span className="pulse"><i /></span>
            </CardHeader>
            <CardContent>
              <div className="metric-grid">
                <div><strong>163</strong><span>已索引笔记</span></div>
                <div><strong>3,359</strong><span>向量片段</span></div>
                <div><strong>6</strong><span>MCP 工具</span></div>
                <div><strong>3/3</strong><span>测试通过</span></div>
              </div>
              <div className="snapshot-note"><Check size={15} /><span>原有笔记未修改，调度器保持手动启用</span></div>
            </CardContent>
          </Card>
        </section>

        <section id="architecture" className="section-block">
          <div className="section-heading">
            <div><p className="eyebrow">SYSTEM FLOW</p><h2>一条可验证的知识链路</h2></div>
            <p>资料从进入收件箱到被 Agent 调用，全程留在本地。</p>
          </div>
          <div className="flow-grid">
            {flow.map(({ icon: Icon, label, note }, index) => (
              <div className="flow-item" key={label}>
                <span className="flow-icon"><Icon /></span>
                <strong>{label}</strong><small>{note}</small>
                {index < flow.length - 1 && <ChevronRight className="flow-arrow" />}
              </div>
            ))}
          </div>
        </section>

        <section id="tools" className="section-block">
          <div className="section-heading">
            <div><p className="eyebrow">MCP TOOLKIT</p><h2>Agent 可以调用的能力</h2></div>
            <Badge className="accent-badge">6 个工具已注册</Badge>
          </div>
          <div className="tool-grid">
            {tools.map(({ icon: Icon, name, detail }, index) => (
              <Card className="tool-card" key={name}>
                <CardContent>
                  <div className="tool-index">0{index + 1}</div>
                  <span className="tool-icon"><Icon /></span>
                  <div><h3>{name}</h3><p>{detail}</p></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section id="privacy" className="privacy-panel">
          <div className="privacy-icon"><LockKeyhole /></div>
          <div>
            <p className="eyebrow">PRIVACY BOUNDARY</p>
            <h2>网站是窗口，不是仓库。</h2>
            <p>Obsidian 原文、向量数据库和 API 密钥不会进入网站构建产物。真正的检索与问答仍由你的本地工作台完成。</p>
          </div>
          <div className="privacy-list">
            <span><Check />不上传笔记正文</span>
            <span><Check />不保存 API 密钥</span>
            <span><Check />不开放远程写入</span>
          </div>
        </section>

        <footer><span>自生长知识库 · 智能体工作台</span><span>Obsidian × Python × MCP × Agent</span></footer>
      </main>
    </div>
  );
}
