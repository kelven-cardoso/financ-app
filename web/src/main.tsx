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

// pareamento do app Android: a chave chega no fragmento (#chave=...), que não vai para o servidor nem para os registros.
// Fica guardada só nesta aba até a tela de Captura confirmar (depois do login, se for o caso).
const parear = location.hash.match(/^#chave=([A-Za-z0-9_-]{32,128})$/);
if (parear) {
  try {
    sessionStorage.setItem('financ.parear', parear[1]);
  } catch {
    /* sem armazenamento: o pareamento é refeito pelo app */
  }
  history.replaceState(null, '', '/ajustes/captura');
}

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
