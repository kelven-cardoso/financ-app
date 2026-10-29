import { useEffect, useId, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useFinanc } from '../lib/estado';
import { contasDeCaixa, corPadraoConta } from '../lib/financas';
import { dataCurta, reais } from '../lib/formato';
import type { Caixinha, Snapshot } from '../lib/tipos';
import { CampoDinheiro, CampoValor, CorpoFolha, Dinheiro, RodapeFolha, useTorrada } from '../ui/base';
import { SeletorCor } from './Contas';

export function FormCaixinha({ fechar, caixinha }: { fechar: () => void; caixinha?: Caixinha }) {
  const { executar } = useFinanc();
  const torrada = useTorrada();
  const id = useId();
  const [nome, setNome] = useState(caixinha?.nome ?? '');
  const [meta, setMeta] = useState<number | null>(caixinha?.meta ?? null);
  const [rendimento, setRendimento] = useState(caixinha?.rendimento ?? '100% do CDI');
  const [saldo, setSaldo] = useState<number | null>(null);
  const [cor, setCor] = useState(caixinha?.cor ?? '#0E7490');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return setErro('Dê um nome.');
    setOcupado(true);
    try {
      if (caixinha) {
        await executar({ metodo: 'PATCH', caminho: `/api/caixinhas/${caixinha.id}`, corpo: { nome: nome.trim(), meta, rendimento, cor }, rotulo: 'Editar caixinha' });
        torrada('Caixinha atualizada');
      } else {
        await executar({ metodo: 'POST', caminho: '/api/caixinhas', corpo: { nome: nome.trim(), meta, rendimento, cor, saldo: saldo ?? undefined }, rotulo: 'Nova caixinha' });
        torrada('Caixinha criada');
      }
      fechar();
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (!caixinha) return;
    setOcupado(true);
    try {
      await executar({ metodo: 'DELETE', caminho: `/api/caixinhas/${caixinha.id}`, rotulo: 'Remover caixinha' });
      torrada('Caixinha removida');
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
        <div className="campo">
          <label htmlFor={id}>Nome</label>
          <input id={id} className="entrada" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Reserva, Viagem" required />
        </div>
        <div className="linha-campos">
          <div className="campo">
            <label htmlFor={`${id}-m`}>Meta</label>
            <CampoDinheiro id={`${id}-m`} valor={meta} aoMudar={setMeta} placeholder="Opcional" />
          </div>
          <div className="campo">
            <label htmlFor={`${id}-r`}>Rendimento</label>
            <input id={`${id}-r`} className="entrada" value={rendimento} maxLength={40} onChange={(e) => setRendimento(e.target.value)} />
          </div>
        </div>
        {!caixinha && (
          <div className="campo">
            <label htmlFor={`${id}-s`}>Saldo hoje</label>
            <CampoDinheiro id={`${id}-s`} valor={saldo} aoMudar={setSaldo} placeholder="Opcional" />
          </div>
        )}
        <div className="campo">
          <span className="rotulo">Cor</span>
          <SeletorCor valor={cor} aoMudar={setCor} />
        </div>
        {caixinha && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            {!confirmar ? (
              <button type="button" className="btn perigo cheio" onClick={() => setConfirmar(true)}>Remover caixinha</button>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <p className="nota" style={{ margin: 0 }}>A caixinha some da lista, mas o histórico fica guardado.</p>
                <button type="button" className="btn perigo cheio" onClick={remover} disabled={ocupado}>Remover {caixinha.nome}</button>
              </div>
            )}
          </div>
        )}
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>{caixinha ? 'Salvar' : 'Criar caixinha'}</button></RodapeFolha>
    </form>
  );
}

type Acao = 'aportar' | 'resgatar' | 'saldo';

export function FormMovimentoCaixinha({ fechar, caixinha, acao }: { fechar: () => void; caixinha: Caixinha; acao: Acao }) {
  const { executar, snap } = useFinanc();
  const torrada = useTorrada();
  const contas = snap ? contasDeCaixa(snap) : [];
  const [valor, setValor] = useState(acao === 'saldo' ? caixinha.saldo : 0);
  const [conta, setConta] = useState<number>(contas.find((c) => c.tipo === 'pf')?.id ?? snap?.padrao.conta_id ?? contas[0]?.id ?? 0);
  const [data, setData] = useState(snap?.hoje ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const id = useId();
  const titulos: Record<Acao, string> = { aportar: 'Guardar', resgatar: 'Resgatar', saldo: 'Salvar saldo' };
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const r = await executar<{ diferenca?: number; aviso?: string }>({
        metodo: 'POST', caminho: `/api/caixinhas/${caixinha.id}/movimento`,
        corpo: { acao, valor, conta_id: acao === 'saldo' ? undefined : conta, data }, rotulo: `${titulos[acao]} ${caixinha.nome}`,
      });
      if (acao === 'saldo' && r.resultado?.diferenca) torrada(`Saldo salvo. ${r.resultado.diferenca > 0 ? 'Rendimento' : 'Ajuste'} de ${reais(Math.abs(r.resultado.diferenca))}`);
      else torrada(r.resultado?.aviso ?? (acao === 'aportar' ? 'Guardado na caixinha' : acao === 'resgatar' ? 'Resgate registrado' : 'Saldo salvo'));
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
        {acao === 'saldo' && <p className="nota" style={{ marginTop: 0 }}>Digite o saldo que aparece no banco. A diferença para o que está registrado vira rendimento.</p>}
        <CampoValor rotulo={acao === 'saldo' ? 'Saldo atual' : 'Valor'} valor={valor} aoMudar={setValor} autoFocus />
        {acao !== 'saldo' && (
          <div className="campo">
            <span className="rotulo">{acao === 'aportar' ? 'Saiu de' : 'Voltou para'}</span>
            <div className="chips">
              {contas.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={conta === c.id} onClick={() => setConta(c.id)}><span className="bolinha" style={{ background: corPadraoConta(c) }} />{c.nome}</button>)}
            </div>
          </div>
        )}
        <div className="campo">
          <label htmlFor={`${id}-d`}>Data</label>
          <input id={`${id}-d`} className="entrada" type="date" value={data} max={snap?.hoje} onChange={(e) => setData(e.target.value)} />
        </div>
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado || (acao !== 'saldo' && !(valor > 0))}>{titulos[acao]}</button></RodapeFolha>
    </form>
  );
}

