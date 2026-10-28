import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/hanken-grotesk';
import './estilos/app.css';
import { App } from './App';
import { ProvedorFinanc } from './lib/estado';
import { preferencia } from './lib/local';
import './lib/instalar';

// tema escolhido em Ajustes (sistema, claro ou escuro)
const tema = preferencia('tema', 'sistema');
if (tema === 'claro') document.documentElement.dataset.theme = 'light';
if (tema === 'escuro') document.documentElement.dataset.theme = 'dark';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProvedorFinanc>
      <App />
    </ProvedorFinanc>
  </StrictMode>,
);
