import { useState } from 'react';
import { ArrowLeft, Calculator, CheckCircle2, CircleDollarSign, Clock3, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { ir, voltar, useFolhas } from '../lib/navegacao';
import { faturaEmFoco } from '../lib/financas';
import { dataCurta, mesCurto, nomeMes, primeiraMaiuscula, reais } from '../lib/formato';
import { Confirmar, Dinheiro, Medidor, Vazio } from '../ui/base';
import { CartaoVisual } from '../ui/CartaoVisual';
import { ListaPorDia } from '../ui/Lancamentos';
import { FormCartao, FormPagarFatura, FormValorFatura, Simulador } from '../formularios/Cartoes';
import { FormLancamento } from '../formularios/Lancamento';

export function CartaoDetalhe({ id }: { id: number }) {
  const { snap, executar } = useFinanc();
  const { abrir } = useFolhas();
  const cartao = snap?.cartoes.find((c) => c.id === id);
  const [comp, setComp] = useState<string | null>(null);

  if (!snap) return null;
  if (!cartao) {
    return (
      <>
        <header className="topo">
          <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar('/carteira')}><ArrowLeft size={20} /></button>
          <h1>Cartão</h1>
        </header>
        <div className="grupo"><Vazio titulo="Cartão não encontrado" texto="Ele pode ter sido removido." /></div>
      </>
    );
  }

  const foco = faturaEmFoco(cartao);
  const atual = comp ?? foco?.competencia ?? cartao.competencia_atual;
  const fatura = cartao.faturas.find((f) => f.competencia === atual);
  const itens = snap.lancamentos.filter((l) => l.metodo === 'credito' && l.cartao_id === cartao.id && l.competencia === atual);
  const usado = cartao.faturas[0]?.limite_usado_total ?? 0;
  const disponivel = cartao.faturas[0]?.limite_disponivel ?? null;
  const visiveis = cartao.faturas.filter((f) => f.competencia >= cartao.competencia_atual || f.valor_fatura > 0.004 || f.itens > 0);

  return (
    <>
      <header className="topo">
        <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar('/carteira')}><ArrowLeft size={20} /></button>
        <h1>{cartao.nome}</h1>
        <button type="button" className="icone-btn" aria-label="Editar cartão" onClick={() => abrir(`Editar ${cartao.nome}`, (f) => <FormCartao fechar={f} cartao={cartao} />)}>
          <Pencil size={19} />
        </button>
      </header>

      <div className="grade-2">
        <div className="col">
          <div style={{ maxWidth: 440 }}>
            <CartaoVisual
              nome={cartao.nome}
              cor={cartao.cor ?? '#334155'}
              tipo={cartao.padrao ? 'Crédito, padrão' : 'Crédito'}
              final={cartao.final}
              bandeira={cartao.bandeira}
              rotuloValor={cartao.limite ? 'Disponível' : undefined}
              valor={cartao.limite ? disponivel ?? 0 : undefined}
              rotuloAcessivel={`${cartao.nome}${cartao.limite ? `, disponível ${reais(disponivel)}` : ''}`}
            />
          </div>
          {cartao.limite ? (
            <div style={{ display: 'grid', gap: 6, margin: '14px 2px 0' }}>
              <Medidor pct={(usado / cartao.limite) * 100} rotulo={`Limite usado: ${Math.round((usado / cartao.limite) * 100)}%`} />
              <div className="orc-pe" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Usado <Dinheiro valor={usado} /></span>
                <span>Limite <Dinheiro valor={cartao.limite} /></span>
              </div>
            </div>
          ) : null}

          <section className="secao" aria-label="Faturas">
            <div className="secao-cab"><h2>Faturas</h2></div>
            <div className="meses" role="group" aria-label="Escolha a fatura">
              {visiveis.map((f) => (
                <button key={f.competencia} type="button" className="mes-pilula" aria-pressed={f.competencia === atual} onClick={() => setComp(f.competencia)}>
                  <span className="m">{primeiraMaiuscula(mesCurto(f.competencia, f.competencia.slice(0, 4) !== snap.hoje.slice(0, 4)))}</span>
                  <span className="v">{reais(f.valor_fatura).replace('R$ ', '')}</span>
                </button>
              ))}
            </div>

            {fatura && (
              <div className="grupo" style={{ marginTop: 12 }}>
                <div className="fatura-resumo">
                  <span className={`etiqueta ${fatura.status}`}>
                    {fatura.status === 'paga' ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
                    {fatura.status === 'paga' ? `Paga em ${dataCurta(fatura.data_pagamento)}` : fatura.status === 'fechada' ? 'Fechada' : 'Aberta'}
                  </span>
                  <span className="nota" style={{ marginTop: 6 }}>Fatura de {nomeMes(fatura.competencia, true)}</span>
                  <span className="fatura-valor"><Dinheiro valor={fatura.valor_fatura} /></span>
                  <span className="nota">
                    {fatura.status === 'aberta' ? `Fecha em ${dataCurta(fatura.fechamento)}, vence em ${dataCurta(fatura.vencimento)}` : `Fechou em ${dataCurta(fatura.fechamento)}, vence em ${dataCurta(fatura.vencimento)}`}
                  </span>
                  {fatura.valor_ajustado !== null && (
                    <span className="nota">
                      Total informado <Dinheiro valor={fatura.valor_ajustado} />
                      {fatura.apos_ajuste ? <> mais <Dinheiro valor={fatura.apos_ajuste} /> lançados depois</> : null}
                    </span>
                  )}
                </div>
                <div style={{ padding: '0 16px 16px' }} className="acoes">
                  {fatura.paga ? (
                    <button type="button" className="btn sec peq" onClick={() => abrir('Reabrir fatura', (f) => (
                      <Confirmar fechar={f} rotuloAcao="Reabrir" texto={`A fatura de ${nomeMes(fatura.competencia)} volta a ficar em aberto e o pagamento sai do saldo da conta.`}
                        acao={async () => { await executar({ metodo: 'POST', caminho: '/api/faturas', corpo: { cartao_id: cartao.id, mes: fatura.competencia, acao: 'reabrir' }, rotulo: 'Reabrir fatura' }); }} />
                    ))}>
                      <RotateCcw aria-hidden="true" /> Reabrir
                    </button>
                  ) : (
                    <button type="button" className="btn peq" disabled={fatura.valor_fatura <= 0} onClick={() => abrir(`Pagar fatura de ${nomeMes(fatura.competencia)}`, (f) => <FormPagarFatura fechar={f} cartao={cartao} fatura={fatura} />)}>
                      <CheckCircle2 aria-hidden="true" /> Pagar
                    </button>
                  )}
                  {!fatura.paga && (
                    <button type="button" className="btn sec peq" onClick={() => abrir('Valor da fatura', (f) => <FormValorFatura fechar={f} cartao={cartao} fatura={fatura} />)}>
                      <CircleDollarSign aria-hidden="true" /> Informar valor
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <div className="acoes" style={{ marginTop: 14 }}>
            <button type="button" className="btn sec" onClick={() => abrir(`Simular compra no ${cartao.nome}`, () => <Simulador cartao={cartao} hoje={snap.hoje} />)}>
              <Calculator aria-hidden="true" /> Simular compra
            </button>
            <button type="button" className="btn sec" onClick={() => abrir('Novo gasto', (f) => <FormLancamento fechar={f} inicial={{ tipo: 'saida', cartao_id: cartao.id }} />)}>
              <Plus aria-hidden="true" /> Gasto
            </button>
          </div>
        </div>

        <div className="col">
          <section className="secao" aria-label="Compras da fatura">
            <div className="secao-cab">
              <h2>Compras da fatura</h2>
              <span className="nota">{itens.length} {itens.length === 1 ? 'item' : 'itens'}</span>
            </div>
            {itens.length === 0 ? (
              <div className="grupo"><Vazio titulo="Nenhuma compra lançada nesta fatura" texto={fatura?.valor_ajustado ? 'O total vem do valor informado.' : undefined} /></div>
            ) : (
              <ListaPorDia lancamentos={itens} snap={snap} />
            )}
          </section>

          <div style={{ marginTop: 28 }}>
            <button type="button" className="btn fantasma" onClick={() => abrir(`Remover ${cartao.nome}`, (f) => (
              <Confirmar fechar={f} perigo rotuloAcao="Remover cartão"
                texto="O cartão sai da carteira e do formulário de gastos. Os lançamentos e faturas antigos continuam no histórico."
                acao={async () => { await executar({ metodo: 'DELETE', caminho: `/api/cartoes/${cartao.id}`, rotulo: 'Remover cartão' }); }}
                depois={() => ir('/carteira', { substituir: true })} />
            ))}>
              Remover cartão
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
