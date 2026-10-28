import { useId, useState, type FormEvent } from 'react';
import { useFinanc } from '../lib/estado';
import { CORES_CARTAO, contasDeCaixa, corPadraoConta } from '../lib/financas';
import { dataCurta, reais } from '../lib/formato';
import type { Conta, TipoConta } from '../lib/tipos';
import { CampoDinheiro, CampoValor, CorpoFolha, RodapeFolha, Segmentado, useTorrada } from '../ui/base';

export function SeletorCor({ valor, aoMudar }: { valor: string; aoMudar: (c: string) => void }) {
  return (
    <div className="cores" role="group" aria-label="Cor">
      {CORES_CARTAO.map((c) => (
        <button key={c} type="button" className="cor-opcao" style={{ background: c }} aria-pressed={valor.toLowerCase() === c.toLowerCase()} aria-label={`Cor ${c}`} onClick={() => aoMudar(c)} />
      ))}
    </div>
  );
}

/** informar o saldo que aparece no app do banco (vira o ponto de partida da conta) */
export function FormSaldo({ conta, fechar }: { conta: Conta; fechar: () => void }) {
  const { executar, snap } = useFinanc();
  const torrada = useTorrada();
  const [valor, setValor] = useState<number | null>(conta.saldo);
  const [data, setData] = useState(snap?.hoje ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const id = useId();
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (valor === null) return setErro('Informe o saldo.');
    setOcupado(true);
    try {
      await executar({ metodo: 'POST', caminho: `/api/contas/${conta.id}/saldo`, corpo: { saldo: valor, data }, rotulo: `Saldo ${conta.nome}` });
      torrada('Saldo atualizado');
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
          Digite o saldo que aparece no app do banco. Daqui pra frente o Financ soma os lançamentos a partir dele.
          {conta.ultimo_ajuste ? ` Último informado: ${reais(conta.ultimo_ajuste.saldo)} em ${dataCurta(conta.ultimo_ajuste.data)}.` : ''}
        </p>
        <div className="campo">
          <label htmlFor={id}>Saldo</label>
          <CampoDinheiro id={id} valor={valor} aoMudar={setValor} permitirNegativo />
        </div>
        <div className="campo">
          <label htmlFor={`${id}-d`}>Saldo do dia</label>
          <input id={`${id}-d`} className="entrada" type="date" value={data} max={snap?.hoje} onChange={(e) => setData(e.target.value)} />
        </div>
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>Salvar saldo</button></RodapeFolha>
    </form>
  );
}

export function FormTransferencia({ fechar, deId }: { fechar: () => void; deId?: number }) {
  const { executar, snap } = useFinanc();
  const torrada = useTorrada();
  const contas = snap ? contasDeCaixa(snap) : [];
  const [de, setDe] = useState<number>(deId ?? contas[0]?.id ?? 0);
  const [para, setPara] = useState<number>(contas.find((c) => c.id !== (deId ?? contas[0]?.id))?.id ?? 0);
  const [valor, setValor] = useState(0);
  const [data, setData] = useState(snap?.hoje ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const id = useId();
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!(valor > 0)) return setErro('Informe o valor.');
    if (de === para) return setErro('Escolha contas diferentes.');
    setOcupado(true);
    try {
      await executar({ metodo: 'POST', caminho: '/api/transferencias', corpo: { de_id: de, para_id: para, valor, data }, rotulo: 'Transferência' });
      torrada('Transferência registrada');
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
        <CampoValor rotulo="Valor" valor={valor} aoMudar={setValor} autoFocus />
        <div className="campo">
          <span className="rotulo">De</span>
          <div className="chips">
            {contas.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={de === c.id} onClick={() => setDe(c.id)}><span className="bolinha" style={{ background: corPadraoConta(c) }} />{c.nome}</button>)}
          </div>
        </div>
        <div className="campo">
          <span className="rotulo">Para</span>
          <div className="chips">
            {contas.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={para === c.id} onClick={() => setPara(c.id)}><span className="bolinha" style={{ background: corPadraoConta(c) }} />{c.nome}</button>)}
          </div>
        </div>
        <div className="campo">
          <label htmlFor={`${id}-d`}>Data</label>
          <input id={`${id}-d`} className="entrada" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <p className="nota">Transferência entre suas contas não conta como gasto nem como entrada.</p>
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado || !(valor > 0)}>Transferir</button></RodapeFolha>
    </form>
  );
}

