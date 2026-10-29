import { useId, useState, type FormEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { useFolhas } from '../lib/navegacao';
import { beneficios, contasDeCaixa, corPadraoConta, proximasOcorrencias } from '../lib/financas';
import { NOME_METODO, nomeMes, primeiraMaiuscula } from '../lib/formato';
import type { Metodo, Recorrente } from '../lib/tipos';
import { CampoValor, CorpoFolha, Dinheiro, Interruptor, RodapeFolha, Segmentado, useTorrada } from '../ui/base';
import { SeletorCategoria } from '../ui/SeletorCategoria';
import { FolhaPrevisto } from './Previsto';

/** os próximos meses da fixa, cada um com o valor daquele mês; tocar abre as opções do mês */
function ProximosMeses({ r: inicial }: { r: Recorrente }) {
  const { snap } = useFinanc();
  const { abrir } = useFolhas();
  // a folha guarda a fixa de quando abriu; os meses vêm sempre do retrato mais novo
  const r = snap?.recorrentes.find((x) => x.id === inicial.id) ?? inicial;
  if (!snap || !r.ativo) return null;
  const lista = proximasOcorrencias(snap, r, 6);
  if (!lista.length) return null;
  return (
    <div className="campo">
      <span className="rotulo">Próximos meses</span>
      <span className="dica" style={{ marginTop: -2 }}>Toque num mês para mudar só o valor dele, pular ou marcar como pago.</span>
      <div className="grupo grupo-borda">
        {lista.map((o) => (
          <button key={o.mes} type="button" className="linha sem-icone" style={{ gridTemplateColumns: '1fr auto auto' }}
            onClick={() => abrir(`${r.descricao}, ${nomeMes(o.mes)}`, (f) => <FolhaPrevisto fechar={f} recorrenteId={r.id} mes={o.mes} />)}>
            <span className="linha-texto">
              <span className="linha-titulo" style={{ display: 'block' }}>{primeiraMaiuscula(nomeMes(o.mes, o.mes.slice(0, 4) !== snap.hoje.slice(0, 4)))}</span>
              <span className="linha-sub" style={{ display: 'block' }}>
                {o.estado === 'lancada' ? `Lançada em ${o.data.slice(8, 10)}/${o.data.slice(5, 7)}`
                  : o.estado === 'pulada' ? 'Não vai ter neste mês'
                  : o.atrasado ? 'Atrasada' : `Dia ${o.data.slice(8, 10)}${o.ajustado ? ', valor só deste mês' : ''}`}
              </span>
            </span>
            <span className="linha-valor">
              {o.estado === 'pulada' ? <span className="nota">pulada</span> : <Dinheiro valor={o.valor} tipo={r.tipo} sinal={r.tipo === 'entrada'} />}
            </span>
            <ChevronRight size={16} color="var(--ink-3)" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function FormRecorrente({ fechar, r }: { fechar: () => void; r?: Recorrente }) {
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
      descricao: descricao.trim(), valor, tipo, dia_vencimento: dia, categoria: categoria.trim() || undefined,
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
        {r && <p className="nota" style={{ marginTop: -10 }}>Vale para todos os meses. Para mudar só um mês, use os próximos meses abaixo.</p>}
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
        <SeletorCategoria snap={snap} tipo={tipo} valor={categoria} aoMudar={setCategoria} n={8} />
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
        {r && <ProximosMeses r={r} />}
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
