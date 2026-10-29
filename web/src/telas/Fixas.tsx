import { ArrowLeft, CalendarRange, Plus } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { voltar, useFolhas } from '../lib/navegacao';
import { resumoAjustes } from '../lib/financas';
import { NOME_METODO, reais } from '../lib/formato';
import type { Recorrente } from '../lib/tipos';
import { Dinheiro, useTorrada, Vazio } from '../ui/base';
import { FormRecorrente } from '../formularios/Recorrente';

export function Fixas() {
  const { snap, executar } = useFinanc();
  const { abrir } = useFolhas();
  const torrada = useTorrada();
  if (!snap) return null;
  const saidas = snap.recorrentes.filter((r) => r.tipo === 'saida');
  const entradas = snap.recorrentes.filter((r) => r.tipo === 'entrada');
  const total = (l: Recorrente[]) => l.filter((r) => r.ativo).reduce((s, r) => s + r.valor, 0);

  const alternar = async (r: Recorrente) => {
    try {
      await executar({ metodo: 'POST', caminho: `/api/recorrentes/${r.id}/estado`, corpo: { ativo: !r.ativo }, rotulo: r.descricao });
      torrada(r.ativo ? `${r.descricao} pausada` : `${r.descricao} reativada`);
    } catch (e) {
      torrada((e as Error).message, true);
    }
  };

  const lista = (itens: Recorrente[]) => (
    <div className="grupo">
      {itens.length === 0 && <Vazio icone={<CalendarRange />} titulo="Nada aqui ainda" />}
      {itens.map((r) => (
        <div className="linha" key={r.id} style={{ opacity: r.ativo ? 1 : 0.55 }}>
          <span className="linha-icone num" style={{ fontWeight: 700, fontSize: 13 }}>{String(r.dia_vencimento).padStart(2, '0')}</span>
          <button type="button" className="linha-texto" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => abrir(`Editar ${r.descricao}`, (f) => <FormRecorrente fechar={f} r={r} />)}>
            <span className="linha-titulo" style={{ display: 'block' }}>{r.descricao}</span>
            <span className="linha-sub duas" style={{ display: 'block' }}>
              {r.categoria}, {r.metodo === 'credito' ? r.cartao ?? 'crédito' : `${NOME_METODO[r.metodo] ?? r.metodo}${r.conta ? `, ${r.conta}` : ''}`}
              {r.fim ? `, até ${r.fim.slice(5, 7)}/${r.fim.slice(0, 4)}` : ''}{r.lancado_mes ? ', lançada este mês' : ''}
              {r.ajustes?.length ? <><br /><span className="marca-futuro previsto">Meses diferentes</span>{resumoAjustes(r)}</> : null}
            </span>
          </button>
          <span style={{ display: 'grid', justifyItems: 'end', gap: 4 }}>
            <Dinheiro valor={r.valor} tipo={r.tipo} sinal={r.tipo === 'entrada'} />
            <label className="interruptor" style={{ padding: 0 }}>
              <span className="visualmente-oculto">{r.ativo ? 'Ativa' : 'Pausada'}</span>
              <input type="checkbox" role="switch" checked={r.ativo} onChange={() => alternar(r)} aria-label={`${r.descricao} ativa`} />
            </label>
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <header className="topo">
        <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar('/ajustes')}><ArrowLeft size={20} /></button>
        <h1>Fixas</h1>
        <button type="button" className="icone-btn" aria-label="Nova fixa" onClick={() => abrir('Nova fixa', (f) => <FormRecorrente fechar={f} />)}><Plus size={20} /></button>
      </header>
      <section aria-label="Contas fixas">
        <div className="secao-cab"><h2>Contas fixas</h2><span className="nota">{reais(total(saidas))} por mês</span></div>
        {lista(saidas)}
      </section>
      <section className="secao" aria-label="Receitas fixas">
        <div className="secao-cab"><h2>Receitas fixas</h2><span className="nota">{reais(total(entradas))} por mês</span></div>
        {lista(entradas)}
      </section>
      <p className="nota" style={{ margin: '16px 2px' }}>As contas fixas são lançadas no dia do vencimento pela rotina diária. As receitas com “perguntar se recebi” esperam sua confirmação no WhatsApp. Valor diferente num mês (desconto, reajuste) ou mês sem a conta: abra a fixa e toque no mês, ou peça no WhatsApp (“em dezembro a internet vem 80”).</p>
    </>
  );
}
