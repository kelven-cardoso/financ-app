import type { CSSProperties, ReactNode } from 'react';
import { textoSobre, tom } from '../lib/financas';
import { Dinheiro } from './base';

type Props = {
  nome: string;
  cor: string;
  tipo: string;
  final?: string | null;
  bandeira?: string | null;
  rotuloValor?: string;
  valor?: number | null;
  rodapeDireita?: ReactNode;
  aoClicar?: () => void;
  rotuloAcessivel?: string;
};

function Ondas() {
  // símbolo genérico de pagamento por aproximação
  return (
    <svg className="cartao-onda" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M8.5 7.5a6.5 6.5 0 0 1 0 9" />
      <path d="M12 5a10 10 0 0 1 0 14" />
      <path d="M15.5 2.8a13.4 13.4 0 0 1 0 18.4" />
    </svg>
  );
}

/** o cartão desenhado: proporção real (85,6 × 54 mm), cor escolhida pelo usuário, sem logos de marca */
export function CartaoVisual({ nome, cor, tipo, final, bandeira, rotuloValor, valor, rodapeDireita, aoClicar, rotuloAcessivel }: Props) {
  const estilo = {
    '--c1': tom(cor, 0.06),
    '--c2': tom(cor, -0.42),
    '--txt': textoSobre(cor),
  } as CSSProperties;
  const corpo = (
    <span className="cartao-corpo">
      <span className="cartao-topo">
        <span style={{ minWidth: 0 }}>
          <span className="cartao-nome" style={{ display: 'block' }}>{nome}</span>
          <span className="cartao-tipo" style={{ display: 'block' }}>{tipo}</span>
        </span>
        {valor !== undefined && (
          <span className="cartao-fatura">
            {rotuloValor && <span className="rot" style={{ display: 'block' }}>{rotuloValor}</span>}
            <Dinheiro valor={valor} />
          </span>
        )}
      </span>
      <span className="cartao-meio">
        <span className="chip-ouro" aria-hidden="true" />
        <Ondas />
      </span>
      <span className="cartao-pe">
        <span className="cartao-final">{final ? `•••• ${final}` : '•••• ••••'}</span>
        {rodapeDireita ?? (bandeira ? <span className="cartao-bandeira">{bandeira}</span> : null)}
      </span>
    </span>
  );
  return (
    <div className="cartao-wrap">
      {aoClicar ? (
        <button type="button" className="cartao" style={estilo} onClick={aoClicar} aria-label={rotuloAcessivel ?? nome}>
          {corpo}
        </button>
      ) : (
        <div className="cartao" style={estilo} role="img" aria-label={rotuloAcessivel ?? nome}>
          {corpo}
        </div>
      )}
    </div>
  );
}
