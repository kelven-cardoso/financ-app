import { useId, useState, type FormEvent } from 'react';
import { useFinanc } from '../lib/estado';
import { competenciaCredito, contasDeCaixa, corPadraoConta, faturaDatas, simularCompra } from '../lib/financas';
import { dataCurta, nomeMes, reais } from '../lib/formato';
import type { Cartao, Fatura } from '../lib/tipos';
import { CampoDinheiro, CampoValor, CorpoFolha, Dinheiro, RodapeFolha, Segmentado, useTorrada } from '../ui/base';
import { CartaoVisual } from '../ui/CartaoVisual';
import { SeletorCor } from './Contas';

export function FormCartao({ fechar, cartao }: { fechar: () => void; cartao?: Cartao }) {
  const { executar } = useFinanc();
  const torrada = useTorrada();
  const id = useId();
  const [nome, setNome] = useState(cartao?.nome ?? '');
  const [cor, setCor] = useState(cartao?.cor ?? '#1F2937');
  const [final, setFinal] = useState(cartao?.final ?? '');
  const [bandeira, setBandeira] = useState(cartao?.bandeira ?? '');
  const [limite, setLimite] = useState<number | null>(cartao?.limite ?? null);
  const [fecha, setFecha] = useState(cartao?.dia_fechamento ?? 1);
  const [vence, setVence] = useState(cartao?.dia_vencimento ?? 10);
  const [compPor, setCompPor] = useState<'vencimento' | 'fechamento'>(cartao?.competencia_por ?? 'vencimento');
  const [apelidos, setApelidos] = useState((cartao?.apelidos ?? []).join(', '));
  const [padrao, setPadrao] = useState(cartao?.padrao ?? false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // exemplo de como fica o nome das faturas com o fechamento/vencimento escolhidos
  const exemplo = (() => {
    const hoje = new Date();
    const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const c = { dia_fechamento: fecha, dia_vencimento: vence, competencia_por: compPor } as const;
    const comp = competenciaCredito(iso, c);
    const d = faturaDatas(c, comp);
    return `Uma compra hoje entra na fatura de ${nomeMes(comp)}: fecha em ${dataCurta(d.fechamento)} e vence em ${dataCurta(d.vencimento)}.`;
  })();

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!nome.trim()) return setErro('Dê um nome ao cartão.');
    if (final && !/^\d{4}$/.test(final)) return setErro('O final do cartão tem 4 dígitos.');
    setOcupado(true);
    const lista = apelidos.split(',').map((x) => x.trim()).filter(Boolean);
    const corpo = {
      nome: nome.trim(), cor, final: final || null, bandeira: bandeira.trim() || null, limite: limite ?? undefined,
      dia_fechamento: fecha, dia_vencimento: vence, competencia_por: compPor, apelidos: lista.length ? lista : undefined,
      padrao: padrao && !cartao?.padrao ? true : undefined,
    };
    try {
      if (cartao) await executar({ metodo: 'PATCH', caminho: `/api/cartoes/${cartao.id}`, corpo, rotulo: `Editar ${cartao.nome}` });
      else await executar({ metodo: 'POST', caminho: '/api/cartoes', corpo, rotulo: `Novo cartão ${nome}` });
      torrada(cartao ? 'Cartão atualizado' : 'Cartão adicionado');
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
        <div style={{ maxWidth: 320, margin: '0 auto 18px' }}>
          <CartaoVisual nome={nome || 'Nome do cartão'} cor={cor} tipo="Crédito" final={final || null} bandeira={bandeira || null} />
        </div>
        <div className="campo">
          <label htmlFor={id}>Nome</label>
          <input id={id} className="entrada" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Nubank, Inter" required />
        </div>
        <div className="campo">
          <span className="rotulo">Cor</span>
          <SeletorCor valor={cor} aoMudar={setCor} />
        </div>
        <div className="linha-campos">
          <div className="campo">
            <label htmlFor={`${id}-f`}>Final</label>
            <input id={`${id}-f`} className="entrada num" inputMode="numeric" maxLength={4} value={final} onChange={(e) => setFinal(e.target.value.replace(/\D/g, ''))} placeholder="1234" />
          </div>
          <div className="campo">
            <label htmlFor={`${id}-b`}>Bandeira</label>
            <input id={`${id}-b`} className="entrada" list={`${id}-bl`} maxLength={20} value={bandeira} onChange={(e) => setBandeira(e.target.value)} placeholder="Opcional" />
            <datalist id={`${id}-bl`}>{['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard'].map((b) => <option key={b} value={b} />)}</datalist>
          </div>
        </div>
        <div className="campo">
          <label htmlFor={`${id}-l`}>Limite</label>
          <CampoDinheiro id={`${id}-l`} valor={limite} aoMudar={setLimite} placeholder="Opcional" />
        </div>
        <div className="linha-campos">
          <div className="campo">
            <label htmlFor={`${id}-fe`}>Dia que fecha</label>
            <input id={`${id}-fe`} className="entrada num" type="number" min={1} max={31} value={fecha} onChange={(e) => setFecha(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
          <div className="campo">
            <label htmlFor={`${id}-v`}>Dia que vence</label>
            <input id={`${id}-v`} className="entrada num" type="number" min={1} max={31} value={vence} onChange={(e) => setVence(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
        </div>
        <div className="campo">
          <span className="rotulo">O mês da fatura é o mês em que ela</span>
          <Segmentado rotulo="Mês da fatura" valor={compPor} aoMudar={setCompPor} opcoes={[{ valor: 'vencimento', rotulo: 'Vence' }, { valor: 'fechamento', rotulo: 'Fecha' }]} />
          <span className="dica">{exemplo}</span>
        </div>
        <div className="campo">
          <label htmlFor={`${id}-a`}>Apelidos</label>
          <input id={`${id}-a`} className="entrada" value={apelidos} onChange={(e) => setApelidos(e.target.value)} placeholder="nu, roxinho" />
          <span className="dica">Separados por vírgula. É como você chama o cartão no WhatsApp.</span>
        </div>
        <label className="interruptor">
          <span style={{ display: 'grid' }}><span style={{ fontWeight: 550 }}>Cartão padrão</span><span className="nota">Usado quando o gasto não diz o cartão.</span></span>
          <input type="checkbox" role="switch" checked={padrao} disabled={cartao?.padrao} onChange={(e) => setPadrao(e.target.checked)} />
        </label>
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>{cartao ? 'Salvar cartão' : 'Adicionar cartão'}</button></RodapeFolha>
    </form>
  );
}

export function FormPagarFatura({ fechar, cartao, fatura }: { fechar: () => void; cartao: Cartao; fatura: Fatura }) {
  const { executar, snap } = useFinanc();
  const torrada = useTorrada();
  const contas = snap ? contasDeCaixa(snap) : [];
  const [valor, setValor] = useState(fatura.valor_fatura);
  const [conta, setConta] = useState<number>(snap?.padrao.conta_id ?? contas[0]?.id ?? 0);
  const [data, setData] = useState(snap?.hoje ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const id = useId();
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    try {
      await executar({
        metodo: 'POST', caminho: '/api/faturas',
        corpo: { cartao_id: cartao.id, mes: fatura.competencia, acao: 'pagar', valor: Math.abs(valor - fatura.valor_fatura) > 0.004 ? valor : undefined, conta_id: conta, data },
        rotulo: `Pagar fatura ${cartao.nome}`,
      });
      torrada('Fatura marcada como paga');
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
        <CampoValor rotulo="Valor pago" valor={valor} aoMudar={setValor} />
        <div className="campo">
          <span className="rotulo">Pago com</span>
          <div className="chips">
            {contas.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={conta === c.id} onClick={() => setConta(c.id)}><span className="bolinha" style={{ background: corPadraoConta(c) }} />{c.nome}</button>)}
          </div>
        </div>
        <div className="campo">
          <label htmlFor={`${id}-d`}>Data do pagamento</label>
          <input id={`${id}-d`} className="entrada" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <p className="nota">O valor sai do saldo da conta escolhida. Se pagou diferente do total, a fatura fica com o valor pago.</p>
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado || !(valor > 0)}>Marcar como paga</button></RodapeFolha>
    </form>
  );
}

export function FormValorFatura({ fechar, cartao, fatura }: { fechar: () => void; cartao: Cartao; fatura: Fatura }) {
  const { executar } = useFinanc();
  const torrada = useTorrada();
  const [valor, setValor] = useState(fatura.valor_fatura);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    try {
      await executar({ metodo: 'POST', caminho: '/api/faturas', corpo: { cartao_id: cartao.id, mes: fatura.competencia, acao: 'ajustar', valor }, rotulo: `Valor da fatura ${cartao.nome}` });
      torrada('Valor da fatura atualizado');
      fechar();
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };
  const limpar = async () => {
    setOcupado(true);
    try {
      await executar({ metodo: 'POST', caminho: '/api/faturas', corpo: { cartao_id: cartao.id, mes: fatura.competencia, acao: 'limpar_ajuste' }, rotulo: 'Voltar ao calculado' });
      torrada('A fatura voltou a ser a soma dos lançamentos');
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
        <p className="nota" style={{ marginTop: 0 }}>
          Digite o total que aparece agora no app do {cartao.nome}. As compras que você lançar depois somam em cima desse valor.
        </p>
        <CampoValor rotulo={`Total da fatura de ${nomeMes(fatura.competencia)}`} valor={valor} aoMudar={setValor} autoFocus />
        {fatura.valor_ajustado !== null && (
          <button type="button" className="btn fantasma" onClick={limpar} disabled={ocupado}>Usar só a soma dos lançamentos ({reais(fatura.valor_calculado)})</button>
        )}
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>Salvar valor</button></RodapeFolha>
    </form>
  );
}

/** simular uma compra: em qual fatura cai e como ficam o limite e as faturas */
export function Simulador({ cartao, hoje }: { cartao: Cartao; hoje: string }) {
  const [valor, setValor] = useState(0);
  const [parcelas, setParcelas] = useState(1);
  const [data, setData] = useState(hoje);
  const id = useId();
  const sim = valor > 0 ? simularCompra(cartao, valor, parcelas, data) : null;
  return (
    <CorpoFolha>
      <CampoValor rotulo="Valor da compra" valor={valor} aoMudar={setValor} autoFocus />
      <div className="linha-campos">
        <div className="campo">
          <label htmlFor={`${id}-p`}>Parcelas</label>
          <select id={`${id}-p`} className="entrada" value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}×`}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor={`${id}-d`}>Data da compra</label>
          <input id={`${id}-d`} className="entrada" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
      </div>
      {sim && (
        <>
          <div className="resumo-sim">
            <span>Entra na fatura de <strong>{nomeMes(sim.parcelas[0].competencia)}</strong>, que vence em {dataCurta(sim.parcelas[0].vencimento)}.</span>
            {sim.limiteDepois !== null && (
              <span style={{ color: sim.limiteDepois < 0 ? 'var(--bad)' : undefined }}>
                Limite disponível depois: <strong><Dinheiro valor={sim.limiteDepois} /></strong>{sim.limiteDepois < 0 ? ' (passa do limite)' : ''}
              </span>
            )}
          </div>
          <div className="lista-sim" role="list">
            {sim.parcelas.map((p) => (
              <div className="linha sem-icone" role="listitem" key={p.n} style={{ gridTemplateColumns: '1fr auto' }}>
                <span className="linha-texto">
                  <span className="linha-titulo" style={{ display: 'block' }}>{parcelas > 1 ? `${p.n}/${parcelas}, ` : ''}fatura de {nomeMes(p.competencia, p.competencia.slice(0, 4) !== hoje.slice(0, 4))}</span>
                  <span className="linha-sub" style={{ display: 'block' }}>Fica <Dinheiro valor={p.faturaDepois} /> (hoje <Dinheiro valor={p.faturaAntes} />)</span>
                </span>
                <span className="linha-valor"><Dinheiro valor={p.valor} /></span>
              </div>
            ))}
          </div>
        </>
      )}
      {!sim && <p className="nota">Digite um valor para ver em qual fatura a compra cai.</p>}
    </CorpoFolha>
  );
}