type Mov = { id: number; data: string; tipo: string; valor: number; conta: string | null; observacao: string | null; saldo_apos?: number; criado_em?: string };

const NOMES_MOV: Record<string, string> = { aporte: 'Guardado', resgate: 'Resgate', rendimento: 'Rendimento', ajuste: 'Saldo informado' };

/** movimentos da caixinha que vieram no retrato (funciona sem internet), do mais recente ao mais antigo */
export function movimentosDaCaixinha(snap: Snapshot | null, caixinhaId: number): Mov[] | null {
  if (!snap?.caixinha_movimentos) return null;
  return snap.caixinha_movimentos.filter((m) => m.caixinha_id === caixinhaId);
}

function LinhaMov({ m, acao }: { m: Mov; acao?: React.ReactNode }) {
  const sub = [dataCurta(m.data), m.conta, m.tipo === 'ajuste' || m.tipo === 'rendimento' ? 'diferença para o saldo anterior' : null, m.observacao]
    .filter(Boolean).join(', ');
  return (
    <div className="linha sem-icone" style={{ gridTemplateColumns: '1fr auto' }}>
      <span className="linha-texto">
        <span className="linha-titulo" style={{ display: 'block' }}>{NOMES_MOV[m.tipo] ?? m.tipo}</span>
        <span className="linha-sub duas" style={{ display: 'block' }}>{sub}</span>
        {acao}
      </span>
      <span className="linha-valor">
        <Dinheiro valor={m.valor} tipo={m.valor >= 0 ? 'entrada' : 'saida'} sinal />
        {m.saldo_apos !== undefined && <small>saldo {reais(m.saldo_apos)}</small>}
      </span>
    </div>
  );
}

/** os últimos movimentos, dentro da folha da caixinha */
export function MovimentosRecentes({ caixinha, n = 4, verTudo }: { caixinha: Caixinha; n?: number; verTudo: () => void }) {
  const { snap } = useFinanc();
  const movs = movimentosDaCaixinha(snap, caixinha.id);
  if (!movs) return null;
  return (
    <div className="caixinha-movs">
      <div className="secao-cab" style={{ margin: '18px 2px 6px' }}>
        <h2 style={{ fontSize: 15 }}>Últimos movimentos</h2>
        {movs.length > n && <button type="button" className="link" onClick={verTudo}>Ver todos ({movs.length})</button>}
      </div>
      {movs.length === 0 ? <p className="nota" style={{ margin: '4px 2px' }}>Nenhum movimento ainda.</p> : (
        <div className="lista-sim">{movs.slice(0, n).map((m) => <LinhaMov key={m.id} m={m} />)}</div>
      )}
    </div>
  );
}

export function HistoricoCaixinha({ caixinha }: { caixinha: Caixinha }) {
  const { snap, executar } = useFinanc();
  const torrada = useTorrada();
  const doRetrato = movimentosDaCaixinha(snap, caixinha.id);
  const [buscados, setBuscados] = useState<Mov[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (doRetrato) return;
    // retrato antigo, sem os movimentos: busca no servidor
    api<{ movimentos: Mov[] }>('GET', `/api/caixinhas/${caixinha.id}/historico`)
      .then((r) => setBuscados(r.movimentos))
      .catch((e) => setErro(e.semRede ? 'O histórico precisa de internet.' : e.message));
  }, [caixinha.id, doRetrato]);
  const movs = doRetrato ?? buscados;
  // o último registrado pode ser desfeito (ex.: guardou o valor errado)
  const ultimo = movs?.length ? [...movs].sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? '') || b.id - a.id)[0] : undefined;
  const desfazerUltimo = async () => {
    if (!ultimo) return;
    setOcupado(true);
    try {
      await executar({ metodo: 'POST', caminho: `/api/caixinhas/${caixinha.id}/desfazer`, corpo: { movimento_id: ultimo.id }, rotulo: `Desfazer ${NOMES_MOV[ultimo.tipo] ?? ultimo.tipo}` });
      torrada('Movimento desfeito');
      setDesfazer(false);
    } catch (e) {
      torrada((e as Error).message, true);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <CorpoFolha>
      {erro && <p className="nota">{erro}</p>}
      {!movs && !erro && <p className="nota">Carregando…</p>}
      {movs && movs.length === 0 && <p className="nota">Nenhum movimento ainda.</p>}
      {movs && movs.length > 0 && (
        <div className="lista-sim">
          {movs.map((m) => (
            <LinhaMov key={m.id} m={m} acao={m.id === ultimo?.id ? (
              !desfazer ? (
                <button type="button" className="link-peq" onClick={() => setDesfazer(true)}>Desfazer</button>
              ) : (
                <span className="confirma-peq">
                  Desfazer este movimento?{' '}
                  <button type="button" className="link-peq perigo" disabled={ocupado} onClick={desfazerUltimo}>Sim, desfazer</button>{' '}
                  <button type="button" className="link-peq" onClick={() => setDesfazer(false)}>Não</button>
                </span>
              )
            ) : undefined} />
          ))}
        </div>
      )}
    </CorpoFolha>
  );
}