/** criar ou editar conta; o tipo "beneficio" é o cartão de vale (VA/VR) */
export function FormConta({ fechar, conta, tipoInicial }: { fechar: () => void; conta?: Conta; tipoInicial?: TipoConta }) {
  const { executar } = useFinanc();
  const torrada = useTorrada();
  const id = useId();
  const [nome, setNome] = useState(conta?.nome ?? '');
  const [tipo, setTipo] = useState<TipoConta>(conta?.tipo ?? tipoInicial ?? 'pf');
  const [cor, setCor] = useState(conta ? corPadraoConta(conta) : tipoInicial === 'beneficio' ? '#C2410C' : '#1D4ED8');
  const [instituicao, setInstituicao] = useState(conta?.instituicao ?? '');
  const [final, setFinal] = useState(conta?.final ?? '');
  const [apelidos, setApelidos] = useState((conta?.apelidos ?? []).join(', '));
  const [padrao, setPadrao] = useState(conta?.padrao ?? false);
  const [saldo, setSaldo] = useState<number | null>(null);
  const [recarga, setRecarga] = useState<number | null>(null);
  const [diaRecarga, setDiaRecarga] = useState(5);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const beneficio = tipo === 'beneficio';

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!nome.trim()) return setErro('Dê um nome.');
    if (final && !/^\d{4}$/.test(final)) return setErro('O final do cartão tem 4 dígitos.');
    setOcupado(true);
    const lista = apelidos.split(',').map((x) => x.trim()).filter(Boolean);
    const corpo: Record<string, unknown> = {
      nome: nome.trim(), tipo, cor, instituicao: instituicao.trim() || null, final: final || null,
      apelidos: lista.length ? lista : undefined, padrao: !beneficio && padrao ? true : undefined,
    };
    try {
      if (conta) {
        await executar({ metodo: 'PATCH', caminho: `/api/contas/${conta.id}`, corpo, rotulo: `Editar ${conta.nome}` });
        torrada('Conta atualizada');
      } else {
        await executar({
          metodo: 'POST', caminho: '/api/contas',
          corpo: { ...corpo, saldo: saldo ?? undefined, recarga: beneficio && recarga ? { valor: recarga, dia: diaRecarga } : undefined },
          rotulo: `Nova conta ${nome}`,
        });
        torrada(beneficio ? 'Cartão de benefício adicionado' : 'Conta adicionada');
      }
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
        {!conta && (
          <div style={{ marginBottom: 16 }}>
            <Segmentado rotulo="Tipo" valor={tipo} aoMudar={setTipo}
              opcoes={[{ valor: 'pf', rotulo: 'Pessoal' }, { valor: 'pj', rotulo: 'Empresa' }, { valor: 'beneficio', rotulo: 'Vale' }, { valor: 'outro', rotulo: 'Outra' }]} />
          </div>
        )}
        <div className="campo">
          <label htmlFor={id}>Nome</label>
          <input id={id} className="entrada" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} placeholder={beneficio ? 'Ex.: Vale-alimentação' : 'Ex.: Inter, Conta PJ'} required />
        </div>
        <div className="linha-campos">
          <div className="campo">
            <label htmlFor={`${id}-i`}>{beneficio ? 'Empresa do vale' : 'Banco'}</label>
            <input id={`${id}-i`} className="entrada" value={instituicao} maxLength={40} onChange={(e) => setInstituicao(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="campo">
            <label htmlFor={`${id}-f`}>Final do cartão</label>
            <input id={`${id}-f`} className="entrada num" inputMode="numeric" maxLength={4} value={final} onChange={(e) => setFinal(e.target.value.replace(/\D/g, ''))} placeholder="1234" />
          </div>
        </div>
        <div className="campo">
          <span className="rotulo">Cor</span>
          <SeletorCor valor={cor} aoMudar={setCor} />
        </div>
        {!conta && (
          <div className="campo">
            <label htmlFor={`${id}-s`}>Saldo hoje</label>
            <CampoDinheiro id={`${id}-s`} valor={saldo} aoMudar={setSaldo} permitirNegativo={!beneficio} />
            <span className="dica">O valor que aparece no app {beneficio ? 'do vale' : 'do banco'} agora.</span>
          </div>
        )}
        {!conta && beneficio && (
          <div className="linha-campos">
            <div className="campo">
              <label htmlFor={`${id}-r`}>Recarga mensal</label>
              <CampoDinheiro id={`${id}-r`} valor={recarga} aoMudar={setRecarga} placeholder="Opcional" />
            </div>
            <div className="campo">
              <label htmlFor={`${id}-rd`}>Dia da recarga</label>
              <input id={`${id}-rd`} className="entrada num" type="number" min={1} max={31} value={diaRecarga} onChange={(e) => setDiaRecarga(Number(e.target.value))} />
            </div>
          </div>
        )}
        <div className="campo">
          <label htmlFor={`${id}-a`}>Apelidos</label>
          <input id={`${id}-a`} className="entrada" value={apelidos} onChange={(e) => setApelidos(e.target.value)} placeholder={beneficio ? 'va, vale' : 'nu, roxinho'} />
          <span className="dica">Separados por vírgula. É como você chama a conta no WhatsApp.</span>
        </div>
        {!beneficio && (
          <label className="interruptor">
            <span style={{ display: 'grid' }}><span style={{ fontWeight: 550 }}>Conta padrão</span><span className="nota">Usada quando o gasto ou a entrada não diz a conta.</span></span>
            <input type="checkbox" role="switch" checked={padrao} onChange={(e) => setPadrao(e.target.checked)} />
          </label>
        )}
        {beneficio && <p className="nota">O saldo do vale fica fora do saldo em conta e do “como fecho o mês”. Compras no vale não entram nos orçamentos.</p>}
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>{conta ? 'Salvar' : beneficio ? 'Adicionar cartão de benefício' : 'Adicionar conta'}</button></RodapeFolha>
    </form>
  );
}
