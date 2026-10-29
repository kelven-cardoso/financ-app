import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { categoriasDoTipo, categoriasFrequentes, normalizar } from '../lib/financas';
import type { Snapshot } from '../lib/tipos';
import { IconeCategoria } from './icones';

/**
 * Atalhos com as categorias mais usadas; "Mais" mostra todas as cadastradas e "Nova" deixa digitar uma
 * (ela entra no cadastro sozinha quando o lançamento é salvo).
 */
export function SeletorCategoria({ snap, tipo, valor, aoMudar, rotulo = 'Categoria', n = 9 }: {
  snap: Snapshot;
  tipo: 'saida' | 'entrada';
  valor: string;
  aoMudar: (v: string) => void;
  rotulo?: string;
  n?: number;
}) {
  const id = useId();
  const [todas, setTodas] = useState(false);
  const [nova, setNova] = useState(false);
  const frequentes = categoriasFrequentes(snap, tipo, n);
  const cadastradas = categoriasDoTipo(snap, tipo);
  const lista = todas ? [...new Set([...frequentes, ...cadastradas])] : frequentes;
  const temMais = cadastradas.some((c) => !frequentes.includes(c));
  const atualFora = !!valor && !nova && !lista.some((c) => normalizar(c) === normalizar(valor));
  const escolher = (c: string) => {
    setNova(false);
    aoMudar(c);
  };
  return (
    <div className="campo">
      <span className="rotulo" id={`${id}-r`}>{rotulo}</span>
      <div className="chips" role="group" aria-labelledby={`${id}-r`}>
        {lista.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={!nova && normalizar(valor) === normalizar(c)} onClick={() => escolher(c)}>
            <IconeCategoria categoria={c} snap={snap} /> {c}
          </button>
        ))}
        {atualFora && (
          <button type="button" className="chip" aria-pressed="true" onClick={() => setNova(true)}>
            <IconeCategoria categoria={valor} snap={snap} /> {valor}
          </button>
        )}
        {temMais && !todas && (
          <button type="button" className="chip" onClick={() => setTodas(true)}>Mais…</button>
        )}
        <button type="button" className="chip" aria-pressed={nova} onClick={() => { setNova(true); aoMudar(''); }}>
          <Plus aria-hidden="true" /> Nova
        </button>
      </div>
      {nova && (
        <input className="entrada" aria-label="Nome da nova categoria" value={valor} maxLength={60} autoFocus
          onChange={(e) => aoMudar(e.target.value)} placeholder="Ex.: Jogos, Academia" />
      )}
    </div>
  );
}
