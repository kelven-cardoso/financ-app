import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { numero } from '../lib/formato';

// ---------------------------------------------------------------- dinheiro
export function Dinheiro({ valor, sinal, tipo, className }: { valor: number | null | undefined; sinal?: boolean; tipo?: 'entrada' | 'saida'; className?: string }) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return <span className={`din ${className ?? ''}`}>—</span>;
  const abs = Math.abs(valor);
  const [int, cent] = numero(abs).split(',');
  const neg = valor < -0.004;
  const classe = ['din', tipo === 'entrada' ? 'positivo' : '', className ?? ''].join(' ');
  const s = sinal ? (neg ? '−' : tipo === 'saida' ? '−' : '+') : neg ? '−' : '';
  return (
    <span className={classe}>
      {s && <span className="din-sinal">{s}</span>}
      <span className="din-moeda">R$</span>
      {int}
      <span className="din-cent">,{cent}</span>
    </span>
  );
}

// ---------------------------------------------------------------- folha (bottom sheet)
export function MolduraFolha({ rotulo, fechar, children, topo }: { rotulo: string; fechar: () => void; children: ReactNode; topo: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titulo = useId();
  useEffect(() => {
    if (!topo) return;
    const anterior = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // respeita o autoFocus do formulário; senão, foca o primeiro campo
    if (!el?.contains(document.activeElement)) {
      const foco = el?.querySelector<HTMLElement>('input, select, textarea, button:not(.icone-btn)');
      foco?.focus({ preventScroll: true });
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        fechar();
      }
      if (e.key === 'Tab' && el) {
        const itens = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!itens.length) return;
        const [p, u] = [itens[0], itens[itens.length - 1]];
        if (e.shiftKey && document.activeElement === p) { e.preventDefault(); u.focus(); }
        else if (!e.shiftKey && document.activeElement === u) { e.preventDefault(); p.focus(); }
      }
    };
    document.addEventListener('keydown', tecla);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla);
      document.body.style.overflow = '';
      anterior?.focus?.({ preventScroll: true });
    };
  }, [topo, fechar]);
  return (
    <>
      <div className="fundo-folha" onClick={fechar} aria-hidden="true" />
      <div className="folha" role="dialog" aria-modal="true" aria-labelledby={titulo} ref={ref}>
        <span className="folha-alca" aria-hidden="true" />
        <div className="folha-cab">
          <h2 id={titulo}>{rotulo}</h2>
          <button type="button" className="icone-btn" onClick={fechar} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

export function CorpoFolha({ children }: { children: ReactNode }) {
  return <div className="folha-corpo">{children}</div>;
}

export function RodapeFolha({ children }: { children: ReactNode }) {
  return <div className="folha-rodape">{children}</div>;
}

// ---------------------------------------------------------------- torradas (avisos rápidos)
type Torrada = { id: number; texto: string; erro?: boolean };
const CtxTorrada = createContext<(texto: string, erro?: boolean) => void>(() => undefined);

export function ProvedorTorradas({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Torrada | null>(null);
  const timer = useRef<number>(0);
  const mostrar = useCallback((texto: string, erro = false) => {
    window.clearTimeout(timer.current);
    setT({ id: Date.now(), texto, erro });
    timer.current = window.setTimeout(() => setT(null), erro ? 5200 : 2600);
  }, []);
  return (
    <CtxTorrada.Provider value={mostrar}>
      {children}
      <div aria-live="polite" role="status">
        {t && (
          <div key={t.id} className={`torrada ${t.erro ? 'erro' : ''}`}>
            {t.texto}
          </div>
        )}
      </div>
    </CtxTorrada.Provider>
  );
}

export function useTorrada() {
  return useContext(CtxTorrada);
}

// ---------------------------------------------------------------- campos
export function Segmentado<T extends string>({ opcoes, valor, aoMudar, rotulo }: { opcoes: { valor: T; rotulo: string }[]; valor: T; aoMudar: (v: T) => void; rotulo: string }) {
  return (
    <div className="segmentado" role="group" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button key={o.valor} type="button" aria-pressed={o.valor === valor} onClick={() => aoMudar(o.valor)}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/** campo de valor estilo app de banco: os dígitos entram pelos centavos (4250 -> 42,50) */
export function CampoValor({ valor, aoMudar, rotulo, entradaCor, autoFocus, id }: { valor: number; aoMudar: (v: number) => void; rotulo: string; entradaCor?: boolean; autoFocus?: boolean; id?: string }) {
  const texto = valor ? numero(valor) : '';
  return (
    <div className={`valor-grande ${entradaCor ? 'entrada-cor' : ''}`}>
      <span className="moeda" aria-hidden="true">R$</span>
      <input
        id={id}
        aria-label={rotulo}
        inputMode="numeric"
        autoComplete="off"
        placeholder="0,00"
        value={texto}
        autoFocus={autoFocus}
        onChange={(e) => {
          const digitos = e.target.value.replace(/\D/g, '').slice(0, 11);
          aoMudar(digitos ? Number(digitos) / 100 : 0);
        }}
      />
    </div>
  );
}

/** valor menor, dentro de formulários (aceita negativo quando permitido) */
export function CampoDinheiro({ valor, aoMudar, id, permitirNegativo, placeholder }: { valor: number | null; aoMudar: (v: number | null) => void; id: string; permitirNegativo?: boolean; placeholder?: string }) {
  const [neg, setNeg] = useState(valor !== null && valor < 0);
  const texto = valor === null ? '' : numero(Math.abs(valor));
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {permitirNegativo && (
        <button type="button" className="btn sec" style={{ width: 48, padding: 0 }} aria-label={neg ? 'Valor negativo' : 'Valor positivo'}
          onClick={() => { setNeg(!neg); if (valor !== null) aoMudar(-valor); }}>
          {neg ? '−' : '+'}
        </button>
      )}
      <input
        id={id}
        className="entrada num"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder ?? '0,00'}
        value={texto}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, '').slice(0, 11);
          if (!d) return aoMudar(null);
          const v = Number(d) / 100;
          aoMudar(neg ? -v : v);
        }}
      />
    </div>
  );
}

