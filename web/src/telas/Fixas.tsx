import { useId, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarRange, Plus } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { voltar, useFolhas } from '../lib/navegacao';
import { beneficios, categoriasFrequentes, contasDeCaixa, corPadraoConta } from '../lib/financas';
import { NOME_METODO, reais } from '../lib/formato';
import type { Metodo, Recorrente } from '../lib/tipos';
import { CampoValor, CorpoFolha, Dinheiro, Interruptor, RodapeFolha, Segmentado, useTorrada, Vazio } from '../ui/base';

function FormRecorrente({ fechar, r }: { fechar: () => void; r?: Recorrente }) {
  const { snap, executar } = useFinanc();
  const torrada = useTorrada();
  const id = useId();
  const [tipo, setTipo] = useState<'saida' | 'entrada'>(r?.tipo ?? 'saida');
  const [descricao, setDescricao] = useState(r?.descricao ?? '');
  const [valor, setValor] = useState(r?.valor ?? 0);
  const [dia, setDia] = useState(r?.dia_vencimento ?? 10);
  const [categoria, setCategoria] = useState(r?.categoria ?? '');
  const [metodo, setMetodo] = useState<Metodo>((r?.metodo as Metodo) ?? 'pix');
  const [cartao, setCartao] = useState<number | null>(r?.cartao_id ?? snap?.padrao.cartao_id ?? null);
  const [conta, setConta] = useState<number | null>(r?.conta_id ?? snap?.padrao.conta_id ?? null);
  const [confirmar, setConfirmar] = useState(r?.confirmar ?? false);
  const [fim, setFim] = useState(r?.fim?.slice(0, 7) ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [excluir, setExcluir] = useState(false);
  if (!snap) return null;
  const contas = [...contasDeCaixa(snap), ...(tipo === 'entrada' ? beneficios(snap) : [])];

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!descricao.trim()) return setErro('Dê um nome.');
    if (!(valor > 0)) return setErro('Informe o valor.');
    setOcupado(true);
    const ehVale = beneficios(snap).some((b) => b.id === conta);
    const corpo = {
      descricao: descricao.trim(), valor, tipo, dia_vencimento: dia, categoria: categoria || undefined,
      metodo: tipo === 'entrada' ? (ehVale ? 'vale' : 'pix') : metodo,
      cartao_id: tipo === 'saida' && metodo === 'credito' ? cartao : undefined,
      conta_id: tipo === 'saida' && metodo === 'credito' ? undefined : conta,
      confirmar: tipo === 'entrada' ? confirmar : undefined,
      fim: fim || undefined,
    };
    try {
      if (r) await executar({ metodo: 'PATCH', caminho: `/api/recorrentes/${r.id}`, corpo, rotulo: `Editar ${r.descricao}` });
      else await executar({ metodo: 'POST', caminho: '/api/recorrentes', corpo, rotulo: `Nova fixa ${descricao}` });
      torrada(r ? 'Atualizado' : tipo === 'entrada' ? 'Receita fixa criada' : 'Conta fixa criada');
      fechar();
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (!r) return;
    setOcupado(true);
    try {
      await executar({ metodo: 'DELETE', caminho: `/api/recorrentes/${r.id}`, rotulo: `Excluir ${r.descricao}` });
      torrada('Excluído');
      fechar();
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };

  return (
    <form onSubmit={salvar} style={{ display: 'contents' }}>
      <CorpoFolha>
        {erro && <div className="erro-form" role="alert">{erro}</div>}
        {!r && (
          <div style={{ marginBottom: 14 }}>
            <Segmentado rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={[{ valor: 'saida', rotulo: 'Conta fixa' }, { valor: 'entrada', rotulo: 'Receita fixa' }]} />
          </div>
        )}
        <CampoValor rotulo="Valor" valor={valor} aoMudar={setValor} entradaCor={tipo === 'entrada'} />
        <div className="campo">
          <label htmlFor={id}>Nome</label>
          <input id={id} className="entrada" value={descricao} maxLength={80} onChange={(e) => setDescricao(e.target.value)} placeholder={tipo === 'entrada' ? 'Ex.: Salário' : 'Ex.: Aluguel, Internet'} required />
        </div>
        <div className="linha-campos">
          <div className="campo">
            <label htmlFor={`${id}-d`}>Dia do mês</label>
            <input id={`${id}-d`} className="entrada num" type="number" min={1} max={31} value={dia} onChange={(e) => setDia(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
          <div className="campo">
            <label htmlFor={`${id}-f`}>Até</label>
            <input id={`${id}-f`} className="entrada" type="month" value={fim} onChange={(e) => setFim(e.target.value)} />
          </div>
        </div>
        <div className="campo">
          <span className="rotulo">Categoria</span>
          <div className="chips">
            {categoriasFrequentes(snap, tipo, 8).map((c) => <button key={c} type="button" className="chip" aria-pressed={categoria === c} onClick={() => setCategoria(c)}>{c}</button>)}
          </div>
        </div>
        {tipo === 'saida' && (
          <div className="campo">
            <span className="rotulo">Como paga</span>
            <div className="chips">
              {(['pix', 'boleto', 'debito', 'credito'] as Metodo[]).map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={metodo === m} onClick={() => setMetodo(m)}>{NOME_METODO[m]}</button>
              ))}
            </div>
          </div>
        )}
        {tipo === 'saida' && metodo === 'credito' ? (
          <div className="campo">
            <span className="rotulo">Cartão</span>
            <div className="chips">
              {snap.cartoes.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={cartao === c.id} onClick={() => setCartao(c.id)}><span className="bolinha" style={{ background: c.cor ?? '#334155' }} />{c.nome}</button>)}
            </div>
          </div>
        ) : (
          <div className="campo">
            <span className="rotulo">{tipo === 'entrada' ? 'Entra em' : 'Sai de'}</span>
            <div className="chips">
              {contas.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={conta === c.id} onClick={() => setConta(c.id)}><span className="bolinha" style={{ background: corPadraoConta(c) }} />{c.nome}</button>)}
            </div>
          </div>
        )}
        {tipo === 'entrada' && (
          <Interruptor rotulo="Perguntar se recebi" dica="No dia, o assistente pergunta no WhatsApp antes de lançar." valor={confirmar} aoMudar={setConfirmar} />
        )}
        {r && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 6 }}>
            {!excluir ? (
              <button type="button" className="btn perigo cheio" onClick={() => setExcluir(true)}>Excluir</button>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <p className="nota" style={{ margin: 0 }}>Os lançamentos que já aconteceram continuam; só para de prever e lançar os próximos.</p>
                <button type="button" className="btn perigo cheio" onClick={remover} disabled={ocupado}>Excluir {r.descricao}</button>
              </div>
            )}
          </div>
        )}
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>{r ? 'Salvar' : 'Criar'}</button></RodapeFolha>
    </form>
  );
}

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
      <p className="nota" style={{ margin: '16px 2px' }}>As contas fixas são lançadas no dia do vencimento pela rotina diária. As receitas com “perguntar se recebi” esperam sua confirmação no WhatsApp.</p>
    </>
  );
}
