import { useSyncExternalStore } from 'react';

// O Chrome avisa quando o app pode ser instalado; guardamos o evento para o botão em Ajustes.
type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let evento: EventoInstalar | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  evento = e as EventoInstalar;
  avisar();
});
window.addEventListener('appinstalled', () => {
  evento = null;
  avisar();
});

function assinar(cb: () => void) {
  ouvintes.add(cb);
  return () => ouvintes.delete(cb);
}

export function useInstalacao() {
  const pronto = useSyncExternalStore(assinar, () => evento !== null);
  const instalado = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return {
    instalado,
    podeInstalar: pronto && !instalado,
    dicaIos: ios && !instalado,
    instalar: async () => {
      if (!evento) return false;
      await evento.prompt();
      const r = await evento.userChoice;
      evento = null;
      avisar();
      return r.outcome === 'accepted';
    },
  };
}
