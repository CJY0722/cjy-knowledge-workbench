const { extractTasks, makeNote } = require('../../utils/markdown');

const STORAGE_KEY = 'cjy-workbench-notes-v1';

Page({
  data: {
    tabs: [
      { id: 'overview', label: '概览' },
      { id: 'today', label: '今日' },
      { id: 'library', label: '知识库' },
      { id: 'blog', label: '博客写作' },
      { id: 'settings', label: '设置' },
    ],
    activeTab: 'overview',
    notes: [],
    filteredNotes: [],
    tasks: [],
    query: '',
    selectedId: '',
    editorTitle: '',
    editorBody: '',
    notice: '',
  },

  onLoad() {
    let notes = [];
    try { notes = wx.getStorageSync(STORAGE_KEY) || []; } catch { notes = []; }
    this.setData({ notes });
    this.refreshDerived();
  },

  selectTab(event) {
    this.setData({ activeTab: event.currentTarget.dataset.tab, notice: '' });
  },

  setQuery(event) {
    this.setData({ query: event.detail.value });
    this.refreshDerived();
  },

  refreshDerived() {
    const query = this.data.query.trim().toLowerCase();
    const filteredNotes = this.data.notes.filter(note => !query || `${note.title}\n${note.content}`.toLowerCase().includes(query));
    const tasks = this.data.notes.flatMap(note => extractTasks(note.content).map(task => ({ ...task, noteId: note.id, noteTitle: note.title })));
    this.setData({ filteredNotes, tasks });
  },

  persist(notes, notice) {
    try {
      wx.setStorageSync(STORAGE_KEY, notes);
      this.setData({ notes, notice });
      this.refreshDerived();
    } catch {
      this.setData({ notice: '保存失败：当前设备的小程序存储空间不足。' });
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
    this.setData({ activeTab: 'blog', selectedId: note.id, editorTitle: note.title, editorBody: note.content, notice: `正在编辑：${note.title}` });
  },

  newDraft() {
    this.setData({ activeTab: 'blog', selectedId: '', editorTitle: '', editorBody: '', notice: '已新建本地草稿。' });
  },

  setEditorTitle(event) { this.setData({ editorTitle: event.detail.value }); },
  setEditorBody(event) { this.setData({ editorBody: event.detail.value }); },

  saveDraft() {
    const title = this.data.editorTitle.trim();
    const body = this.data.editorBody.trim();
    if (!title || !body) return this.setData({ notice: '标题和正文不能为空。' });
    const existing = this.data.notes.find(item => item.id === this.data.selectedId);
    const note = makeNote(existing?.fileName || `${title}.md`, body, existing?.id);
    note.title = title;
    const notes = existing ? this.data.notes.map(item => item.id === existing.id ? note : item) : [note, ...this.data.notes];
    this.setData({ selectedId: note.id, editorBody: body });
    this.persist(notes, '草稿已保存在当前设备。');
  },

  copyDraft() {
    if (!this.data.editorBody.trim()) return this.setData({ notice: '正文为空，无法复制。' });
    wx.setClipboardData({ data: this.data.editorBody, success: () => this.setData({ notice: 'Markdown 正文已复制。' }) });
  },
});
