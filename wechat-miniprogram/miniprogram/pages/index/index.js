const { auditDraft, extractTasks, knowledgeStats, makeNote, preparePlatform } = require('../../utils/markdown');

const STORAGE_KEY = 'cjy-workbench-notes-v1';
const EMPTY_STATS = { edges: [], brokenLinks: [], orphans: [], stale: [], metadataCoverage: 100, linkIntegrity: 100 };
const PLATFORMS = ['csdn', 'juejin', 'zhihu', 'wechat', 'xiaohongshu'];

Page({
  data: {
    tabs: [
      { id: 'overview', label: '概览' }, { id: 'today', label: '今日' },
      { id: 'library', label: '知识库' }, { id: 'clippings', label: '剪藏' },
      { id: 'graph', label: '图谱' }, { id: 'review', label: '回顾' },
      { id: 'blog', label: '博客写作' }, { id: 'settings', label: '设置' },
    ],
    activeTab: 'overview', notes: [], filteredNotes: [], tasks: [], clippings: [], stats: EMPTY_STATS,
    query: '', selectedId: '', editorTitle: '', editorBody: '', notice: '',
    clippingTitle: '', clippingBody: '', reviewIndex: 0, reviewNote: null,
    audit: null, materials: [], activeMaterial: null, publishStarted: false,
  },

  onLoad() {
    let notes = [];
    try { notes = wx.getStorageSync(STORAGE_KEY) || []; } catch { notes = []; }
    this.setData({ notes });
    this.refreshDerived();
  },

  selectTab(event) { this.setData({ activeTab: event.currentTarget.dataset.tab, notice: '' }); },
  setQuery(event) { this.setData({ query: event.detail.value }); this.refreshDerived(); },
  setEditorTitle(event) { this.setData({ editorTitle: event.detail.value, audit: null, materials: [], activeMaterial: null, publishStarted: false }); },
  setEditorBody(event) { this.setData({ editorBody: event.detail.value, audit: null, materials: [], activeMaterial: null, publishStarted: false }); },
  setClippingTitle(event) { this.setData({ clippingTitle: event.detail.value }); },
  setClippingBody(event) { this.setData({ clippingBody: event.detail.value }); },

  refreshDerived() {
    const query = this.data.query.trim().toLowerCase();
    const filteredNotes = this.data.notes.filter(note => !query || `${note.title}\n${note.fileName}\n${note.content}`.toLowerCase().includes(query));
    const tasks = this.data.notes.flatMap(note => extractTasks(note.content).map(task => ({ ...task, noteId: note.id, noteTitle: note.title })));
    const stats = knowledgeStats(this.data.notes);
    const reviewCandidates = [...stats.stale, ...stats.orphans.filter(note => !stats.stale.some(item => item.id === note.id))];
    const reviewIndex = reviewCandidates.length ? this.data.reviewIndex % reviewCandidates.length : 0;
    this.setData({ filteredNotes, tasks, stats, clippings: this.data.notes.filter(note => note.kind === 'clipping'), reviewIndex, reviewNote: reviewCandidates[reviewIndex] || null });
  },

  persist(notes, notice) {
    try {
      wx.setStorageSync(STORAGE_KEY, notes);
      this.setData({ notes, notice });
      this.refreshDerived();
    } catch {
      this.setData({ notice: '保存失败：当前设备的小程序存储空间不足，请先导出重要文章。' });
    }
  },

  importMarkdown() {
    wx.chooseMessageFile({
      count: 20,
      type: 'file',
      extension: ['md', 'markdown', 'txt'],
      success: async result => {
        const imported = [];
        let skipped = 0;
        for (const file of result.tempFiles) {
          if (file.size > 2 * 1024 * 1024) { skipped += 1; continue; }
          try {
            const content = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8', success: value => resolve(value.data), fail: reject }));
            imported.push(makeNote(file.name, content));
          } catch { skipped += 1; }
        }
        this.persist([...imported, ...this.data.notes], `已导入 ${imported.length} 篇${skipped ? `，跳过 ${skipped} 个无效或过大的文件` : ''}。`);
      },
      fail: error => {
        if (!String(error.errMsg || '').includes('cancel')) this.setData({ notice: '导入失败，请从微信会话选择 Markdown 或 TXT 文件。' });
      },
    });
  },

  openNote(event) {
    const note = this.data.notes.find(item => item.id === event.currentTarget.dataset.id);
    if (!note) return;
    this.setData({ activeTab: 'blog', selectedId: note.id, editorTitle: note.title, editorBody: note.content, audit: null, materials: [], activeMaterial: null, publishStarted: false, notice: `正在编辑：${note.title}` });
  },

  newDraft() {
    const clear = () => this.setData({ activeTab: 'blog', selectedId: '', editorTitle: '', editorBody: '', audit: null, materials: [], activeMaterial: null, publishStarted: false, notice: '已新建本地草稿。' });
    if (!this.data.editorTitle && !this.data.editorBody) return clear();
    wx.showModal({ title: '新建原创文章', content: '这会清空当前编辑区。已经保存到知识库的文章不会删除。', success: result => { if (result.confirm) clear(); } });
  },

  saveDraft() {
    const title = this.data.editorTitle.trim();
    const body = this.data.editorBody.trim();
    if (!title || !body) return this.setData({ notice: '标题和正文不能为空。' });
    const existing = this.data.notes.find(item => item.id === this.data.selectedId);
    const note = makeNote(existing?.fileName || `${title}.md`, body, existing?.id);
    note.title = title;
    note.kind = existing?.kind || 'note';
    note.updated = new Date().toISOString();
    const notes = existing ? this.data.notes.map(item => item.id === existing.id ? note : item) : [note, ...this.data.notes];
    this.setData({ selectedId: note.id, editorBody: body });
    this.persist(notes, '草稿已保存在当前设备。');
  },

  copyDraft() {
    if (!this.data.editorBody.trim()) return this.setData({ notice: '正文为空，无法复制。' });
    wx.setClipboardData({ data: this.data.editorBody, success: () => this.setData({ notice: 'Markdown 正文已复制。' }) });
  },

  exportDraft() {
    if (!this.data.editorBody.trim()) return this.setData({ notice: '正文为空，无法导出。' });
    const safeTitle = (this.data.editorTitle || '未命名文章').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
    const filePath = `${wx.env.USER_DATA_PATH}/${safeTitle}.md`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: this.data.editorBody,
      encoding: 'utf8',
      success: () => {
        if (typeof wx.shareFileMessage !== 'function') return this.copyDraft();
        wx.shareFileMessage({ filePath, fileName: `${safeTitle}.md`, success: () => this.setData({ notice: 'Markdown 已导出，可发送到电脑后放入自己的 Obsidian。' }), fail: () => this.setData({ notice: '导出已取消，文章仍保存在当前设备。' }) });
      },
      fail: () => this.setData({ notice: '导出失败，请先复制 Markdown 作为备份。' }),
    });
  },

  toggleTask(event) {
    const note = this.data.notes.find(item => item.id === event.currentTarget.dataset.note);
    const lineNumber = Number(event.currentTarget.dataset.line);
    if (!note || !lineNumber) return;
    const lines = note.content.split('\n');
    lines[lineNumber - 1] = lines[lineNumber - 1].replace(/\[([ xX])\]/, (_, mark) => mark.toLowerCase() === 'x' ? '[ ]' : '[x]');
    const updated = makeNote(note.fileName, lines.join('\n'), note.id);
    updated.kind = note.kind;
    updated.updated = new Date().toISOString();
    this.persist(this.data.notes.map(item => item.id === note.id ? updated : item), '任务状态已保存在当前设备。');
  },

  saveClipping() {
    const title = this.data.clippingTitle.trim();
    const body = this.data.clippingBody.trim();
    if (!title || !body) return this.setData({ notice: '剪藏标题和内容不能为空。' });
    const date = new Date().toISOString().slice(0, 10);
    const note = makeNote(`00-收件箱/${title}.md`, `---\ntitle: ${JSON.stringify(title)}\ntype: clipping\ntags: [剪藏]\ncreated: ${date}\n---\n\n# ${title}\n\n${body}`);
    note.kind = 'clipping';
    this.setData({ clippingTitle: '', clippingBody: '' });
    this.persist([note, ...this.data.notes], '剪藏已存入当前设备的收件箱。');
  },

  nextReview() {
    const count = this.data.stats.stale.length + this.data.stats.orphans.filter(note => !this.data.stats.stale.some(item => item.id === note.id)).length;
    if (!count) return;
    this.setData({ reviewIndex: (this.data.reviewIndex + 1) % count });
    this.refreshDerived();
  },

  runAudit() {
    const audit = auditDraft(this.data.editorTitle, this.data.editorBody);
    this.setData({ audit, materials: [], activeMaterial: null, publishStarted: false, notice: audit.ready ? '文章检查完成，可以生成平台物料。' : `发现 ${audit.blockers.length} 个发布阻塞项。` });
  },

  generateMaterials() {
    const audit = auditDraft(this.data.editorTitle, this.data.editorBody);
    if (!audit.ready) return this.setData({ audit, notice: '请先解决文章检查中的阻塞项。' });
    const materials = PLATFORMS.map(platform => preparePlatform(platform, this.data.editorTitle.trim(), this.data.editorBody));
    this.setData({ audit, materials, activeMaterial: materials[0], publishStarted: false, notice: '五个平台物料已生成；发布前请人工核对排版和图片。' });
  },

  selectMaterial(event) {
    const activeMaterial = this.data.materials.find(item => item.platform === event.currentTarget.dataset.platform);
    this.setData({ activeMaterial });
  },

  copyMaterial() {
    if (!this.data.activeMaterial) return;
    wx.setClipboardData({ data: this.data.activeMaterial.content, success: () => this.setData({ publishStarted: true, notice: `${this.data.activeMaterial.name} 物料已复制。请打开对应平台人工发布。` }) });
  },

  copyMaterialTitle() {
    if (!this.data.activeMaterial) return;
    wx.setClipboardData({ data: this.data.activeMaterial.title, success: () => this.setData({ notice: `${this.data.activeMaterial.name} 标题已复制。` }) });
  },

  completePublish() {
    if (!this.data.publishStarted) return this.setData({ notice: '请先复制至少一个平台的发布物料。' });
    wx.showModal({
      title: '确认已经发布',
      content: '确认后会清空当前编辑区和平台物料，但不会删除知识库中已保存的文章。',
      success: result => {
        if (!result.confirm) return;
        this.setData({ selectedId: '', editorTitle: '', editorBody: '', audit: null, materials: [], activeMaterial: null, publishStarted: false, notice: '发布流程已完成，编辑区已清空。' });
      },
    });
  },
});
