import { useId, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowLeft, Plus, Target } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { voltar, useFolhas } from '../lib/navegacao';
import { categoriasFrequentes } from '../lib/financas';
import { nomeMes, reaisCompacto } from '../lib/formato';
import type { Orcamento } from '../lib/tipos';
import { CampoValor, CorpoFolha, Dinheiro, Interruptor, Medidor, RodapeFolha, useTorrada, Vazio } from '../ui/base';

function FormOrcamento({ fechar, o }: { fechar: () => void; o?: Orcamento }) {
  const { snap, executar } = useFinanc();
  const torrada = useTorrada();
  const id = useId();
  const cadastro = snap?.orcamentos_cadastro.find((x) => x.categoria === o?.categoria);
  const [nome, setNome] = useState(o?.categoria ?? '');
  const [valor, setValor] = useState(o?.orcamento ?? 0);
  const [cats, setCats] = useState<string[]>(o?.categorias ?? cadastro?.categorias ?? []);
  const [soEsteMes, setSoEsteMes] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!snap) return null;
  const todas = [...new Set([...categoriasFrequentes(snap, 'saida', 14), ...cats])];

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return setErro('Dê um nome ao orçamento.');
    if (!(valor > 0)) return setErro('Informe o valor.');
    setOcupado(true);
    try {
      await executar({
        metodo: 'POST', caminho: '/api/orcamentos',
        corpo: { categoria: nome.trim(), valor, categorias: cats.length ? cats : [nome.trim()], escopo: soEsteMes ? 'mes' : 'padrao', mes: soEsteMes ? snap.mes : undefined },
        rotulo: `Orçamento ${nome}`,
      });
      torrada('Orçamento salvo');
      fechar();
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (!o) return;
    setOcupado(true);
    try {
      await executar({ metodo: 'POST', caminho: '/api/orcamentos/remover', corpo: { categoria: o.categoria, escopo: o.so_este_mes ? 'mes' : 'padrao', mes: snap.mes }, rotulo: 'Remover orçamento' });
      torrada('Orçamento removido');
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
        <CampoValor rotulo="Limite por mês" valor={valor} aoMudar={setValor} />
        <div className="campo">
          <label htmlFor={id}>Nome</label>
          <input id={id} className="entrada" value={nome} maxLength={60} disabled={!!o} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Refeições" />
        </div>
        <div className="campo">
          <span className="rotulo">Categorias que entram</span>
          <div className="chips">
            {todas.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={cats.includes(c)} onClick={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])}>{c}</button>
            ))}
          </div>
          <span className="dica">Gastos dessas categorias somam neste orçamento, pela data da compra. Compras no vale não entram.</span>
        </div>
        <Interruptor rotulo={`Só em ${nomeMes(snap.mes)}`} dica="Muda o limite apenas deste mês." valor={soEsteMes} aoMudar={setSoEsteMes} />
        {o && (
          <button type="button" className="btn perigo cheio" style={{ marginTop: 10 }} onClick={remover} disabled={ocupado}>
            {o.so_este_mes ? `Remover o limite de ${nomeMes(snap.mes)}` : 'Remover orçamento'}
          </button>
        )}
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>Salvar orçamento</button></RodapeFolha>
    </form>
  );
}

export function Orcamentos() {
  const { snap } = useFinanc();
  const { abrir } = useFolhas();
  if (!snap) return null;
  return (
    <>
      <header className="topo">
        <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar('/ajustes')}><ArrowLeft size={20} /></button>
        <h1>Orçamentos</h1>
        <button type="button" className="icone-btn" aria-label="Novo orçamento" onClick={() => abrir('Novo orçamento', (f) => <FormOrcamento fechar={f} />)}><Plus size={20} /></button>
      </header>
      <p className="nota" style={{ margin: '0 2px 14px' }}>{`Situação de ${nomeMes(snap.mes)}. O alerta aparece a partir de 80% do limite.`}</p>
      <div className="grupo">
        {snap.orcamentos.length === 0 && <Vazio icone={<Target />} titulo="Nenhum orçamento" texto="Crie um limite mensal para uma ou mais categorias." />}
        {snap.orcamentos.map((o) => {
          const pct = o.pct ?? 0;
          return (
            <button type="button" className="orc" key={o.categoria} style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }}
              onClick={() => abrir(`Orçamento ${o.categoria}`, (f) => <FormOrcamento fechar={f} o={o} />)}>
              <div className="orc-topo">
                <span className="orc-nome">{o.categoria}{o.so_este_mes ? <span className="nota">, só este mês</span> : null}</span>
                <span className="num"><Dinheiro valor={o.gasto} /> <span className="nota">de {reaisCompacto(o.orcamento)}</span></span>
              </div>
              <Medidor pct={pct} rotulo={`${o.categoria}: ${pct}% usado`} />
              <div className="orc-pe">
                <span>{o.categorias.join(', ')}</span>
                <span className={`status ${pct >= 100 ? 'estourou' : pct >= 80 ? 'alerta' : ''}`}>
                  {pct >= 100 ? <><AlertTriangle size={13} aria-hidden="true" /> passou {reaisCompacto(-o.restante)}</> : `sobram ${reaisCompacto(o.restante)}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
