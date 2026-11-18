import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Order matters: tokens first, then base, then areas, motion last.
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/today.css';
import './styles/study.css';
import './styles/lists.css';
import './styles/detail.css';
import './styles/settings.css';
import './styles/activity.css';
import './styles/tools.css';
import './styles/motion.css';
import { registerOffline } from './platform/offline';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
void registerOffline().catch(() => {});