export function Interruptor({ rotulo, dica, valor, aoMudar }: { rotulo: string; dica?: string; valor: boolean; aoMudar: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="interruptor">
      <label htmlFor={id} style={{ display: 'grid', gap: 2 }}>
        <span style={{ fontWeight: 550 }}>{rotulo}</span>
        {dica && <span className="nota">{dica}</span>}
      </label>
      <input id={id} type="checkbox" role="switch" checked={valor} onChange={(e) => aoMudar(e.target.checked)} />
    </div>
  );
}

export function Vazio({ icone, titulo, texto, acao }: { icone?: ReactNode; titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="vazio">
      {icone}
      <h3>{titulo}</h3>
      {texto && <p style={{ margin: '0 0 14px' }}>{texto}</p>}
      {acao}
    </div>
  );
}

export function Medidor({ pct, rotulo }: { pct: number; rotulo: string }) {
  const p = Math.max(0, Math.min(100, pct));
  const classe = pct >= 100 ? 'estourou' : pct >= 80 ? 'alerta' : '';
  return (
    <div className={`medidor ${classe}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={rotulo}>
      <span style={{ width: `${p}%` }} />
    </div>
  );
}

/** confirmação dentro de folha */
export function Confirmar({ texto, acao, rotuloAcao, perigo, fechar, depois }: { texto: ReactNode; acao: () => Promise<void> | void; rotuloAcao: string; perigo?: boolean; fechar: () => void; depois?: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <>
      <CorpoFolha>
        {erro && <div className="erro-form">{erro}</div>}
        <div style={{ color: 'var(--ink-2)', marginBottom: 6 }}>{texto}</div>
      </CorpoFolha>
      <RodapeFolha>
        <div className="acoes">
          <button type="button" className="btn sec" onClick={fechar}>Cancelar</button>
          <button
            type="button"
            className={`btn ${perigo ? 'perigo' : ''}`}
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true);
              setErro(null);
              try {
                await acao();
                if (depois) {
                  // navega só depois que a folha fechar (o voltar do histórico é assíncrono)
                  const f = () => {
                    window.removeEventListener('popstate', f);
                    setTimeout(depois, 0);
                  };
                  window.addEventListener('popstate', f);
                }
                fechar();
              } catch (e) {
                setErro((e as Error).message);
                setOcupado(false);
              }
            }}
          >
            {rotuloAcao}
          </button>
        </div>
      </RodapeFolha>
    </>
  );
}
