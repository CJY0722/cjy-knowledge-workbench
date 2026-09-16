'use client';

import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import {
  BookCheck, Check, CheckCircle2, Clipboard, ExternalLink, FileCheck2, FilePenLine,
  FilePlus2, Library, Loader2, LockKeyhole, RefreshCw, Save, Search, Send,
  ShieldCheck, Sparkles, TriangleAlert, Upload,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type SourceNote = { path: string; title: string; preview?: string; score?: number; updated?: string };
type BlogStatus = 'idea' | 'draft' | 'review' | 'ready' | 'published';
type DraftFilter = 'all' | BlogStatus;
type DraftNote = { path: string; title: string; updated: string; status?: BlogStatus; reviewed?: boolean; tags?: string[]; characters?: number; qualityScore?: number; issueCount?: number };
type RetrievalItem = { category: string; matches: Array<{ path: string; title: string; preview?: string; excerpt?: string }>; searchedAt: string };
type ReviewResult = {
  blockers: string[];
  warnings: string[];
  diagramLines: Array<{ line: number; width: number }>;
  longArticle: boolean;
  lines: number;
  characters: number;
};
type PublishPack = { csdnIntro: string; xiaohongshuTitle: string; xiaohongshuIntro: string };
type PlatformId = 'csdn' | 'juejin' | 'zhihu' | 'wechat' | 'xiaohongshu';
type PreparedPlatform = { platform: PlatformId; platformName: string; title: string; content: string; characters: number; warnings: string[]; conversions: string[]; editorUrl: string; format: string; cardPages?: string[] };
type PublicationReport = {
  ready: boolean;
  score: number;
  metadata: { status: BlogStatus; title: boolean; summary: boolean; tags: string[]; cover: boolean; reviewed: boolean };
  links: { total: number; resolved: number; broken: string[]; unpublished: string[]; backlinks: string[] };
  assets: { total: number; existing: number; missing: string[] };
  blockers: string[];
  fixableBlockers?: string[];
  warnings: string[];
  platforms: Array<{ platform: PlatformId; platformName: string; format: string; characters: number; warnings: string[]; conversions: string[]; ready: boolean }>;
  related: Array<{ path: string; score: number; reason: string }>;
};
type XiaohongshuCard = { dataUrl: string; filename: string };
type ClosurePreview = { summary: string; entries: Array<{ category: string; value: string; target: string; duplicate: boolean }>; event: string };
type WritingMode = 'manual' | 'ai' | 'revise';
type HumanizerStatus = 'pending' | 'checked' | 'skipped';
type MaterialKind = 'markdown' | 'visual';

const SESSION_KEY = 'cjy-blog-session-v1';
const BLOG_GUIDE_URL = 'https://github.com/CJY0722/cjy-knowledge-workbench/blob/main/docs/BLOG_GUIDE.md';
const PLATFORMS: Array<{ id: PlatformId; name: string }> = [
  { id: 'csdn', name: 'CSDN' },
  { id: 'juejin', name: '掘金' },
  { id: 'zhihu', name: '知乎' },
  { id: 'wechat', name: '微信公众号' },
  { id: 'xiaohongshu', name: '小红书' },
];
const BLOG_STATUS_OPTIONS: Array<{ id: BlogStatus; label: string }> = [
  { id: 'idea', label: '构思' },
  { id: 'draft', label: '草稿' },
  { id: 'review', label: '待审核' },
  { id: 'ready', label: '可发布' },
  { id: 'published', label: '已发布' },
];
const BLOG_STATUS_LABELS = Object.fromEntries(BLOG_STATUS_OPTIONS.map(item => [item.id, item.label])) as Record<BlogStatus, string>;

function statusFromMarkdown(content: string): BlogStatus {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || '';
  const raw = frontmatter.match(/^status:\s*["']?([^\n"']+)/m)?.[1]?.trim().toLowerCase() || 'draft';
  if (/^(idea|planned|构思|选题)$/.test(raw)) return 'idea';
  if (/^(review|reviewing|待审核|审核中)$/.test(raw)) return 'review';
  if (/^(ready|scheduled|可发布|待发布)$/.test(raw)) return 'ready';
  if (/^(published|已发布)$/.test(raw)) return 'published';
  return 'draft';
}

function withDraftStatus(content: string, status: BlogStatus) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return '';
  const metadata = /^status:\s*.*$/mi.test(match[1])
    ? match[1].replace(/^status:\s*.*$/mi, `status: ${status}`)
    : `${match[1]}\nstatus: ${status}`;
  return `---\n${metadata}\n---${content.slice(match[0].length)}`;
}

function renderXiaohongshuCard(page: string, title: string, index: number, total: number): XiaohongshuCard {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1440;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法生成图文卡片');
  context.fillStyle = '#f6f3eb';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#315f49';
  context.fillRect(0, 0, 18, canvas.height);
  context.fillStyle = '#315f49';
  context.font = '600 34px "Microsoft YaHei UI", sans-serif';
  context.fillText('CJY · 知识工作台', 82, 92);
  context.fillStyle = '#20251f';
  context.font = '600 45px "Microsoft YaHei UI", sans-serif';
  const lines = page.split('\n');
  lines.forEach((line, lineIndex) => context.fillText(line || ' ', 82, 190 + lineIndex * 68));
  context.fillStyle = '#6c746c';
  context.font = '28px "Microsoft YaHei UI", sans-serif';
  context.fillText(`${index + 1} / ${total}`, 82, 1360);
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 40) || '小红书图文';
  return { dataUrl: canvas.toDataURL('image/png'), filename: `${safeTitle}-${String(index + 1).padStart(2, '0')}.png` };
}

function XiaohongshuCardPreview({ card, index }: { card: XiaohongshuCard; index: number }) {
  // oxlint-disable-next-line next/no-img-element -- local canvas data URL cannot use the framework image optimizer
  return <img src={card.dataUrl} alt={`小红书图文卡片第 ${index + 1} 张`} />;
}

async function copyText(value: string) {
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  // oxlint-disable-next-line typescript/no-deprecated -- compatibility fallback for embedded browsers without Clipboard API access
  const copied = document.execCommand('copy');
  input.remove();
  if (copied) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch { /* handled below */ }
  throw new Error('复制失败，请手动选择内容');
}

export function BlogWorkbench({
  bridge,
  bridgeToken,
  bridgeOnline,
  deepseekConfigured,
  onDeepseekState,
  onBridgeState,
  onConnect,
  onConfigure,
  onNotice,
}: {
  bridge: string;
  bridgeToken: string;
  bridgeOnline: boolean;
  deepseekConfigured: boolean;
  onDeepseekState: (configured: boolean) => void;
  onBridgeState: (online: boolean) => void;
  onConnect: () => void;
  onConfigure: () => void;
  onNotice: (message: string) => void;
}) {
  const [mode, setMode] = useState<WritingMode>('manual');
  const [materialKind, setMaterialKind] = useState<MaterialKind>('markdown');
  const [visualVerified, setVisualVerified] = useState(false);
  const [visualEvidence, setVisualEvidence] = useState('');
  const [focusDecision, setFocusDecision] = useState<'pending' | 'confirmed' | 'skipped'>('pending');
  const [focus, setFocus] = useState('先给结论，再解释原理；只保留有来源或可验证的技术事实。');
  const [instruction, setInstruction] = useState('面向软件工程学生，解释关键代码，不虚构运行结果。');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sources, setSources] = useState<SourceNote[]>([]);
  const [source, setSource] = useState<SourceNote | null>(null);
  const [retrieval, setRetrieval] = useState<RetrievalItem[] | null>(null);
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [draftPath, setDraftPath] = useState('');
  const [draftUpdated, setDraftUpdated] = useState('');
  const [savedDraft, setSavedDraft] = useState('');
  const [savedTitle, setSavedTitle] = useState('');
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [humanizer, setHumanizer] = useState<HumanizerStatus>('pending');
  const [finalized, setFinalized] = useState(false);
  const [publishPack, setPublishPack] = useState<PublishPack | null>(null);
  const [preparedPlatforms, setPreparedPlatforms] = useState<Partial<Record<PlatformId, PreparedPlatform>>>({});
  const [xiaohongshuCards, setXiaohongshuCards] = useState<XiaohongshuCard[]>([]);
  const [drafts, setDrafts] = useState<DraftNote[]>([]);
  const [draftFilter, setDraftFilter] = useState<DraftFilter>('all');
  const [publicationReport, setPublicationReport] = useState<PublicationReport | null>(null);
  const [busy, setBusy] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [aiConsentOpen, setAiConsentOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [closureOpen, setClosureOpen] = useState(false);
  const [closure, setClosure] = useState({ preference: '', style: '', requirement: '', pitfall: '' });
  const [closurePreview, setClosurePreview] = useState<ClosurePreview | null>(null);

  const request = async <T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!bridgeToken) throw new Error('请先在设置中连接自己的 Obsidian');
    const headers = { 'X-Workbench-Token': bridgeToken };
    const healthResponse = await fetch(`${bridge}/health`, { cache: 'no-store', headers });
    const health = await healthResponse.json() as { vault_exists?: boolean; obsidian_configured?: boolean; error?: string };
    if (!healthResponse.ok || !health.vault_exists || !health.obsidian_configured) {
      onBridgeState(false);
      throw new Error(health.error || '本地桥接没有连接到有效的 Obsidian Vault');
    }
    const response = await fetch(`${bridge}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await response.json() as { error?: string; code?: string; result?: T };
    if (data.code === 'invalid_deepseek_key') onDeepseekState(false);
    if (!response.ok || data.error) {
      const error = new Error(data.error || '操作失败') as Error & { code?: string };
      error.code = data.code;
      throw error;
    }
    onBridgeState(true);
    return data.result as T;
  };

  useEffect(() => {
    let active = true;
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') as Partial<{ mode: WritingMode; materialKind: MaterialKind; visualEvidence: string; title: string; draft: string; focus: string; instruction: string; source: SourceNote }>;
      queueMicrotask(() => {
        if (!active) return;
        if (saved.mode === 'manual' || saved.mode === 'ai' || saved.mode === 'revise') setMode(saved.mode);
        if (saved.materialKind === 'markdown' || saved.materialKind === 'visual') setMaterialKind(saved.materialKind);
        if (typeof saved.visualEvidence === 'string') setVisualEvidence(saved.visualEvidence);
        if (typeof saved.title === 'string') setTitle(saved.title);
        if (typeof saved.draft === 'string') setDraft(saved.draft);
        if (typeof saved.focus === 'string') setFocus(saved.focus);
        if (typeof saved.instruction === 'string') setInstruction(saved.instruction);
        if (saved.source?.path) setSource(saved.source);
      });
    } catch { /* session cache is optional */ }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ mode, materialKind, visualEvidence, title, draft, focus, instruction, source }));
  }, [mode, materialKind, visualEvidence, title, draft, focus, instruction, source]);

  const dirty = Boolean(draftPath && (draft !== savedDraft || title !== savedTitle));
  const retrievalCount = retrieval?.reduce((sum, item) => sum + item.matches.length, 0) || 0;
  const stage = !retrieval ? 1 : !draft ? 2 : !draftPath || dirty ? 3 : !finalized ? 4 : 5;
  const statusText = ['准备知识与材料', '生成或修改初稿', '审核并写入 Markdown', '等待定稿确认', '发布与收尾'][stage - 1];
  const materialReady = materialKind === 'markdown' || Boolean(visualVerified && visualEvidence.trim());
  const workflowReady = Boolean(retrieval && focusDecision !== 'pending' && materialReady);
  const canFinalize = Boolean(workflowReady && draftPath && !dirty && review && !review.blockers.length && humanizer !== 'pending');
  const preview = useMemo(() => draft.trim() || '正文预览会显示在这里。', [draft]);
  const draftStatus = useMemo(() => statusFromMarkdown(draft), [draft]);
  const draftCounts = useMemo(() => Object.fromEntries(BLOG_STATUS_OPTIONS.map(item => [item.id, drafts.filter(draftItem => (draftItem.status || 'draft') === item.id).length])) as Record<BlogStatus, number>, [drafts]);
  const filteredDrafts = useMemo(() => draftFilter === 'all' ? drafts : drafts.filter(item => (item.status || 'draft') === draftFilter), [draftFilter, drafts]);

  const invalidateOutcome = () => {
    setReview(null);
    setHumanizer('pending');
    setFinalized(false);
    setPublishPack(null);
    setPreparedPlatforms({});
    setXiaohongshuCards([]);
    setClosurePreview(null);
    setPublicationReport(null);
  };

  const changeDraft = (value: string) => {
    setDraft(value);
    invalidateOutcome();
  };

  const startManualDraft = () => {
    if (draft.trim() && !window.confirm('新建原创文章会清空当前编辑区，是否继续？')) return;
    setMode('manual'); setTitle(''); setDraft(''); setDraftPath(''); setDraftUpdated('');
    setSavedDraft(''); setSavedTitle(''); setSource(null); setSources([]); setRetrieval(null);
    setFocusDecision('pending'); setHumanizer('pending'); invalidateOutcome();
    onNotice('已新建原创文章，可以直接输入标题和正文。');
  };

  const importMarkdown = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 200000) return onNotice('文章超过 20 万字符限制，请缩短后再导入。');
    if (draft.trim() && !window.confirm('导入文章会替换当前编辑区，是否继续？')) return;
    try {
      const content = await file.text();
      const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
      setMode('revise'); setTitle(heading || file.name.replace(/\.(md|markdown|txt)$/i, '')); setDraft(content);
      setDraftPath(''); setDraftUpdated(''); setSavedDraft(''); setSavedTitle(''); setSource(null);
      setSources([]); setRetrieval(null); setFocusDecision('pending'); setHumanizer('pending'); invalidateOutcome();
      onNotice(`已导入 ${file.name}，修改后需要重新预检、审核和保存。`);
    } catch { onNotice('文章读取失败，请确认文件可以访问。'); }
  };

  const selectSource = (item: SourceNote) => {
    if (draft.trim() && source?.path !== item.path && !window.confirm('更换知识源会清空当前编辑区，是否继续？')) return;
    setSource(item);
    setSources([]);
    setRetrieval(null);
    setFocusDecision('pending');
    invalidateOutcome();
    if (draft.trim()) {
      setDraft('');
      setDraftPath('');
      setDraftUpdated('');
      setSavedDraft('');
      setSavedTitle('');
    }
    setTitle(item.title);
  };

  const searchSources = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    setBusy('search');
    try {
      setSources(await request<SourceNote[]>('search', { query: sourceQuery, limit: 8 }));
    } catch (error) {
      onBridgeState(false);
      onNotice(error instanceof Error ? error.message : '知识源检索失败');
    } finally { setBusy(''); }
  };

  const runPreflight = async () => {
    if (!bridgeOnline) return onNotice('请先连接本地 Obsidian；预检需要读取你的知识库。');
    setBusy('preflight');
    try {
      const result = await request<{ retrieval: RetrievalItem[] }>('writing_preflight', { topic: title || sourceQuery });
      setRetrieval(result.retrieval);
      onNotice(`知识库预检完成：5 类均已检索，共命中 ${result.retrieval.reduce((sum, item) => sum + item.matches.length, 0)} 条。`);
    } catch (error) { onNotice(error instanceof Error ? error.message : '知识库预检失败'); }
    finally { setBusy(''); }
  };

  const generationIssue = () => {
    if (!bridgeOnline) return '请先连接本地 Obsidian。';
    if (mode === 'ai' && !source) return '请先搜索并选择一篇知识源，再执行预检。';
    if (mode === 'revise' && !draft.trim()) return '请先导入、打开或粘贴已有文章。';
    if (!retrieval) return '请在选定材料后执行五类知识库预检。';
    if (focusDecision === 'pending') return '请先确认文章重点，或明确跳过重点讨论。';
    if (!materialReady) return '请填写视觉材料核验记录，并确认已经核对图像。';
    return '';
  };

  const generateDraft = async (useAi: boolean) => {
    const issue = generationIssue();
    if (issue) return onNotice(issue);
    if (useAi && !deepseekConfigured) return onNotice('请先在工作台设置中填写自己的 DeepSeek API Key。');
    setAiConsentOpen(false);
    setBusy(useAi ? 'generate' : 'template');
    try {
      const result = mode === 'ai'
        ? await request<{ title: string; content: string }>('generate_csdn', { sourcePath: source?.path, instruction: `${focus}\n${instruction}${materialKind === 'visual' ? `\n视觉材料核验记录：${visualEvidence}` : ''}`, useAi, preflightConfirmed: true })
        : await request<{ title: string; content: string }>('revise_csdn', { title, content: draft, instruction: `${focus}\n${instruction}${materialKind === 'visual' ? `\n视觉材料核验记录：${visualEvidence}` : ''}`, useAi, preflightConfirmed: true });
      setTitle(result.title);
      changeDraft(result.content);
      setDraftPath(''); setDraftUpdated(''); setSavedDraft(''); setSavedTitle('');
      setHumanizer('pending');
      onNotice(useAi ? '初稿已生成，尚未写入 Obsidian。' : '安全模板已创建，尚未写入 Obsidian。');
    } catch (error) { onNotice(error instanceof Error ? error.message : '生成失败'); }
    finally { setBusy(''); }
  };

  const requestAiGeneration = () => {
    const issue = generationIssue();
    if (issue) return onNotice(issue);
    setAiConsentOpen(true);
  };

  const reviewDraft = async () => {
    if (!title.trim() || !draft.trim()) return onNotice('标题和正文不能为空。');
    if (!workflowReady) return onNotice('请先完成知识库预检、重点确认和材料核验。');
    setBusy('review');
    try {
      const result = await request<ReviewResult>('review_csdn', { title, content: draft });
      setReview(result);
      onNotice(result.blockers.length ? `审核发现 ${result.blockers.length} 个阻塞项。` : '草稿审核完成，可以进入写入确认。');
    } catch (error) { onNotice(error instanceof Error ? error.message : '审核失败'); }
    finally { setBusy(''); }
  };

  const improveDraft = async (kind: 'fix' | 'humanize', requestedIssues?: string[]) => {
    if (!bridgeOnline) return onNotice('请先连接本地 Obsidian。');
    if (!deepseekConfigured) return onNotice('请先在工作台设置中填写自己的 DeepSeek API Key。');
    if (!title.trim() || !draft.trim()) return onNotice('标题和正文不能为空。');
    if (!requestedIssues && !workflowReady) return onNotice('请先完成知识库预检、重点确认和材料核验。');
    if (kind === 'fix' && !review && !requestedIssues) return onNotice('请先点击“审核检查”。');
    const issues = requestedIssues || (kind === 'fix' ? review?.blockers || [] : review?.warnings || []);
    if (kind === 'fix' && !issues.length) return onNotice('当前没有需要修正的阻塞项。');
    setBusy(kind);
    try {
      const result = await request<{ content: string; review: ReviewResult }>('improve_csdn', {
        title,
        content: draft,
        kind,
        issues,
      });
      setDraft(result.content);
      invalidateOutcome();
      setReview(result.review);
      onNotice(kind === 'fix'
        ? `正文阻塞修正完成，草稿复检后剩余 ${result.review.blockers.length} 项；请重新执行发布检查。`
        : 'DeepSeek 去 AI 味完成，请复核全文并确认人工表达检查。');
    } catch (error) { onNotice(error instanceof Error ? error.message : '草稿改写失败'); }
    finally { setBusy(''); }
  };

  const repairPublicationBlockers = async () => {
    if (!bridgeOnline) return onNotice('请先连接本地 Obsidian。');
    if (!deepseekConfigured) return onNotice('请先在工作台设置中填写自己的 DeepSeek API Key。');
    if (!publicationReport || !title.trim() || !draft.trim()) return onNotice('请先执行发布就绪检查。');
    setBusy('fix');
    try {
      const result = await request<{ content: string; review: ReviewResult; publicationReport: PublicationReport; convertedLinks: number; statusAdjusted: boolean }>('repair_publication', { path: draftPath, title, content: draft });
      setDraft(result.content);
      invalidateOutcome();
      setReview(result.review);
      setPublicationReport(result.publicationReport);
      onNotice(result.publicationReport.blockers.length
        ? `AI 自动修复并复检完成，仍有 ${result.publicationReport.blockers.length} 个无法安全自动解决的阻塞项。`
        : 'AI 自动修复并复检完成，当前没有发布阻塞项；请审核后确认保存。');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'AI 自动修复失败'); }
    finally { setBusy(''); }
  };

  const openSaveDialog = () => {
    if (!workflowReady) return onNotice('请先完成知识库预检、重点确认和材料核验。');
    if (!review) return onNotice('请先点击“审核检查”。');
    if (review.blockers.length) return onNotice(`请先解决 ${review.blockers.length} 个审核阻塞项。`);
    setSaveOpen(true);
  };

  const saveDraft = async (overwriteConfirmed = false) => {
    if (!workflowReady || !review || review.blockers.length) return onNotice('请先完成预检、重点确认、材料核验和无阻塞审核。');
    setBusy('save');
    try {
      const result = await request<{ path: string; updated: string; versionArchived: boolean; longArticle: boolean; sectionsWritten: number }>('save_csdn', {
        title, content: draft, sourcePath: source?.path || '', expectedUpdated: draftUpdated,
        overwriteConfirmed, approved: true, preflightConfirmed: Boolean(retrieval), focusDecision,
        materialKind, visualVerified, visualEvidence, reviewConfirmed: Boolean(review && !review.blockers.length),
      });
      setDraftPath(result.path); setDraftUpdated(result.updated); setSavedDraft(draft); setSavedTitle(title);
      setFinalized(false); setPublishPack(null); setSaveOpen(false);
      onNotice(result.longArticle ? `长文已按 ${result.sectionsWritten} 个完整段落顺序写入。` : result.versionArchived ? '草稿已写入，旧版已归档。' : '草稿已写入 Obsidian。');
    } catch (error) {
      const typed = error as Error & { code?: string };
      if (typed.code === 'confirm_overwrite' && window.confirm('同名草稿已存在。是否归档旧版并覆盖？')) return saveDraft(true);
      onNotice(typed.message);
    } finally { setBusy(''); }
  };

  const loadDrafts = async () => {
    setBusy('drafts');
    try { setDrafts(await request<DraftNote[]>('list_csdn')); }
    catch (error) { onNotice(error instanceof Error ? error.message : '草稿读取失败'); }
    finally { setBusy(''); }
  };

  const openDraft = async (path: string) => {
    if ((dirty || (!draftPath && draft.trim())) && !window.confirm('当前编辑区有尚未保存的内容，打开其他草稿会替换它，是否继续？')) return;
    setBusy('drafts');
    try {
      const result = await request<{ title: string; content: string; path: string; updated: string; source?: SourceNote | null }>('read_csdn', { path });
      setTitle(result.title); setDraft(result.content); setDraftPath(result.path); setDraftUpdated(result.updated);
      setSavedDraft(result.content); setSavedTitle(result.title); setSource(result.source || null);
      setMode('revise');
      setRetrieval(null); setFocusDecision('pending'); setMaterialKind('markdown'); setVisualVerified(false); setVisualEvidence('');
      invalidateOutcome(); setHumanizer('pending');
      onNotice('草稿已打开。修改后需要重新审核和确认。');
    } catch (error) { onNotice(error instanceof Error ? error.message : '草稿打开失败'); }
    finally { setBusy(''); }
  };

  const updateDraftStatus = (status: BlogStatus) => {
    if (!draftPath) return onNotice('请先把文章写入 Obsidian，再设置内容管线状态。');
    const next = withDraftStatus(draft, status);
    if (!next) return onNotice('当前文章没有 YAML frontmatter，请先通过工作台保存一次。');
    changeDraft(next);
    onNotice(`已把“${BLOG_STATUS_LABELS[status]}”写入编辑区；审核并保存后才会更新 Obsidian。`);
  };

  const runPublicationAudit = async () => {
    if (!title.trim() || !draft.trim()) return onNotice('请先准备文章标题和正文。');
    setBusy('publication-audit');
    try {
      setPublicationReport(await request<PublicationReport>('publication_audit', { path: draftPath, title, content: draft }));
      onNotice('发布就绪检查完成；它只读取当前文章和知识库，不会修改文件。');
    } catch (error) { onNotice(error instanceof Error ? error.message : '发布就绪检查失败'); }
    finally { setBusy(''); }
  };

  const finalize = () => {
    if (!canFinalize) return onNotice('请先保存最新版本、解决阻塞项，并完成或明确跳过去 AI 味检查。');
    if (!window.confirm('确认这篇文章已经定稿、不再修改？确认后才能生成发布文案和收尾预览。')) return;
    setFinalized(true);
    onNotice('已记录为用户确认定稿，尚未发布。');
  };

  const createPublishPack = async () => {
    if (!finalized) return onNotice('请先明确确认文章已经定稿。');
    setBusy('publish-pack');
    try { setPublishPack(await request<PublishPack>('publish_pack', { title, content: draft })); }
    catch (error) { onNotice(error instanceof Error ? error.message : '发布文案生成失败'); }
    finally { setBusy(''); }
  };

  const preparePlatforms = async () => {
    if (!finalized) return onNotice('请先明确确认文章已经定稿。');
    setBusy('prepare-publish');
    try {
      const results = await Promise.all(PLATFORMS.map(({ id }) => request<PreparedPlatform>('prepare_platform', { platform: id, title, content: draft })));
      setPreparedPlatforms(Object.fromEntries(results.map(item => [item.platform, item])) as Partial<Record<PlatformId, PreparedPlatform>>);
      const pages = results.find(item => item.platform === 'xiaohongshu')?.cardPages || [];
      setXiaohongshuCards(pages.map((page, index) => renderXiaohongshuCard(page, title, index, pages.length)));
      setPublishOpen(true);
      onNotice('五个平台的适配物料已生成，可复制长文或下载小红书图卡。');
    } catch (error) { onNotice(error instanceof Error ? error.message : '多平台发布准备失败'); }
    finally { setBusy(''); }
  };

  const publishToPlatform = async (item: PreparedPlatform, mode: 'article' | 'cards' = 'article') => {
    if (!publicationReport?.ready) return onNotice('请先执行发布就绪检查并解决全部阻塞项，再进入官方发布页。');
    const copyTask = copyText(item.content);
    const opened = window.open(item.editorUrl, '_blank');
    try { if (opened) opened.opener = null; } catch { /* cross-origin navigation raced with opener isolation */ }
    try {
      await copyTask;
      if (!opened) return onNotice(`${item.platformName} 正文已复制，但浏览器拦截了发布页；请允许弹窗后重试。`);
      onNotice(mode === 'cards'
        ? '小红书图文发布页已打开，说明文字已复制；请下载并上传下方图卡后人工确认发布。'
        : `${item.platformName} 发布页已打开，正文已复制；请粘贴标题和正文，核对后人工确认发布。`);
    } catch {
      onNotice(opened
        ? `${item.platformName} 发布页已打开，但正文复制失败；请返回工作台手动复制。`
        : `${item.platformName} 发布页被拦截且正文复制失败，请允许弹窗后重试。`);
    }
  };

  const buildClosurePreview = async () => {
    if (!finalized) return onNotice('请先确认定稿。');
    setBusy('closure');
    try {
      setClosurePreview(await request<ClosurePreview>('closure_preview', { ...closure, title, draftPath }));
      setClosureOpen(true);
    } catch (error) { onNotice(error instanceof Error ? error.message : '收尾预览生成失败'); }
    finally { setBusy(''); }
  };

  const commitClosure = async () => {
    if (!closurePreview || !window.confirm('确认把预览中的非重复条目写入 Obsidian，并追加写作事件日志？')) return;
    setBusy('closure-save');
    try {
      const result = await request<{ written: number; skipped: number; eventLogged: boolean }>('commit_closure', { ...closure, title, draftPath, approved: true });
      setClosureOpen(false);
      onNotice(`收尾完成：写入 ${result.written} 条，跳过重复 ${result.skipped} 条，事件日志${result.eventLogged ? '已追加' : '已存在并跳过'}。`);
    } catch (error) { onNotice(error instanceof Error ? error.message : '收尾入库失败'); }
    finally { setBusy(''); }
  };

  return <div className="blog-workbench">
    <section className="blog-workflow-head">
      <div><span>当前阶段 {stage}/5 · {bridgeOnline ? 'Obsidian 已连接' : '等待本地桥接'}</span><strong>{statusText}</strong><small>草稿、定稿、发布和入库状态严格分开记录</small></div>
      <div className="blog-stage-strip">{['知识与材料', '初稿', '审核写入', '定稿', '发布收尾'].map((label, index) => <span key={label} className={stage > index ? 'active' : ''}>{index + 1}<small>{label}</small></span>)}</div>
    </section>

    <section className="plain-block blog-readiness">
      <div><ShieldCheck /><span><strong>开始前检查</strong><small>{!bridgeOnline ? '先连接本地知识库，预检、生成、保存和发布物料才可使用。' : !deepseekConfigured ? '知识库已连接；普通写作可用，AI 生成还需在设置中填写 DeepSeek API Key。' : '知识库与 DeepSeek 均已就绪。请先选择材料，再确认重点并执行预检。'}</small></span></div>
      <div className="blog-readiness-status"><span data-ready={bridgeOnline}>Obsidian {bridgeOnline ? '已连接' : '未连接'}</span><span data-ready={deepseekConfigured}>DeepSeek {deepseekConfigured ? '已配置' : '未配置'}</span></div>
      <div className="blog-inline-actions">{!bridgeOnline && <Button onClick={onConnect}><ShieldCheck />连接 Obsidian</Button>}{bridgeOnline && !deepseekConfigured && <Button onClick={onConfigure}><Sparkles />配置 DeepSeek</Button>}<a className="blog-guide-link" href={BLOG_GUIDE_URL} target="_blank" rel="noreferrer">查看使用指南</a></div>
    </section>

    <div className="blog-config-grid">
      <section className="plain-block blog-config-card">
        <div className="blog-card-title"><FilePenLine /><div><strong>写作设置</strong><span>先选路径，再进入初稿</span></div></div>
        <fieldset className="blog-choice-field"><legend>写作方式</legend><div className="blog-choice-group">{([['manual', '自己创作'], ['ai', 'AI 从知识源写'], ['revise', '修改已有文章']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); invalidateOutcome(); }}>{label}</button>)}</div></fieldset>
        <fieldset className="blog-choice-field"><legend>材料类型</legend><div className="blog-choice-group">{([['markdown', 'Markdown / 代码'], ['visual', 'PDF / 板书 / 图片']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={materialKind === value} onClick={() => { setMaterialKind(value); setVisualVerified(false); invalidateOutcome(); }}>{label}</button>)}</div></fieldset>
        {materialKind === 'visual' && <div className="blog-visual-proof"><label htmlFor="blog-visual-evidence">渲染 / OCR 核验记录<Textarea id="blog-visual-evidence" value={visualEvidence} onChange={(event) => { setVisualEvidence(event.target.value); setVisualVerified(false); invalidateOutcome(); }} rows={3} placeholder="填写已核对的页面、图示要点或 OCR 结果笔记路径；工作台本身不伪装已完成 OCR" /></label><label aria-label="确认视觉材料已完成渲染或 OCR 核对" className="blog-check" htmlFor="blog-visual-verified"><input id="blog-visual-verified" type="checkbox" disabled={!visualEvidence.trim()} checked={visualVerified} onChange={(event) => { setVisualVerified(event.target.checked); invalidateOutcome(); }} /><span><strong>我已真正核对图像</strong><small>必须先留下核验记录；未核验时禁止审核与写入</small></span></label></div>}
        <label htmlFor="blog-focus">文章重点<Textarea id="blog-focus" value={focus} onChange={(event) => { setFocus(event.target.value); setFocusDecision('pending'); invalidateOutcome(); }} rows={3} /></label>
        <div className="blog-inline-actions"><Button variant="outline" onClick={() => setFocusDecision('skipped')}>明确跳过讨论</Button><Button onClick={() => setFocusDecision('confirmed')}><Check />确认重点</Button></div>
      </section>

      <section className="plain-block blog-config-card">
        <div className="blog-card-title"><BookCheck /><div><strong>知识库预检</strong><span>先查坑，再查偏好、文风、需求和博客索引</span></div></div>
        <Button onClick={runPreflight} disabled={busy === 'preflight'}>{busy === 'preflight' ? <Loader2 className="spin" /> : <Search />}执行五类预检</Button>
        {retrieval ? <div className="blog-retrieval-list">{retrieval.map((item) => <div key={item.category}><CheckCircle2 /><span><strong>{item.category}</strong><small>{item.matches.length ? `已检索 · ${item.matches.length} 条：${item.matches.map((match) => match.title).join('、')}` : '已检索 · 无命中（已记录）'}</small></span></div>)}</div> : <div className="blog-pending"><TriangleAlert />尚未检索，不能生成初稿</div>}
        <small className="blog-meta">{retrieval ? `检索记录完整 · 共 ${retrievalCount} 条命中` : '无命中也会记录“已完成检索”'}</small>
      </section>
    </div>

    <section className="plain-block blog-source-card">
      <div className="blog-card-title"><Library /><div><strong>写作材料</strong><span>{source ? source.path : mode === 'manual' ? '从空白开始创作，也可以导入 Markdown' : mode === 'revise' ? '导入文件或打开 Obsidian 中的已有文章' : '选择一篇 Obsidian 知识笔记'}</span></div></div>
      <form onSubmit={searchSources}><Input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="搜索标题、正文或路径" /><Button type="submit" variant="outline" disabled={busy === 'search'}>{busy === 'search' ? <Loader2 className="spin" /> : <Search />}搜索</Button></form>
      {sources.length > 0 && <div className="blog-source-results">{sources.map((item) => <button key={item.path} onClick={() => selectSource(item)}><span><strong>{item.title}</strong><small>{item.path}</small></span><Badge variant="outline">选择</Badge></button>)}</div>}
    </section>

    <section className="plain-block blog-editor-card">
      <header>
        <div><strong>Markdown 初稿</strong><span>{draftPath ? dirty ? '有未保存修改' : `已写入 ${draftPath}` : '尚未写入文件'}</span></div>
        <div className="blog-inline-actions"><Button variant="outline" onClick={startManualDraft}><FilePlus2 />新建原创</Button><label className="blog-file-button"><Upload />导入 Markdown<input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={importMarkdown} /></label><Button variant="outline" onClick={loadDrafts} disabled={busy === 'drafts'}><RefreshCw />打开已有文章</Button>{mode === 'ai' && <Button variant="outline" onClick={() => generateDraft(false)} disabled={Boolean(busy)}>创建安全模板</Button>}{mode !== 'manual' && <Button onClick={requestAiGeneration} disabled={Boolean(busy)}><Sparkles />{mode === 'ai' ? 'AI 生成初稿' : 'AI 辅助修改'}</Button>}</div>
      </header>
      {drafts.length > 0 && <><div className="blog-pipeline-toolbar"><div><strong>内容管线</strong><small>{drafts.length} 篇文章 · 按 Obsidian frontmatter 状态筛选</small></div><div className="blog-pipeline-filters"><button type="button" aria-pressed={draftFilter === 'all'} onClick={() => setDraftFilter('all')}>全部 {drafts.length}</button>{BLOG_STATUS_OPTIONS.map(item => <button type="button" key={item.id} aria-pressed={draftFilter === item.id} onClick={() => setDraftFilter(item.id)}>{item.label} {draftCounts[item.id]}</button>)}</div></div><div className="blog-draft-list">{filteredDrafts.length ? filteredDrafts.map((item) => <button type="button" aria-label={`打开文章：${item.title}`} key={item.path} onClick={() => openDraft(item.path)}><span><strong>{item.title}</strong><small>{item.path} · {(item.characters || 0).toLocaleString('zh-CN')} 字</small></span><span className="blog-draft-meta"><Badge variant="outline">{BLOG_STATUS_LABELS[item.status || 'draft']}</Badge><small>内容质量 {item.qualityScore ?? '—'} · {item.issueCount ?? '—'} 项提醒</small><small>{new Date(item.updated).toLocaleString('zh-CN')}</small></span></button>) : <div className="blog-empty-row">当前状态下没有文章。</div>}</div></>}
      <label className="blog-title-field" htmlFor="blog-title">文章标题<Input id="blog-title" value={title} onChange={(event) => { setTitle(event.target.value); setRetrieval(null); invalidateOutcome(); }} maxLength={100} placeholder="输入文章标题" /></label>
      <label className="blog-instruction-field" htmlFor="blog-instruction">本次要求<Input id="blog-instruction" value={instruction} onChange={(event) => { setInstruction(event.target.value); setFinalized(false); setPublishPack(null); setPreparedPlatforms({}); }} /></label>
      <div className="blog-editor-grid"><Textarea value={draft} onChange={(event) => changeDraft(event.target.value)} rows={24} placeholder={mode === 'manual' ? '从这里开始写 Markdown…' : mode === 'revise' ? '粘贴或导入你已经写好的 Markdown…' : '完成预检并选择知识源后生成初稿…'} /><div className="blog-preview"><span>安全文本预览</span><pre>{preview}</pre></div></div>
      <footer><span>{draft ? `${draft.split(/\r?\n/).length} 行 · ${draft.replace(/\s/g, '').length.toLocaleString('zh-CN')} 字` : '0 行 · 0 字'}</span><div className="blog-inline-actions"><Button variant="outline" onClick={reviewDraft} disabled={Boolean(busy)}><ShieldCheck />审核检查</Button><Button onClick={openSaveDialog} disabled={Boolean(busy)}><Save />确认后写入</Button></div></footer>
    </section>

    <section className="plain-block blog-publication-card">
      <header className="blog-publication-head">
        <div className="blog-card-title"><BookCheck /><div><strong>发布就绪检查</strong><span>只读核对元数据、内部链接、附件、平台转换和相关文章</span></div></div>
        <div className="blog-inline-actions"><label htmlFor="blog-status">内容状态<select id="blog-status" value={draftStatus} disabled={!draftPath} onChange={(event) => updateDraftStatus(event.target.value as BlogStatus)}>{BLOG_STATUS_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><Button variant="outline" onClick={runPublicationAudit} disabled={Boolean(busy) || !draft.trim()}>{busy === 'publication-audit' ? <Loader2 className="spin" /> : <ShieldCheck />}检查当前文章</Button></div>
      </header>
      <small className="blog-meta">状态修改只进入当前编辑区，仍需按原流程审核并确认保存；检查结果不会自动修改任何文件。</small>
      {publicationReport ? <div className="blog-publication-report">
        <div className="blog-audit-score" data-ready={publicationReport.ready}><strong>{publicationReport.score}</strong><span>{publicationReport.ready ? '已达到发布准备状态' : `${publicationReport.blockers.length} 个阻塞项 · ${publicationReport.warnings.length} 条提醒`}</span></div>
        {(publicationReport.blockers.length > 0 || publicationReport.warnings.length > 0) && <div className="blog-audit-issues">{publicationReport.blockers.map(item => <small key={`block-${item}`} data-level="block">阻塞 · {item}</small>)}{publicationReport.warnings.map(item => <small key={`warn-${item}`}>提醒 · {item}</small>)}</div>}
        {publicationReport.blockers.length > 0 && <div className="blog-inline-actions"><Button variant="outline" onClick={() => void repairPublicationBlockers()} disabled={Boolean(busy)}>{busy === 'fix' ? <Loader2 className="spin" /> : <Sparkles />}AI 自动修复</Button><small className="blog-meta">私有链接与附件路径会先在本机隐藏；AI 返回后自动恢复附件、转换不可发布链接并复检。</small></div>}
        <div className="blog-audit-grid">
          <article><strong>发布元数据</strong><span>状态：{BLOG_STATUS_LABELS[publicationReport.metadata.status]}</span><span>标题 {publicationReport.metadata.title ? '✓' : '△'} · 摘要 {publicationReport.metadata.summary ? '✓' : '△'} · 标签 {publicationReport.metadata.tags.length || '△'} · 封面 {publicationReport.metadata.cover ? '✓' : '△'}</span></article>
          <article><strong>内部链接</strong><span>{publicationReport.links.resolved}/{publicationReport.links.total} 可解析 · {publicationReport.links.backlinks.length} 条反向链接</span>{publicationReport.links.broken.length > 0 && <small>缺失：{publicationReport.links.broken.join('、')}</small>}{publicationReport.links.unpublished.length > 0 && <small>未公开：{publicationReport.links.unpublished.join('、')}</small>}</article>
          <article><strong>附件清单</strong><span>{publicationReport.assets.existing}/{publicationReport.assets.total} 可读取</span>{publicationReport.assets.missing.length > 0 && <small>缺失：{publicationReport.assets.missing.join('、')}</small>}</article>
        </div>
        <div className="blog-platform-readiness">{publicationReport.platforms.map(item => <span key={item.platform} data-ready={item.ready}><strong>{item.platformName}</strong><small>{item.format} · {item.characters.toLocaleString('zh-CN')} 字 · {item.warnings.length} 条平台提醒</small></span>)}</div>
        {publicationReport.related.length > 0 && <div className="blog-related-notes"><strong>可补充引用的相关文章</strong>{publicationReport.related.map(item => <span key={item.path}>{item.path}<small>相关度 {item.score.toFixed(3)}</small></span>)}</div>}
      </div> : <div className="blog-pending"><TriangleAlert />尚未执行发布就绪检查</div>}
    </section>

    <div className="blog-finish-grid">
      <section className="plain-block blog-finish-card">
        <div className="blog-card-title"><FileCheck2 /><div><strong>审核与定稿</strong><span>修改正文会自动撤销审核和定稿状态</span></div></div>
        {review ? <div className="blog-review-result">
          <strong>{review.blockers.length ? `${review.blockers.length} 个阻塞项` : '没有阻塞项'}</strong>
          <span>{review.warnings.length} 条提醒 · {review.diagramLines.length} 行图示超宽 · {review.longArticle ? '长文将分段写入' : '普通整稿写入'}</span>
          {[...review.blockers, ...review.warnings].map((item) => <small key={item}>△ {item}</small>)}
          {review.blockers.length > 0 && <Button variant="outline" onClick={() => void improveDraft('fix')} disabled={Boolean(busy)}>{busy === 'fix' ? <Loader2 className="spin" /> : <Sparkles />}修正阻塞项</Button>}
        </div> : <div className="blog-pending"><TriangleAlert />尚未审核</div>}
        <div className="blog-humanizer-actions">
          <Button variant="outline" onClick={() => void improveDraft('humanize')} disabled={Boolean(busy)}>{busy === 'humanize' ? <Loader2 className="spin" /> : <Sparkles />}DeepSeek 去 AI 味</Button>
          <label htmlFor="blog-humanizer">人工确认<select id="blog-humanizer" value={humanizer} onChange={(event) => { setHumanizer(event.target.value as HumanizerStatus); setFinalized(false); setPublishPack(null); }}><option value="pending">等待人工复核</option><option value="checked">已完成人工表达检查</option><option value="skipped">明确跳过</option></select></label>
          <small>AI 改写不会自动通过人工检查；请复核事实、代码和表达后再确认。</small>
        </div>
        <Button onClick={finalize} disabled={Boolean(busy)}><LockKeyhole />确认文章定稿</Button>
      </section>

      <section className="plain-block blog-finish-card"><div className="blog-card-title"><Send /><div><strong>多平台同步</strong><span>按平台规范生成 Markdown、富文本、纯文本和图卡</span></div></div><div className="blog-inline-actions"><Button variant="outline" onClick={createPublishPack} disabled={Boolean(busy)}>生成推广文案</Button><Button onClick={preparePlatforms} disabled={Boolean(busy)}>生成五平台物料</Button></div>{publishPack ? <div className="blog-publish-pack"><label>CSDN 简介（{publishPack.csdnIntro.length}/256）<Textarea readOnly value={publishPack.csdnIntro} rows={3} /></label><label>小红书标题（{publishPack.xiaohongshuTitle.length}/20）<Input readOnly value={publishPack.xiaohongshuTitle} /></label><label>小红书介绍（{publishPack.xiaohongshuIntro.length}/100）<Textarea readOnly value={publishPack.xiaohongshuIntro} rows={3} /></label></div> : <div className="blog-pending"><Clipboard />定稿后生成五个平台的适配物料</div>}</section>

      <section className="plain-block blog-finish-card blog-closure-card"><div className="blog-card-title"><Library /><div><strong>收尾入库</strong><span>先预览、再去重，最后由你审批写入唯一知识库</span></div></div><div className="blog-closure-fields"><Input value={closure.preference} onChange={(event) => setClosure({ ...closure, preference: event.target.value })} placeholder="新增偏好（可留空）" /><Input value={closure.style} onChange={(event) => setClosure({ ...closure, style: event.target.value })} placeholder="新增文风（可留空）" /><Input value={closure.requirement} onChange={(event) => setClosure({ ...closure, requirement: event.target.value })} placeholder="新增需求（可留空）" /><Input value={closure.pitfall} onChange={(event) => setClosure({ ...closure, pitfall: event.target.value })} placeholder="新增坑记录（可留空）" /></div><Button onClick={buildClosurePreview} disabled={Boolean(busy)}><BookCheck />展示收尾入库预览</Button></section>
    </div>

    <Dialog open={saveOpen} onOpenChange={setSaveOpen}><DialogContent className="plain-dialog"><DialogHeader><DialogTitle>确认写入 Markdown</DialogTitle><DialogDescription>已生成初稿不等于已写入。此操作会把当前版本保存到 Obsidian；同名文件仍需再次确认覆盖。</DialogDescription></DialogHeader><div className="blog-confirm-summary"><strong>{title || '未命名文章'}</strong><span>{review?.longArticle ? '长文：按完整段落顺序写入' : '普通文章：一次写入'}</span></div><DialogFooter><Button variant="outline" onClick={() => setSaveOpen(false)}>取消</Button><Button onClick={() => saveDraft(false)} disabled={busy === 'save'}>{busy === 'save' ? <Loader2 className="spin" /> : <Save />}确认并写入 Obsidian</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={aiConsentOpen} onOpenChange={setAiConsentOpen}><DialogContent className="plain-dialog"><DialogHeader><DialogTitle>确认使用 DeepSeek 生成</DialogTitle><DialogDescription>{mode === 'ai' ? '将把所选知识源、写作要求和预检摘要发送给 DeepSeek。' : '将把当前文章、修改要求和预检摘要发送给 DeepSeek。'}本机桥接会使用你的 API Key 鉴权，但不会发送平台账号、Cookie 或 Obsidian 完整路径。</DialogDescription></DialogHeader><div className="blog-ai-status" data-ready={deepseekConfigured}><strong>{deepseekConfigured ? 'DeepSeek 已配置，可以生成' : 'DeepSeek 尚未配置'}</strong><span>{deepseekConfigured ? '生成结果只进入当前编辑区，确认保存前不会写入 Obsidian。' : '请先在工作台设置中填写自己的 DeepSeek API Key。'}</span></div><DialogFooter><Button variant="outline" onClick={() => setAiConsentOpen(false)}>取消</Button>{deepseekConfigured ? <Button onClick={() => void generateDraft(true)}><Sparkles />同意并生成</Button> : <Button onClick={() => { setAiConsentOpen(false); onConfigure(); }}>打开设置</Button>}</DialogFooter></DialogContent></Dialog>

    <Dialog open={publishOpen} onOpenChange={setPublishOpen}><DialogContent className="plain-dialog blog-publish-dialog"><DialogHeader><DialogTitle>多平台物料与发布中心</DialogTitle><DialogDescription>每个平台的发布按钮会复制对应正文并打开官方创作页；图片、标题和排版仍需人工核对，工作台不会读取平台账号或替你点击最终发布。</DialogDescription></DialogHeader><div className="blog-platform-grid">{PLATFORMS.map(platform => { const item = preparedPlatforms[platform.id]; return item && <article key={platform.id} className={platform.id === 'xiaohongshu' ? 'blog-platform-xhs' : ''}><header><strong>{platform.name}</strong><Badge variant="outline">{item.format}</Badge></header><span>{item.characters.toLocaleString('zh-CN')} 字 · {item.warnings.length} 条提醒</span>{item.conversions.length > 0 && <small className="blog-conversion-summary">已转换：{item.conversions.join('、')}</small>}{item.warnings.map(warning => <small key={warning}>△ {warning}</small>)}{platform.id === 'xiaohongshu' && <strong className="blog-xhs-mode-title">长文笔记 · 纯文本</strong>}<div className="blog-inline-actions"><Button variant="outline" onClick={async () => { await copyText(item.title); onNotice(`${platform.name} 标题已复制。`); }}><Clipboard />复制标题</Button><Button variant="outline" onClick={async () => { await copyText(item.content); onNotice(`${platform.name} 正文已复制。`); }}><Clipboard />复制正文</Button><Button onClick={() => void publishToPlatform(item)}><ExternalLink />发布到{platform.name}</Button></div>{platform.id === 'xiaohongshu' && xiaohongshuCards.length > 0 && <><div className="blog-xhs-card-heading"><strong>图文笔记 · {xiaohongshuCards.length} 张 PNG</strong><span>Markdown 已转为 1080 × 1440 图卡，请逐张下载上传。</span><Button onClick={() => void publishToPlatform(item, 'cards')}><ExternalLink />发布图文笔记</Button></div><div className="blog-xhs-cards">{xiaohongshuCards.map((card, index) => <figure key={card.filename}><XiaohongshuCardPreview card={card} index={index} /><figcaption><span>第 {index + 1} 张 · 1080 × 1440</span><a href={card.dataUrl} download={card.filename}>下载 PNG</a></figcaption></figure>)}</div></>}</article>; })}</div></DialogContent></Dialog>

    <Dialog open={closureOpen} onOpenChange={setClosureOpen}><DialogContent className="plain-dialog"><DialogHeader><DialogTitle>收尾入库预览</DialogTitle><DialogDescription>未审批前不会写入长期记忆。重复条目会自动跳过。</DialogDescription></DialogHeader>{closurePreview && <div className="blog-closure-preview"><pre>{closurePreview.summary}</pre>{closurePreview.entries.map((item) => <div key={`${item.category}-${item.value}`}><Badge variant="outline">{item.duplicate ? '重复·跳过' : '拟写入'}</Badge><span><strong>{item.category}</strong><small>{item.value}</small><small>{item.target}</small></span></div>)}</div>}<DialogFooter><Button variant="outline" onClick={() => setClosureOpen(false)}>返回修改</Button><Button onClick={commitClosure} disabled={busy === 'closure-save'}>{busy === 'closure-save' ? <Loader2 className="spin" /> : <Check />}审批并写入知识库</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
