import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ReceiptText, Search } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { ir } from '../lib/navegacao';
import { beneficios, corPadraoConta, faturaDoMes, normalizar, previstosDoMes } from '../lib/financas';
import { dataCurta, nomeMes, primeiraMaiuscula, reais, somarMeses } from '../lib/formato';
import type { Lancamento, Previsto } from '../lib/tipos';
import { Dinheiro, Segmentado, Vazio } from '../ui/base';
import { ListaPorDia } from '../ui/Lancamentos';

type FiltroMeio = 'todos' | 'conta' | `cartao:${number}` | `vale:${number}`;

/** o lançamento/previsto passa no filtro de meio? */
function noMeio(x: Pick<Lancamento, 'metodo' | 'cartao_id' | 'conta_id'>, meio: FiltroMeio): boolean {
  if (meio === 'todos') return true;
  if (meio === 'conta') return x.metodo !== 'credito' && x.metodo !== 'vale';
  if (meio.startsWith('cartao:')) return x.metodo === 'credito' && x.cartao_id === Number(meio.slice(7));
  return x.metodo === 'vale' && x.conta_id === Number(meio.slice(5));
}

export function Extrato() {
  const { snap } = useFinanc();
  const [mes, setMes] = useState<string | null>(null);
  const [tipo, setTipo] = useState<'tudo' | 'saida' | 'entrada'>('tudo');
  const [meio, setMeio] = useState<FiltroMeio>('todos');
  const [base, setBase] = useState<'fatura' | 'data'>('fatura');
  const [categoria, setCategoria] = useState('');
  const [busca, setBusca] = useState('');

  const atual = mes ?? snap?.mes ?? '';
  const cartaoId = meio.startsWith('cartao:') ? Number(meio.slice(7)) : null;
  const porFatura = cartaoId !== null && base === 'fatura';

  const { lista, previstos } = useMemo(() => {
    if (!snap) return { lista: [] as Lancamento[], previstos: [] as Previsto[] };
    const q = normalizar(busca);
    const lista = snap.lancamentos.filter((l) => {
      if (!q && (porFatura ? l.competencia : l.data.slice(0, 7)) !== atual) return false;
      if (q && !(normalizar(l.descricao).includes(q) || normalizar(l.categoria).includes(q) || String(l.valor).includes(q.replace(',', '.')))) return false;
      if (tipo !== 'tudo' && l.tipo !== tipo) return false;
      if (categoria && l.categoria !== categoria) return false;
      return noMeio(l, meio);
    });
    const previstos = q ? [] : previstosDoMes(snap, atual, porFatura).filter((p) =>
      (tipo === 'tudo' || p.tipo === tipo) && (!categoria || p.categoria === categoria) && noMeio(p, meio));
    return { lista, previstos };
  }, [snap, atual, tipo, meio, categoria, busca, porFatura]);

  if (!snap) return null;
  const minMes = somarMeses(snap.mes, -12);
  const ultimoLancado = snap.lancamentos.reduce((m, l) => {
    const k = porFatura ? l.competencia : l.data.slice(0, 7);
    return k > m ? k : m;
  }, snap.mes);
  const maxMes = [ultimoLancado, ...(snap.previstos ?? []).map((p) => (porFatura ? p.competencia : p.mes))].reduce((a, b) => (b > a ? b : a), snap.mes);
  const doMes = snap.lancamentos.filter((l) => (porFatura ? l.competencia : l.data.slice(0, 7)) === atual);
  const categoriasMes = [...new Set([...doMes.map((l) => l.categoria), ...previstosDoMes(snap, atual, porFatura).map((p) => p.categoria)])].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const futuro = (l: Lancamento) => l.data > snap.hoje;
  const soma = (t: 'entrada' | 'saida') => lista.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0) + previstos.filter((p) => p.tipo === t).reduce((s, p) => s + p.valor, 0);
  const aVir = (t: 'entrada' | 'saida') => lista.filter((l) => l.tipo === t && futuro(l)).reduce((s, l) => s + l.valor, 0) + previstos.filter((p) => p.tipo === t).reduce((s, p) => s + p.valor, 0);
  const entradas = soma('entrada');
  const saidas = soma('saida');
  const entradasAVir = aVir('entrada');
  const saidasAVir = aVir('saida');
  const vales = beneficios(snap);
  const cartao = cartaoId !== null ? snap.cartoes.find((c) => c.id === cartaoId) : undefined;
  const fatura = cartao && porFatura ? faturaDoMes(cartao, atual) : undefined;
  const somaFatura = lista.reduce((s, l) => s + (l.tipo === 'saida' ? l.valor : -l.valor), 0) + previstos.reduce((s, p) => s + (p.tipo === 'saida' ? p.valor : -p.valor), 0);
  const semDetalhe = fatura ? Math.round((fatura.valor_fatura - somaFatura) * 100) / 100 : 0;
  const filtrado = tipo !== 'tudo' || !!categoria;

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

      {cartao && !busca && (
        <div style={{ margin: '4px 0 8px' }}>
          <Segmentado rotulo="Agrupar compras do cartão" valor={base} aoMudar={setBase}
            opcoes={[{ valor: 'fatura', rotulo: 'Por fatura' }, { valor: 'data', rotulo: 'Pela data da compra' }]} />
        </div>
      )}

      {categoriasMes.length > 1 && !busca && (
        <select className="entrada" style={{ marginBottom: 6 }} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Filtrar por categoria">
          <option value="">Todas as categorias</option>
          {categoriasMes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {porFatura && cartao && !busca ? (
        <div className="total-caixa fatura-caixa">
          <div>
            <div className="rot">Fatura de {nomeMes(atual)}{fatura ? `, vence ${dataCurta(fatura.vencimento)}` : ''}</div>
            <Dinheiro valor={filtrado ? somaFatura : fatura?.valor_fatura ?? somaFatura} />
            {!filtrado && Math.abs(semDetalhe) > 0.01 && (
              <div className="nota">
                {semDetalhe > 0
                  ? `Inclui ${reais(semDetalhe)} do total informado que não está lançado item a item.`
                  : `Os lançamentos somam ${reais(-semDetalhe)} a mais que o total informado.`}
              </div>
            )}
            {filtrado && <div className="nota">Só o que está no filtro.</div>}
          </div>
          <button type="button" className="link" onClick={() => ir(`/carteira/cartao/${cartao.id}?mes=${atual}`)}>Ver fatura</button>
        </div>
      ) : (
        <div className="totais">
          <div className="total-caixa">
            <div className="rot">Entradas</div>
            <Dinheiro valor={entradas} tipo="entrada" />
            {entradasAVir > 0.004 && !busca && <div className="nota">{reais(entradasAVir)} a receber</div>}
          </div>
          <div className="total-caixa">
            <div className="rot">Saídas</div>
            <Dinheiro valor={saidas} />
            {saidasAVir > 0.004 && !busca && <div className="nota">{reais(saidasAVir)} previsto</div>}
          </div>
        </div>
      )}
      {cartao && base === 'data' && !busca && (
        <p className="nota" style={{ margin: '6px 2px 0' }}>Pela data da compra o total não bate com a fatura: a fatura fecha no dia {cartao.dia_fechamento}.</p>
      )}

      {lista.length === 0 && previstos.length === 0 ? (
        <div className="grupo" style={{ marginTop: 14 }}>
          <Vazio icone={<ReceiptText />} titulo={busca ? 'Nada encontrado' : 'Nenhum lançamento neste mês'} texto={busca ? 'Tente outra palavra ou valor.' : 'Use o botão + para registrar.'} />
        </div>
      ) : (
        <ListaPorDia lancamentos={lista} previstos={previstos} snap={snap} />
      )}
    </>
  );
}
