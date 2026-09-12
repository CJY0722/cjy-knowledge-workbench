import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KnowledgeWorkbench } from '@/app/knowledge-workbench';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KnowledgeWorkbench />
  </StrictMode>,
);
