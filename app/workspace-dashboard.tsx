'use client';

import { useState } from 'react';
import {
  Activity, Bot, Check, CheckCircle2, Circle, Clipboard, Clock3,
  Code2, FileText, GitBranch, Inbox, Rss, Search, ShieldCheck,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const initialTasks = [
  { title: '整理新增收件箱', meta: '00-收件箱 · 日常' },
  { title: '更新向量索引', meta: '3357 个片段 · 增量' },
  { title: '回流项目经验', meta: '20-项目 → 40-资源' },
];

const recentNotes = [
  { name: '知识库智能体操作中心', path: '30-领域', time: '今天 09:42' },
  { name: '知识库索引', path: '40-资源', time: '昨天 18:16' },
  { name: '知识库运行日志', path: '40-资源', time: '昨天 18:15' },
  { name: '智能体工作台 README', path: '20-项目', time: '8 月 31 日' },
];

const actions = [
  { icon: Activity, label: '更新索引', detail: '扫描变化并写入向量库', command: '.\\scripts\\run.ps1 --json index' },
  { icon: ShieldCheck, label: '健康检查', detail: '检查路径、索引与密钥状态', command: '.\\scripts\\run.ps1 --json health' },
  { icon: Search, label: '搜索笔记', detail: '从本地知识库语义检索', command: '.\\scripts\\run.ps1 search "关键词"' },
  { icon: Bot, label: '询问 Agent', detail: '检索后生成带来源的答案', command: '.\\scripts\\run.ps1 ask "你的问题"' },
  { icon: Inbox, label: '采集资料', detail: '新资料只写入收件箱', command: '.\\scripts\\run.ps1 capture "标题" "内容"' },
  { icon: Clock3, label: '启动调度', detail: '每 15 分钟增量维护', command: '.\\scripts\\install-scheduler.ps1 -Minutes 15' },
];

const connectors = [
  { icon: Code2, name: 'Codex + MCP', status: '已连接', ready: true },
  { icon: Bot, name: 'Agent Skills', status: '可调用', ready: true },
  { icon: Rss, name: 'RSS 订阅', status: '待接入', ready: false },
  { icon: GitBranch, name: 'GitHub 资讯', status: '待接入', ready: false },
];

const heatmap = Array.from({ length: 84 }, (_, index) => {
  if ([5, 11, 18, 31, 48, 62, 76].includes(index)) return 4;
  return (index * 7 + (index % 9)) % 5;
});

export function WorkspaceDashboard() {
  const [done, setDone] = useState<number[]>([1]);
  const [copied, setCopied] = useState('');

  const toggleTask = (index: number) => {
    setDone((current) => current.includes(index)
      ? current.filter((item) => item !== index)
      : [...current, index]);
  };

  const copyCommand = async (label: string, command: string) => {
    await navigator.clipboard.writeText(command);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1800);
  };

  return (
    <section id="dashboard" className="section-block dashboard-section">
      <div className="section-heading">
        <div><p className="eyebrow">OBSIDIAN HOME</p><h2>主页操作台</h2></div>
        <p>复刻传统 Dashboard 的信息视图，并把常用动作连接到真实的本地工作台命令。</p>
      </div>

      <div className="dashboard-grid">
        <Card className="dashboard-card today-card">
          <CardHeader>
            <div><span className="card-kicker">TODAY</span><CardTitle>今日任务</CardTitle></div>
            <Badge variant="outline">{done.length}/{initialTasks.length}</Badge>
          </CardHeader>
          <CardContent>
            <div className="task-list">
              {initialTasks.map((task, index) => {
                const isDone = done.includes(index);
                return (
                  <button className={isDone ? 'task-row is-done' : 'task-row'} key={task.title} onClick={() => toggleTask(index)}>
                    {isDone ? <CheckCircle2 /> : <Circle />}
                    <span><strong>{task.title}</strong><small>{task.meta}</small></span>
                  </button>
                );
              })}
            </div>
            <p className="local-hint">清单状态仅保存在当前页面会话。</p>
          </CardContent>
        </Card>

        <Card className="dashboard-card activity-card">
          <CardHeader>
            <div><span className="card-kicker">ACTIVITY</span><CardTitle>知识生长热力图</CardTitle></div>
            <span className="activity-total">84 天</span>
          </CardHeader>
          <CardContent>
            <div className="heatmap" aria-label="最近 84 天知识库活跃度">
              {heatmap.map((level, index) => <i key={index} data-level={level} title={`第 ${index + 1} 天 · 活跃度 ${level}`} />)}
            </div>
            <div className="heatmap-legend"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} />)}<span>多</span></div>
          </CardContent>
        </Card>

        <Card className="dashboard-card recent-card">
          <CardHeader>
            <div><span className="card-kicker">RECENT</span><CardTitle>最近修改</CardTitle></div>
            <FileText />
          </CardHeader>
          <CardContent>
            <div className="recent-list">
              {recentNotes.map((note) => (
                <div className="recent-row" key={note.name}>
                  <span className="note-glyph"><FileText /></span>
                  <span><strong>{note.name}</strong><small>{note.path}</small></span>
                  <time>{note.time}</time>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="agent-console">
        <div className="console-heading">
          <div><p className="eyebrow">AGENT ACTIONS</p><h3>一键动作</h3></div>
          <Badge className="local-badge"><Clipboard /> 本地执行</Badge>
        </div>
        <div className="action-grid">
          {actions.map(({ icon: Icon, label, detail, command }) => (
            <div className="action-item" key={label}>
              <span className="action-icon"><Icon /></span>
              <div><strong>{label}</strong><small>{detail}</small></div>
              <Button variant="outline" size="sm" onClick={() => copyCommand(label, command)}>
                {copied === label ? <><Check />已复制</> : <><Clipboard />复制指令</>}
              </Button>
            </div>
          ))}
        </div>
        <p className="console-note">为保护私人笔记，网页不会直接调用你电脑上的脚本。复制指令后，在 <code>智能体工作台</code> 目录的 PowerShell 中运行。</p>
      </div>

      <div className="connector-strip">
        <div className="connector-copy"><p className="eyebrow">CONNECTORS</p><h3>智能体连接器</h3><span>从视频工作流拆出的接入状态。</span></div>
        <div className="connector-list">
          {connectors.map(({ icon: Icon, name, status, ready }) => (
            <div className="connector-item" key={name}>
              <Icon /><span><strong>{name}</strong><small className={ready ? 'ready' : ''}>{status}</small></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
