import { ArrowLeft, ArrowLeftRight, CreditCard, Pencil, PiggyBank, Plus, RefreshCcw, SlidersHorizontal } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { ir, voltar, useFolhas } from '../lib/navegacao';
import { corPadraoConta } from '../lib/financas';
import { dataCurta, NOME_TIPO_CONTA, quandoRelativo, somarDias, tituloDia } from '../lib/formato';
import type { Lancamento, Movimento } from '../lib/tipos';
import { Confirmar, Dinheiro, Vazio } from '../ui/base';
import { CartaoVisual } from '../ui/CartaoVisual';
import { LinhaLancamento } from '../ui/Lancamentos';
import { FormConta, FormSaldo, FormTransferencia } from '../formularios/Contas';
import { FormLancamento } from '../formularios/Lancamento';

type Evento = { tipo: 'lanc'; data: string; l: Lancamento } | { tipo: 'mov'; data: string; m: Movimento };

const ICONE_MOV = { pagamento_fatura: CreditCard, transferencia: ArrowLeftRight, caixinha: PiggyBank, ajuste: SlidersHorizontal, outro: SlidersHorizontal };

export function ContaDetalhe({ id }: { id: number }) {
  const { snap, executar } = useFinanc();
  const { abrir } = useFolhas();
  const conta = snap?.contas.find((c) => c.id === id);
  if (!snap) return null;
  if (!conta) {
    return (
      <>
        <header className="topo">
          <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar('/carteira')}><ArrowLeft size={20} /></button>
          <h1>Conta</h1>
        </header>
        <div className="grupo"><Vazio titulo="Conta não encontrada" /></div>
      </>
    );
  }
  const beneficio = conta.tipo === 'beneficio';
  const desde = somarDias(snap.hoje, -90);
  const eventos: Evento[] = [
    ...snap.lancamentos.filter((l) => l.conta_id === conta.id && l.metodo !== 'credito' && l.data >= desde).map((l) => ({ tipo: 'lanc' as const, data: l.data, l })),
    ...snap.movimentos.filter((m) => m.conta_id === conta.id && m.data >= desde).map((m) => ({ tipo: 'mov' as const, data: m.data, m })),
  ].sort((a, b) => b.data.localeCompare(a.data));
  const recarga = snap.recorrentes.find((r) => r.conta_id === conta.id && r.tipo === 'entrada' && r.ativo);

  const dias: { dia: string; itens: Evento[] }[] = [];
  for (const e of eventos) {
    const g = dias[dias.length - 1];
    if (g && g.dia === e.data) g.itens.push(e);
    else dias.push({ dia: e.data, itens: [e] });
  }

  return (
    <>
      <header className="topo">
        <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar(beneficio ? '/carteira' : '/carteira/contas')}><ArrowLeft size={20} /></button>
        <h1>{conta.nome}</h1>
        <button type="button" className="icone-btn" aria-label="Editar" onClick={() => abrir(`Editar ${conta.nome}`, (f) => <FormConta fechar={f} conta={conta} />)}><Pencil size={19} /></button>
      </header>

      <div className="grade-2">
        <div className="col">
          {beneficio ? (
            <div style={{ maxWidth: 440 }}>
              <CartaoVisual nome={conta.nome} cor={corPadraoConta(conta)} tipo={conta.instituicao ? `Benefício, ${conta.instituicao}` : 'Benefício'}
                final={conta.final} bandeira={conta.bandeira} rotuloValor="Saldo" valor={conta.saldo ?? 0} />
            </div>
          ) : (
            <div className="grupo">
              <div className="conta-cab">
                <span className="selo" style={{ background: corPadraoConta(conta) }} aria-hidden="true">{conta.nome.slice(0, 2).toUpperCase()}</span>
                <span style={{ display: 'grid' }}>
                  <span className="nota">{NOME_TIPO_CONTA[conta.tipo]}{conta.instituicao ? `, ${conta.instituicao}` : ''}{conta.padrao ? ', conta padrão' : ''}</span>
                  <span className="saldo-grande">{conta.saldo === null ? 'Sem saldo' : <Dinheiro valor={conta.saldo} />}</span>
                </span>
              </div>
            </div>
          )}
          <p className="nota" style={{ margin: '10px 2px 0' }}>
            {conta.ultimo_ajuste ? `Saldo conferido ${quandoRelativo(conta.ultimo_ajuste.data, snap.hoje)}; desde então o Financ soma os lançamentos.` : 'Informe o saldo para o Financ calcular os próximos.'}
            {beneficio && recarga ? ` Recarga de ${recarga.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} todo dia ${recarga.dia_vencimento}.` : ''}
          </p>

          <div className="acoes-icones" style={{ marginTop: 16 }}>
            <button type="button" className="acao-icone" onClick={() => abrir(`Saldo de ${conta.nome}`, (f) => <FormSaldo conta={conta} fechar={f} />)}>
              <span className="ic"><RefreshCcw /></span> Informar saldo
            </button>
            <button type="button" className="acao-icone" onClick={() => abrir(beneficio ? `Gasto no ${conta.nome}` : 'Novo lançamento', (f) => (
              <FormLancamento fechar={f} inicial={beneficio ? { tipo: 'saida', metodo: 'vale', conta_id: conta.id } : { tipo: 'saida', metodo: 'pix', conta_id: conta.id }} />
            ))}>
              <span className="ic"><Plus /></span> {beneficio ? 'Gasto' : 'Lançamento'}
            </button>
            {beneficio ? (
              <button type="button" className="acao-icone" onClick={() => abrir('Recarga do vale', (f) => <FormLancamento fechar={f} inicial={{ tipo: 'entrada', metodo: 'vale', conta_id: conta.id }} />)}>
                <span className="ic"><ArrowLeftRight /></span> Recarga
              </button>
            ) : (
              <button type="button" className="acao-icone" onClick={() => abrir('Transferir entre contas', (f) => <FormTransferencia fechar={f} deId={conta.id} />)}>
                <span className="ic"><ArrowLeftRight /></span> Transferir
              </button>
            )}
          </div>
        </div>

        <div className="col">
          <section className="secao" aria-label="Movimentos">
            <div className="secao-cab"><h2>Movimentos</h2><span className="nota">últimos 90 dias</span></div>
            {dias.length === 0 && <div className="grupo"><Vazio titulo="Nenhum movimento" /></div>}
            {dias.map((g) => (
              <section key={g.dia}>
                <div className="dia-cab"><span>{tituloDia(g.dia, snap.hoje)}</span></div>
                <div className="grupo">
                  {g.itens.map((e) => {
                    if (e.tipo === 'lanc') return <LinhaLancamento key={`l${e.l.id}`} l={e.l} snap={snap} />;
                    const Icone = ICONE_MOV[e.m.tipo] ?? SlidersHorizontal;
                    return (
                      <div className="linha" key={`m${e.m.id}`}>
                        <span className="linha-icone"><Icone aria-hidden="true" /></span>
                        <span className="linha-texto">
                          <span className="linha-titulo" style={{ display: 'block' }}>{e.m.descricao ?? 'Movimento'}</span>
                          <span className="linha-sub" style={{ display: 'block' }}>{dataCurta(e.m.data)}</span>
                        </span>
                        <span className="linha-valor"><Dinheiro valor={e.m.valor} tipo={e.m.valor >= 0 ? 'entrada' : 'saida'} sinal={e.m.valor >= 0} /></span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </section>
          <div style={{ marginTop: 28 }}>
            <button type="button" className="btn fantasma" onClick={() => abrir(`Remover ${conta.nome}`, (f) => (
              <Confirmar fechar={f} perigo rotuloAcao="Remover"
                texto="A conta sai da carteira e dos totais. O histórico de lançamentos continua guardado."
                acao={async () => { await executar({ metodo: 'DELETE', caminho: `/api/contas/${conta.id}`, rotulo: 'Remover conta' }); }}
                depois={() => ir(beneficio ? '/carteira' : '/carteira/contas', { substituir: true })} />
            ))}>
              Remover {beneficio ? 'cartão de benefício' : 'conta'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
