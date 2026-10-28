import { useId, useMemo, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import {
  beneficios, categoriasFrequentes, competenciaCredito, contasDeCaixa, corPadraoConta, faturaDatas, somarMesesData, sugestaoPorDescricao,
} from '../lib/financas';
import { dataCurta, nomeMes, reais, somarDias } from '../lib/formato';
import type { Lancamento, Metodo } from '../lib/tipos';
import { CampoValor, CorpoFolha, RodapeFolha, Segmentado, useTorrada } from '../ui/base';

type Meio = { tipo: 'cartao'; id: number } | { tipo: 'metodo'; metodo: Exclude<Metodo, 'credito' | 'vale'> } | { tipo: 'vale'; contaId: number };

const METODOS_CONTA: { metodo: Exclude<Metodo, 'credito' | 'vale'>; rotulo: string }[] = [
  { metodo: 'pix', rotulo: 'Pix' },
  { metodo: 'debito', rotulo: 'Débito' },
  { metodo: 'dinheiro', rotulo: 'Dinheiro' },
  { metodo: 'boleto', rotulo: 'Boleto' },
];

type Props = {
  fechar: () => void;
  lancamento?: Lancamento;
  inicial?: Partial<{ tipo: 'saida' | 'entrada'; cartao_id: number; conta_id: number; metodo: Metodo }>;
};

export function FormLancamento({ fechar, lancamento, inicial }: Props) {
  const { snap, executar } = useFinanc();
  const torrada = useTorrada();
  const idDesc = useId();
  const idData = useId();
  const editando = !!lancamento;

  const meioInicial = (): Meio => {
    const l = lancamento;
    if (l) {
      if (l.metodo === 'credito' && l.cartao_id) return { tipo: 'cartao', id: l.cartao_id };
      if (l.metodo === 'vale' && l.conta_id) return { tipo: 'vale', contaId: l.conta_id };
      return { tipo: 'metodo', metodo: (['pix', 'debito', 'dinheiro', 'boleto'].includes(l.metodo) ? l.metodo : 'pix') as 'pix' };
    }
    if (inicial?.metodo === 'vale' && inicial.conta_id) return { tipo: 'vale', contaId: inicial.conta_id };
    if (inicial?.cartao_id) return { tipo: 'cartao', id: inicial.cartao_id };
    if (inicial?.metodo && inicial.metodo !== 'credito' && inicial.metodo !== 'vale') return { tipo: 'metodo', metodo: inicial.metodo };
    if (snap?.padrao.metodo === 'credito' && snap.padrao.cartao_id) return { tipo: 'cartao', id: snap.padrao.cartao_id };
    return { tipo: 'metodo', metodo: 'pix' };
  };

  const [tipo, setTipo] = useState<'saida' | 'entrada'>(lancamento?.tipo ?? inicial?.tipo ?? 'saida');
  const [valor, setValor] = useState<number>(lancamento?.valor ?? 0);
  const [descricao, setDescricao] = useState(lancamento?.descricao ?? '');
  const [categoria, setCategoria] = useState(lancamento?.categoria ?? '');
  const [outraCategoria, setOutraCategoria] = useState(false);
  const [meio, setMeio] = useState<Meio>(meioInicial);
  const [contaId, setContaId] = useState<number | null>(lancamento?.conta_id ?? inicial?.conta_id ?? snap?.padrao.conta_id ?? null);
  const [data, setData] = useState(lancamento?.data ?? snap?.hoje ?? '');
  const [parcelas, setParcelas] = useState(1);
  const [observacao, setObservacao] = useState(lancamento?.observacao ?? '');
  const [tocou, setTocou] = useState({ categoria: editando, meio: editando || !!inicial });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  const descricoes = useMemo(() => {
    if (!snap) return [];
    const vistas = new Set<string>();
    const out: string[] = [];
    for (const l of snap.lancamentos) {
      const k = l.descricao.toLowerCase();
      if (l.origem === 'avulso' && !vistas.has(k)) { vistas.add(k); out.push(l.descricao); }
      if (out.length >= 40) break;
    }
    return out;
  }, [snap]);

  if (!snap) return null;
  const cats = categoriasFrequentes(snap, tipo, 9);
  const contasCaixa = contasDeCaixa(snap);
  const vales = beneficios(snap);
  const cartao = meio.tipo === 'cartao' ? snap.cartoes.find((c) => c.id === meio.id) : undefined;

  const aoDescrever = (t: string) => {
    setDescricao(t);
    if (editando) return;
    const s = sugestaoPorDescricao(snap, t);
    if (!s) return;
    if (!tocou.categoria) setCategoria(s.categoria);
    if (!tocou.meio && s.tipo === tipo) {
      if (s.metodo === 'credito' && s.cartao_id && snap.cartoes.some((c) => c.id === s.cartao_id)) setMeio({ tipo: 'cartao', id: s.cartao_id });
      else if (s.metodo === 'vale' && s.conta_id) setMeio({ tipo: 'vale', contaId: s.conta_id });
      else if (['pix', 'debito', 'dinheiro', 'boleto'].includes(s.metodo)) {
        setMeio({ tipo: 'metodo', metodo: s.metodo as 'pix' });
        if (s.conta_id) setContaId(s.conta_id);
      }
    }
  };

  // prévia da fatura (crédito)
  let previa: string | null = null;
  if (tipo === 'saida' && cartao && data) {
    const comp = competenciaCredito(data, cartao);
    const venc = faturaDatas(cartao, comp).vencimento;
    if (parcelas > 1) {
      const ultima = competenciaCredito(somarMesesData(data, parcelas - 1), cartao);
      previa = `${parcelas}× de ${reais(Math.round((valor / parcelas) * 100) / 100)}, faturas de ${nomeMes(comp)} a ${nomeMes(ultima, ultima.slice(0, 4) !== comp.slice(0, 4))}.`;
    } else {
      previa = `Entra na fatura de ${nomeMes(comp)}, que vence em ${dataCurta(venc)}.`;
    }
  }

  const corpo = () => {
    const metodo: Metodo = tipo === 'entrada'
      ? (vales.some((v) => v.id === contaId) ? 'vale' : 'pix')
      : meio.tipo === 'cartao' ? 'credito' : meio.tipo === 'vale' ? 'vale' : meio.metodo;
    return {
      tipo,
      valor,
      descricao: descricao.trim() || undefined,
      categoria: categoria.trim() || undefined,
      metodo,
      cartao_id: metodo === 'credito' && meio.tipo === 'cartao' ? meio.id : undefined,
      conta_id: metodo === 'credito' ? undefined : metodo === 'vale' ? (meio.tipo === 'vale' ? meio.contaId : contaId ?? undefined) : contaId ?? undefined,
      data,
      observacao: observacao.trim() || undefined,
    };
  };

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!(valor > 0)) return setErro('Informe o valor.');
    setOcupado(true);
    try {
      const c = corpo();
      if (editando && lancamento) {
        const mudou: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(c)) {
          if (v !== undefined && v !== (lancamento as unknown as Record<string, unknown>)[k]) mudou[k] = v;
        }
        if (c.metodo !== lancamento.metodo) Object.assign(mudou, { metodo: c.metodo, cartao_id: c.cartao_id, conta_id: c.conta_id });
        if (Object.keys(mudou).length === 0) return fechar();
        const r = await executar({ metodo: 'PATCH', caminho: `/api/lancamentos/${lancamento.id}`, corpo: mudou, rotulo: `Editar ${lancamento.descricao}`, podeEsperar: true });
        torrada(r.naFila ? 'Alteração guardada; envio quando a conexão voltar.' : 'Lançamento atualizado');
      } else {
        const r = await executar<{ fatura?: { valor_fatura: number; competencia: string; cartao: string }; fatura_atual?: { valor_fatura: number; competencia: string } }>({
          metodo: 'POST', caminho: '/api/lancamentos', corpo: { ...c, parcelas: c.metodo === 'credito' && parcelas > 1 ? parcelas : undefined },
          rotulo: `${c.descricao ?? (tipo === 'entrada' ? 'Entrada' : 'Gasto')} ${reais(valor)}`, podeEsperar: true,
        });
        if (r.naFila) torrada('Salvo neste aparelho; envio quando a conexão voltar.');
        else {
          const f = r.resultado?.fatura;
          torrada(f && valor > 50 ? `Salvo. Fatura ${f.cartao} de ${nomeMes(f.competencia)}: ${reais(f.valor_fatura)}` : 'Lançamento salvo');
        }
      }
      fechar();
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };

  const excluir = async (escopo: 'um' | 'parcelamento') => {
    if (!lancamento) return;
    setOcupado(true);
    try {
      const r = await executar({
        metodo: 'DELETE', caminho: `/api/lancamentos/${lancamento.id}${escopo === 'parcelamento' ? '?escopo=parcelamento' : ''}`,
        rotulo: `Excluir ${lancamento.descricao}`, podeEsperar: true,
      });
      torrada(r.naFila ? 'Exclusão guardada; envio quando a conexão voltar.' : escopo === 'parcelamento' ? 'Parcelamento excluído' : 'Lançamento excluído');
      fechar();
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };

  const escolherMeio = (m: Meio) => {
    setMeio(m);
    setTocou((t) => ({ ...t, meio: true }));
    if (m.tipo !== 'cartao') setParcelas(1);
  };

  return (
    <form onSubmit={salvar} style={{ display: 'contents' }}>
      <CorpoFolha>
        {erro && <div className="erro-form" role="alert">{erro}</div>}
        <div style={{ marginBottom: 14 }}>
          <Segmentado
            rotulo="Tipo"
            valor={tipo}
            aoMudar={(t) => {
              setTipo(t);
              if (!tocou.categoria) setCategoria('');
              if (t === 'entrada' && !editando) setContaId(snap.padrao.conta_id);
            }}
            opcoes={[{ valor: 'saida', rotulo: 'Saída' }, { valor: 'entrada', rotulo: 'Entrada' }]}
          />
        </div>

        <CampoValor rotulo="Valor" valor={valor} aoMudar={setValor} entradaCor={tipo === 'entrada'} autoFocus={!editando} />

        <div className="campo">
          <label htmlFor={idDesc}>Descrição</label>
          <input id={idDesc} className="entrada" list={`${idDesc}-l`} value={descricao} maxLength={120}
            placeholder={tipo === 'entrada' ? 'Ex.: Salário, Freela' : 'Ex.: Mercado, Uber, Almoço'} onChange={(e) => aoDescrever(e.target.value)} />
          <datalist id={`${idDesc}-l`}>{descricoes.map((d) => <option key={d} value={d} />)}</datalist>
        </div>

        <div className="campo">
          <span className="rotulo">Categoria</span>
          <div className="chips">
            {cats.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={categoria === c && !outraCategoria}
                onClick={() => { setCategoria(c); setOutraCategoria(false); setTocou((t) => ({ ...t, categoria: true })); }}>
                {c}
              </button>
            ))}
            {categoria && !cats.includes(categoria) && !outraCategoria && (
              <button type="button" className="chip" aria-pressed="true" onClick={() => setOutraCategoria(true)}>{categoria}</button>
            )}
            <button type="button" className="chip" aria-pressed={outraCategoria} onClick={() => setOutraCategoria(true)}>Outra</button>
          </div>
          {outraCategoria && (
            <input className="entrada" aria-label="Nome da categoria" value={categoria} maxLength={60} autoFocus
              onChange={(e) => { setCategoria(e.target.value); setTocou((t) => ({ ...t, categoria: true })); }} placeholder="Nome da categoria" />
          )}
        </div>

        {tipo === 'saida' && (
          <div className="campo">
            <span className="rotulo">Como pagou</span>
            <div className="chips">
              {snap.cartoes.map((c) => (
                <button key={`c${c.id}`} type="button" className="chip" aria-pressed={meio.tipo === 'cartao' && meio.id === c.id} onClick={() => escolherMeio({ tipo: 'cartao', id: c.id })}>
                  <span className="bolinha" style={{ background: c.cor ?? '#334155' }} aria-hidden="true" /> {c.nome}
                </button>
              ))}
              {vales.map((v) => (
                <button key={`v${v.id}`} type="button" className="chip" aria-pressed={meio.tipo === 'vale' && meio.contaId === v.id} onClick={() => escolherMeio({ tipo: 'vale', contaId: v.id })}>
                  <span className="bolinha" style={{ background: corPadraoConta(v) }} aria-hidden="true" /> {v.nome}
                </button>
              ))}
              {METODOS_CONTA.map((m) => (
                <button key={m.metodo} type="button" className="chip" aria-pressed={meio.tipo === 'metodo' && meio.metodo === m.metodo} onClick={() => escolherMeio({ tipo: 'metodo', metodo: m.metodo })}>
                  {m.rotulo}
                </button>
              ))}
            </div>
            {previa && <span className="dica">{previa}</span>}
          </div>
        )}

        {(tipo === 'entrada' || meio.tipo === 'metodo') && contasCaixa.length > 0 && (
          <div className="campo">
            <span className="rotulo">{tipo === 'entrada' ? 'Entrou em' : 'Saiu de'}</span>
            <div className="chips">
              {[...contasCaixa, ...(tipo === 'entrada' ? vales : [])].map((c) => (
                <button key={c.id} type="button" className="chip" aria-pressed={contaId === c.id} onClick={() => setContaId(c.id)}>
                  <span className="bolinha" style={{ background: corPadraoConta(c) }} aria-hidden="true" /> {c.nome}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="linha-campos">
          <div className="campo">
            <label htmlFor={idData}>Data</label>
            <input id={idData} className="entrada" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
          </div>
          {!editando && meio.tipo === 'cartao' && tipo === 'saida' ? (
            <div className="campo">
              <label htmlFor={`${idData}-p`}>Parcelas</label>
              <select id={`${idData}-p`} className="entrada" value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}×`}</option>)}
              </select>
            </div>
          ) : (
            <div className="campo">
              <span className="rotulo">Atalhos</span>
              <div className="chips">
                <button type="button" className="chip" aria-pressed={data === snap.hoje} onClick={() => setData(snap.hoje)}>Hoje</button>
                <button type="button" className="chip" aria-pressed={data === somarDias(snap.hoje, -1)} onClick={() => setData(somarDias(snap.hoje, -1))}>Ontem</button>
              </div>
            </div>
          )}
        </div>
        {editando && lancamento?.parcela_num && (
          <p className="nota" style={{ marginTop: -6 }}>Parcela {lancamento.parcela_num} de {lancamento.parcela_total}. Mudanças valem só para esta parcela.</p>
        )}

        <div className="campo">
          <label htmlFor={`${idDesc}-o`}>Observação</label>
          <input id={`${idDesc}-o`} className="entrada" value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" />
        </div>

        {editando && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, display: 'grid', gap: 8 }}>
            {!confirmarExclusao ? (
              <button type="button" className="btn perigo cheio" onClick={() => setConfirmarExclusao(true)} disabled={ocupado}>
                <Trash2 aria-hidden="true" /> Excluir lançamento
              </button>
            ) : (
              <>
                <p className="nota" style={{ margin: 0 }}>Excluir {lancamento?.descricao}? Isso também sai dos totais e da fatura.</p>
                <div className="acoes">
                  <button type="button" className="btn perigo" onClick={() => excluir('um')} disabled={ocupado}>{lancamento?.parcela_num ? 'Só esta parcela' : 'Excluir'}</button>
                  {lancamento?.parcelamento_id && (
                    <button type="button" className="btn perigo" onClick={() => excluir('parcelamento')} disabled={ocupado}>Todas as parcelas</button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </CorpoFolha>
      <RodapeFolha>
        <button className="btn cheio" disabled={ocupado || !(valor > 0)}>
          {editando ? 'Salvar alterações' : tipo === 'entrada' ? 'Salvar entrada' : 'Salvar gasto'}
        </button>
      </RodapeFolha>
    </form>
  );
}
