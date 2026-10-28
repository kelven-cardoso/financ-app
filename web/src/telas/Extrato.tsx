import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ReceiptText, Search } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { beneficios, corPadraoConta, normalizar } from '../lib/financas';
import { nomeMes, primeiraMaiuscula, somarMeses } from '../lib/formato';
import { Dinheiro, Segmentado, Vazio } from '../ui/base';
import { ListaPorDia } from '../ui/Lancamentos';

type FiltroMeio = 'todos' | 'conta' | `cartao:${number}` | `vale:${number}`;

export function Extrato() {
  const { snap } = useFinanc();
  const [mes, setMes] = useState<string | null>(null);
  const [tipo, setTipo] = useState<'tudo' | 'saida' | 'entrada'>('tudo');
  const [meio, setMeio] = useState<FiltroMeio>('todos');
  const [categoria, setCategoria] = useState('');
  const [busca, setBusca] = useState('');

  const atual = mes ?? snap?.mes ?? '';
  const lista = useMemo(() => {
    if (!snap) return [];
    const q = normalizar(busca);
    return snap.lancamentos.filter((l) => {
      if (!q && l.data.slice(0, 7) !== atual) return false;
      if (q && !(normalizar(l.descricao).includes(q) || normalizar(l.categoria).includes(q) || String(l.valor).includes(q.replace(',', '.')))) return false;
      if (tipo !== 'tudo' && l.tipo !== tipo) return false;
      if (categoria && l.categoria !== categoria) return false;
      if (meio === 'conta' && (l.metodo === 'credito' || l.metodo === 'vale')) return false;
      if (meio.startsWith('cartao:') && !(l.metodo === 'credito' && l.cartao_id === Number(meio.slice(7)))) return false;
      if (meio.startsWith('vale:') && !(l.metodo === 'vale' && l.conta_id === Number(meio.slice(5)))) return false;
      return true;
    });
  }, [snap, atual, tipo, meio, categoria, busca]);

  if (!snap) return null;
  const minMes = somarMeses(snap.mes, -12);
  const maxMes = snap.lancamentos.reduce((m, l) => (l.data.slice(0, 7) > m ? l.data.slice(0, 7) : m), snap.mes);
  const categoriasMes = [...new Set(snap.lancamentos.filter((l) => l.data.slice(0, 7) === atual).map((l) => l.categoria))].sort();
  const entradas = lista.filter((l) => l.tipo === 'entrada').reduce((s, l) => s + l.valor, 0);
  const saidas = lista.filter((l) => l.tipo === 'saida').reduce((s, l) => s + l.valor, 0);
  const vales = beneficios(snap);

  return (
    <>
      <header className="topo">
        <h1>Extrato</h1>
        {!busca && (
          <div className="seletor-mes">
            <button type="button" className="icone-btn" aria-label="Mês anterior" disabled={atual <= minMes} onClick={() => setMes(somarMeses(atual, -1))}><ChevronLeft size={20} /></button>
            <span className="rot">{primeiraMaiuscula(nomeMes(atual, atual.slice(0, 4) !== snap.hoje.slice(0, 4)))}</span>
            <button type="button" className="icone-btn" aria-label="Próximo mês" disabled={atual >= maxMes} onClick={() => setMes(somarMeses(atual, 1))}><ChevronRight size={20} /></button>
          </div>
        )}
      </header>

      <div className="busca">
        <Search aria-hidden="true" />
        <input className="entrada" type="search" placeholder="Buscar em todos os meses" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar lançamentos" />
      </div>

      <div style={{ marginBottom: 10 }}>
        <Segmentado rotulo="Tipo" valor={tipo} aoMudar={setTipo}
          opcoes={[{ valor: 'tudo', rotulo: 'Tudo' }, { valor: 'saida', rotulo: 'Saídas' }, { valor: 'entrada', rotulo: 'Entradas' }]} />
      </div>

      <div className="chips rolagem" style={{ marginBottom: 8 }} role="group" aria-label="Filtrar por meio">
        <button type="button" className="chip" aria-pressed={meio === 'todos'} onClick={() => setMeio('todos')}>Todos</button>
        {snap.cartoes.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={meio === `cartao:${c.id}`} onClick={() => setMeio(`cartao:${c.id}`)}>
            <span className="bolinha" style={{ background: c.cor ?? '#334155' }} aria-hidden="true" /> {c.nome}
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={meio === 'conta'} onClick={() => setMeio('conta')}>Pix, débito e boleto</button>
        {vales.map((v) => (
          <button key={v.id} type="button" className="chip" aria-pressed={meio === `vale:${v.id}`} onClick={() => setMeio(`vale:${v.id}`)}>
            <span className="bolinha" style={{ background: corPadraoConta(v) }} aria-hidden="true" /> {v.nome}
          </button>
        ))}
      </div>

      {categoriasMes.length > 1 && !busca && (
        <select className="entrada" style={{ marginBottom: 6 }} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Filtrar por categoria">
          <option value="">Todas as categorias</option>
          {categoriasMes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      <div className="totais">
        <div className="total-caixa"><div className="rot">Entradas</div><Dinheiro valor={entradas} tipo="entrada" /></div>
        <div className="total-caixa"><div className="rot">Saídas</div><Dinheiro valor={saidas} /></div>
      </div>

      {lista.length === 0 ? (
        <div className="grupo" style={{ marginTop: 14 }}>
          <Vazio icone={<ReceiptText />} titulo={busca ? 'Nada encontrado' : 'Nenhum lançamento neste mês'} texto={busca ? 'Tente outra palavra ou valor.' : 'Use o botão + para registrar.'} />
        </div>
      ) : (
        <ListaPorDia lancamentos={lista} snap={snap} />
      )}
    </>
  );
}
