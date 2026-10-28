import { useEffect, useId, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useFinanc } from '../lib/estado';
import { contasDeCaixa, corPadraoConta } from '../lib/financas';
import { dataCurta, reais } from '../lib/formato';
import type { Caixinha } from '../lib/tipos';
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

type Mov = { id: number; data: string; tipo: string; valor: number; conta: string | null; observacao: string | null };

export function HistoricoCaixinha({ caixinha }: { caixinha: Caixinha }) {
  const [movs, setMovs] = useState<Mov[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    api<{ movimentos: Mov[] }>('GET', `/api/caixinhas/${caixinha.id}/historico`)
      .then((r) => setMovs(r.movimentos))
      .catch((e) => setErro(e.semRede ? 'O histórico precisa de internet.' : e.message));
  }, [caixinha.id]);
  const nomes: Record<string, string> = { aporte: 'Guardado', resgate: 'Resgate', rendimento: 'Rendimento', ajuste: 'Ajuste de saldo' };
  return (
    <CorpoFolha>
      {erro && <p className="nota">{erro}</p>}
      {!movs && !erro && <p className="nota">Carregando…</p>}
      {movs && movs.length === 0 && <p className="nota">Nenhum movimento ainda.</p>}
      {movs && movs.length > 0 && (
        <div className="lista-sim">
          {movs.map((m) => (
            <div className="linha sem-icone" key={m.id} style={{ gridTemplateColumns: '1fr auto' }}>
              <span className="linha-texto">
                <span className="linha-titulo" style={{ display: 'block' }}>{nomes[m.tipo] ?? m.tipo}</span>
                <span className="linha-sub" style={{ display: 'block' }}>{dataCurta(m.data)}{m.conta ? `, ${m.conta}` : ''}</span>
              </span>
              <span className="linha-valor"><Dinheiro valor={m.valor} tipo={m.valor >= 0 ? 'entrada' : 'saida'} sinal /></span>
            </div>
          ))}
        </div>
      )}
    </CorpoFolha>
  );
}
