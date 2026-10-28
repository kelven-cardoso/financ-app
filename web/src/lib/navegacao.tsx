import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

// ---------------------------------------------------------------- rotas (history API)
const EVENTO = 'financ:rota';

function assinar(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVENTO, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVENTO, cb);
  };
}

export function useRota(): string {
  return useSyncExternalStore(assinar, () => location.pathname, () => '/');
}

export function ir(caminho: string, opts: { substituir?: boolean } = {}): void {
  if (caminho === location.pathname) return;
  if (opts.substituir) history.replaceState({ app: true }, '', caminho);
  else history.pushState({ app: true }, '', caminho);
  window.dispatchEvent(new Event(EVENTO));
  window.scrollTo({ top: 0 });
}

export function voltar(alternativa = '/'): void {
  if (history.state?.app) history.back();
  else ir(alternativa, { substituir: true });
}

/** fecha a folha aberta e só depois navega (o voltar do histórico é assíncrono) */
export function irDepoisDeFechar(fechar: () => void, caminho: string): void {
  const depois = () => {
    window.removeEventListener('popstate', depois);
    setTimeout(() => ir(caminho), 0);
  };
  window.addEventListener('popstate', depois);
  fechar();
}

// ---------------------------------------------------------------- folhas (bottom sheets)
// Cada folha aberta ganha uma entrada no histórico: o botão voltar do Android fecha a folha.

type Folha = { id: number; render: (fechar: () => void) => ReactNode; rotulo: string };
type CtxFolhas = { abrir: (rotulo: string, render: (fechar: () => void) => ReactNode) => void; fecharTopo: () => void };

const ContextoFolhas = createContext<CtxFolhas | null>(null);

export function useFolhas(): CtxFolhas {
  const c = useContext(ContextoFolhas);
  if (!c) throw new Error('useFolhas fora do provedor');
  return c;
}

let seq = 1;

export function ProvedorFolhas({ children, Moldura }: { children: ReactNode; Moldura: (p: { rotulo: string; fechar: () => void; children: ReactNode; topo: boolean }) => ReactNode }) {
  const [folhas, setFolhas] = useState<Folha[]>([]);
  const folhasRef = useRef<Folha[]>([]);
  folhasRef.current = folhas;

  useEffect(() => {
    const aoVoltar = (e: PopStateEvent) => {
      if (folhasRef.current.length && !(e.state && e.state.folha === folhasRef.current[folhasRef.current.length - 1].id)) {
        setFolhas((f) => f.slice(0, -1));
      }
    };
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, []);

  const abrir = useCallback((rotulo: string, render: Folha['render']) => {
    const id = seq++;
    history.pushState({ folha: id, rota: location.pathname }, '');
    setFolhas((f) => [...f, { id, render, rotulo }]);
  }, []);

  const fecharTopo = useCallback(() => {
    if (folhasRef.current.length) history.back();
  }, []);

  return (
    <ContextoFolhas.Provider value={{ abrir, fecharTopo }}>
      {children}
      {folhas.map((f, i) => (
        <Moldura key={f.id} rotulo={f.rotulo} fechar={fecharTopo} topo={i === folhas.length - 1}>
          {f.render(fecharTopo)}
        </Moldura>
      ))}
    </ContextoFolhas.Provider>
  );
}
