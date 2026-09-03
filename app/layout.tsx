import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://self-growing-knowledge-workbench.grand-mite-0478.chatgpt.site'),
  title: '自生长知识库 · 智能体工作台',
  description: 'Obsidian、Python、MCP、向量检索与 Agent 组成的本地优先知识工作台。',
  openGraph: {
    title: '自生长知识库 · 智能体工作台',
    description: 'Obsidian、Python、MCP、向量检索与 Agent 组成的本地优先知识工作台。',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '自生长知识库 · 智能体工作台',
    description: 'Obsidian、Python、MCP、向量检索与 Agent 组成的本地优先知识工作台。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
