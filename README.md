# CJY 知识工作台

这是可公开访问、可连接个人 Obsidian Vault 的知识工作台：保留 CJY 知识管理、任务、回顾、剪藏、知识图谱与博客写作流程。

## GitHub Pages

仓库包含独立的静态构建和 GitHub Actions 发布流程。推送到 `main` 后会自动部署公开演示页面：

公开网址：<https://cjy0722.github.io/cjy-knowledge-workbench/#blog>

```powershell
npm run build:pages
```

公开页面不会托管或上传任何人的知识库。每位使用者只需在自己的电脑上运行本地桥接并授权当前网页，就能让同一个公开页面读取自己的 Obsidian Vault。

## 连接自己的 Obsidian

需要 Node.js 22.13 或更高版本，并且目标文件夹已经由 Obsidian 初始化（包含 `.obsidian` 文件夹）。

1. 下载或克隆本项目，并安装依赖：

```powershell
git clone https://github.com/CJY0722/cjy-knowledge-workbench.git
cd cjy-knowledge-workbench
npm install
```

2. 启动只监听本机的桥接，把路径替换为自己的 Vault：

```powershell
npm run bridge -- --vault "D:\Notes\MyVault"
```

3. 打开 <https://cjy0722.github.io/cjy-knowledge-workbench/>，进入“设置”，点击“连接自己的 Obsidian”。
4. 在本机弹出的授权页核对网页来源和 Vault 名称，再点击“允许连接”。如果浏览器询问本地网络访问权限，请允许当前网页访问本机桥接。

授权只在当前浏览器标签页会话内有效。关闭桥接或标签页后，再次使用时需要重新授权。

### 本地开发与自己的 GitHub Pages

本地开发时另开一个终端运行：

```powershell
npm run dev -- --hostname 0.0.0.0 --port 3000
```

桥接默认允许本项目的公开网址以及 `localhost:3000` / `127.0.0.1:3000`。如果你 Fork 后使用自己的 GitHub Pages，需要额外允许自己的精确来源：

```powershell
npm run bridge -- --vault "D:\Notes\MyVault" --origin "https://USERNAME.github.io"
```

只填写来源（协议和域名），不要附加仓库路径。可重复使用 `--origin` 允许多个页面来源。

## 博客流程

1. 选择“AI 从知识源写作”或“已有文章 AI 辅助修改”。
2. 完成五类知识预检，并选择参考笔记。
3. 确认重点后生成或修改草稿；发送内容给 OpenAI 前会再次确认。
4. 运行结构、图示宽度、长文与去 AI 痕迹检查。
5. 明确确认后保存 Markdown，再生成 CSDN / 小红书发布文案。
6. 预览并确认复盘条目后，才会回写 Obsidian 元知识与写作事件日志。

五类预检会读取对应元知识，并沿博客索引加载相关旧文片段作为风格参考。元知识或事件日志即将超过 200 行或 10,000 字符时，桥接会按月份自动分篇。

## 安全边界

- 不读取或保存 CSDN Cookie、密码、Token，也不替用户点击最终发布。
- CSDN 功能只负责净化 Markdown、复制标题和正文、打开官方编辑器。
- PDF、图片等视觉材料需要先由用户完成渲染或 OCR，在界面中填写核验记录并明确确认后才能继续。
- 浏览器只保存当前会话草稿；长期知识只写入每位用户自己选择的 Obsidian Vault。
- 桥接只监听 `127.0.0.1`，并同时校验精确网页来源和本机配对令牌；令牌只保存在当前标签页的 `sessionStorage`。
- 桥接不会向网页返回 Vault 的完整本机路径，也不会把知识内容上传到 GitHub Pages。
- Fork 用户必须用 `--origin` 明确允许自己的网页来源，不接受任意 `*.github.io` 页面。
- “重扫知识库”是文件扫描，不宣称存在向量索引。

## 验证

```powershell
node bridge.test.mjs
npm run build
```
