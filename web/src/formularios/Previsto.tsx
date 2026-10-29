import { useId, useState } from 'react';
import { AlertTriangle, CalendarX2, Check, Pencil, RotateCcw, Settings2 } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { useFolhas } from '../lib/navegacao';
import { contasDeCaixa, corPadraoConta, dataNoMes, meioDoLancamento, ocorrenciaDoMes } from '../lib/financas';
import { dataCurta, nomeMes, reais } from '../lib/formato';
import { CampoValor, CorpoFolha, Dinheiro, RodapeFolha, useTorrada } from '../ui/base';
import { FormLancamento } from './Lancamento';
import { FormRecorrente } from './Recorrente';

type Modo = 'menu' | 'lancar' | 'valor' | 'pular';

/**
 * Um mês de uma conta fixa ou receita fixa: lançar agora ("já paguei"), mudar o valor só desse mês,
 * pular o mês ou voltar ao normal. As mesmas ações existem no WhatsApp (gerenciar_recorrente).
 */
export function FolhaPrevisto({ fechar, recorrenteId, mes }: { fechar: () => void; recorrenteId: number; mes: string }) {
  const { snap, executar } = useFinanc();
  const { abrir } = useFolhas();
  const torrada = useTorrada();
  const id = useId();
  const r = snap?.recorrentes.find((x) => x.id === recorrenteId);
  const occ = snap ? ocorrenciaDoMes(snap, recorrenteId, mes) : {};
  const ajuste = r?.ajustes?.find((a) => a.mes === mes);
  const pulada = !!ajuste?.pular && !occ.lancamento;
  const valorMes = occ.previsto?.valor ?? (ajuste?.valor ?? r?.valor ?? 0);
  const venc = occ.previsto?.data ?? (r ? dataNoMes(mes, r.dia_vencimento) : '');
  const [modo, setModo] = useState<Modo>('menu');
  const [valor, setValor] = useState(valorMes);
  const [data, setData] = useState(() => (snap && venc && venc < snap.hoje ? venc : snap?.hoje ?? ''));
  const [conta, setConta] = useState<number | null>(r?.conta_id ?? snap?.padrao.conta_id ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!snap || !r) return <CorpoFolha><p className="nota">Essa conta fixa não existe mais.</p></CorpoFolha>;

  const entrada = r.tipo === 'entrada';
  const mesNome = nomeMes(mes, mes.slice(0, 4) !== snap.hoje.slice(0, 4));
  const podeLancar = mes <= snap.mes && !occ.lancamento && !pulada;
  const noCartao = r.metodo === 'credito';
  const ehVale = r.metodo === 'vale';

  const agir = async (acao: 'ajustar' | 'pular' | 'desfazer' | 'lancar', extra: Record<string, unknown> = {}, aviso = '') => {
    setOcupado(true);
    setErro(null);
    try {
      await executar({ metodo: 'POST', caminho: `/api/recorrentes/${r.id}/mes`, corpo: { mes, acao, ...extra }, rotulo: `${r.descricao} ${mes}` });
      torrada(aviso);
      fechar();
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  };

  const resumo = (
    <div className="previsto-resumo">
      <span className="nota">
        {occ.lancamento ? `Lançada em ${dataCurta(occ.lancamento.data)}`
          : pulada ? `Não vai ter em ${mesNome}`
          : occ.previsto?.atrasado ? `Venceu em ${dataCurta(venc)} e ainda não foi lançada`
          : `${entrada ? 'Cai' : 'Vence'} em ${dataCurta(venc)}`}
      </span>
      <span className="saldo-grande">{pulada ? <span className="nota" style={{ fontSize: 17 }}>Pulada</span> : <Dinheiro valor={occ.lancamento?.valor ?? valorMes} tipo={r.tipo} sinal={entrada} />}</span>
      <span className="nota">
        {r.categoria}, {meioDoLancamento(r, snap)}
        {!occ.lancamento && !pulada && valorMes !== r.valor ? `. Valor só de ${nomeMes(mes)}; o normal é ${reais(r.valor)}` : ''}
      </span>
    </div>
  );

  if (modo === 'lancar') {
    const contas = contasDeCaixa(snap);
    return (
      <>
        <CorpoFolha>
          {erro && <div className="erro-form" role="alert">{erro}</div>}
          <CampoValor rotulo="Valor" valor={valor} aoMudar={setValor} entradaCor={entrada} autoFocus />
          {!noCartao && (
            <div className="campo">
              <label htmlFor={`${id}-d`}>{entrada ? 'Recebi em' : 'Paguei em'}</label>
              <input id={`${id}-d`} className="entrada" type="date" value={data} max={snap.hoje} onChange={(e) => setData(e.target.value)} />
            </div>
          )}
          {noCartao && <p className="nota">Entra no cartão no dia {dataCurta(venc)}, na fatura em que esse dia cair.</p>}
          {!noCartao && !ehVale && contas.length > 1 && (
            <div className="campo">
              <span className="rotulo">{entrada ? 'Entrou em' : 'Saiu de'}</span>
              <div className="chips">
                {contas.map((c) => (
                  <button key={c.id} type="button" className="chip" aria-pressed={conta === c.id} onClick={() => setConta(c.id)}>
                    <span className="bolinha" style={{ background: corPadraoConta(c) }} aria-hidden="true" /> {c.nome}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CorpoFolha>
        <RodapeFolha>
          <div className="acoes">
            <button type="button" className="btn sec" onClick={() => setModo('menu')} disabled={ocupado}>Voltar</button>
            <button type="button" className="btn" disabled={ocupado || !(valor > 0)}
              onClick={() => agir('lancar', { valor, data: noCartao ? undefined : data, conta_id: noCartao || ehVale ? undefined : conta ?? undefined },
                entrada ? `${r.descricao} recebido` : `${r.descricao} lançada`)}>
              Lançar {reais(valor)}
            </button>
          </div>
        </RodapeFolha>
      </>
    );
  }

  if (modo === 'valor') {
    return (
      <>
        <CorpoFolha>
          {erro && <div className="erro-form" role="alert">{erro}</div>}
          <CampoValor rotulo={`Valor de ${mesNome}`} valor={valor} aoMudar={setValor} entradaCor={entrada} autoFocus />
          <p className="nota" style={{ marginTop: -6 }}>
            {occ.lancamento ? 'Corrige o lançamento deste mês.' : `Só em ${mesNome}. Nos outros meses continua ${reais(r.valor)}.`}
          </p>
        </CorpoFolha>
        <RodapeFolha>
          <div className="acoes">
            <button type="button" className="btn sec" onClick={() => setModo('menu')} disabled={ocupado}>Voltar</button>
            <button type="button" className="btn" disabled={ocupado || !(valor > 0)} onClick={() => agir('ajustar', { valor }, `${r.descricao}: ${reais(valor)} em ${nomeMes(mes)}`)}>
              Salvar
            </button>
          </div>
        </RodapeFolha>
      </>
    );
  }

  if (modo === 'pular') {
    return (
      <>
        <CorpoFolha>
          {erro && <div className="erro-form" role="alert">{erro}</div>}
          <p style={{ marginTop: 0 }}>{r.descricao} sai das contas de {mesNome}{entrada ? ' (não vou receber)' : ' (não vou pagar)'}. Nos outros meses continua normal.</p>
        </CorpoFolha>
        <RodapeFolha>
          <div className="acoes">
            <button type="button" className="btn sec" onClick={() => setModo('menu')} disabled={ocupado}>Voltar</button>
            <button type="button" className="btn perigo" disabled={ocupado} onClick={() => agir('pular', {}, `${r.descricao} pulada em ${nomeMes(mes)}`)}>Pular {nomeMes(mes)}</button>
          </div>
        </RodapeFolha>
      </>
    );
  }

  return (
    <CorpoFolha>
      {erro && <div className="erro-form" role="alert">{erro}</div>}
      {resumo}
      {occ.previsto?.atrasado && (
        <div className="eq-aviso"><AlertTriangle size={16} aria-hidden="true" /><span>Se já {entrada ? 'recebeu' : 'pagou'}, lance agora para o saldo bater.</span></div>
      )}
      <div className="lista-acoes">
        {podeLancar && (
          <button type="button" className="btn cheio" onClick={() => setModo('lancar')}>
            <Check aria-hidden="true" /> {entrada ? 'Já recebi' : 'Já paguei'}
          </button>
        )}
        {occ.lancamento && (
          <button type="button" className="btn sec cheio" onClick={() => {
            const l = occ.lancamento!;
            abrir('Lançamento', (f) => <FormLancamento fechar={f} lancamento={l} />);
          }}>
            <Pencil aria-hidden="true" /> Abrir o lançamento
          </button>
        )}
        {!pulada && !occ.lancamento && (
          <button type="button" className="btn sec cheio" onClick={() => { setValor(valorMes); setModo('valor'); }}>
            <Pencil aria-hidden="true" /> Valor diferente em {nomeMes(mes)}
          </button>
        )}
        {!pulada && !occ.lancamento && (
          <button type="button" className="btn sec cheio" onClick={() => setModo('pular')}>
            <CalendarX2 aria-hidden="true" /> Não vai ter em {nomeMes(mes)}
          </button>
        )}
        {(pulada || (ajuste && !occ.lancamento)) && (
          <button type="button" className="btn sec cheio" disabled={ocupado} onClick={() => agir('desfazer', {}, `${r.descricao} voltou ao normal em ${nomeMes(mes)}`)}>
            <RotateCcw aria-hidden="true" /> Voltar ao normal ({reais(r.valor)})
          </button>
        )}
        <button type="button" className="btn fantasma cheio" onClick={() => abrir(`Editar ${r.descricao}`, (f) => <FormRecorrente fechar={f} r={r} />)}>
          <Settings2 aria-hidden="true" /> Editar a {entrada ? 'receita' : 'conta'} fixa
        </button>
      </div>
    </CorpoFolha>
  );
}
