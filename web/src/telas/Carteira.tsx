import { ArrowLeftRight, History, Landmark, Minus, PiggyBank, Plus, RefreshCcw, Settings2, Wallet } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { ir, useFolhas, useRota } from '../lib/navegacao';
import { beneficios, contasDeCaixa, corPadraoConta, faturaEmFoco } from '../lib/financas';
import { dataCurta, NOME_TIPO_CONTA, nomeMes, quandoRelativo, reaisCompacto } from '../lib/formato';
import type { Caixinha } from '../lib/tipos';
import { Dinheiro, Medidor, Segmentado, Vazio } from '../ui/base';
import { CartaoVisual } from '../ui/CartaoVisual';
import { FormCartao } from '../formularios/Cartoes';
import { FormConta, FormTransferencia } from '../formularios/Contas';
import { FormCaixinha, FormMovimentoCaixinha, HistoricoCaixinha, MovimentosRecentes } from '../formularios/Caixinhas';

function iniciais(nome: string) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

function AcoesCaixinha({ c, fechar }: { c: Caixinha; fechar: () => void }) {
  const { abrir } = useFolhas();
  const proxima = (titulo: string, render: (f: () => void) => React.ReactNode) => {
    // troca a folha de ações pela folha da ação escolhida
    const depois = () => {
      window.removeEventListener('popstate', depois);
      setTimeout(() => abrir(titulo, render), 0);
    };
    window.addEventListener('popstate', depois);
    fechar();
  };
  return (
    <div className="folha-corpo">
      <div style={{ display: 'grid', gap: 2, marginBottom: 16 }}>
        <span className="nota">Saldo</span>
        <span className="saldo-grande"><Dinheiro valor={c.saldo} /></span>
        <span className="nota">
          {c.rendimento}{c.rendimento_mes ? `, rendeu ${reaisCompacto(c.rendimento_mes)} este mês` : ''}
          {c.ultimo_saldo_informado ? `. Saldo conferido em ${dataCurta(c.ultimo_saldo_informado.data)}` : ''}
        </span>
      </div>
      <div className="acoes-icones">
        <button type="button" className="acao-icone" onClick={() => proxima(`Guardar em ${c.nome}`, (f) => <FormMovimentoCaixinha caixinha={c} acao="aportar" fechar={f} />)}>
          <span className="ic"><Plus /></span> Guardar
        </button>
        <button type="button" className="acao-icone" onClick={() => proxima(`Resgatar de ${c.nome}`, (f) => <FormMovimentoCaixinha caixinha={c} acao="resgatar" fechar={f} />)}>
          <span className="ic"><Minus /></span> Resgatar
        </button>
        <button type="button" className="acao-icone" onClick={() => proxima(`Saldo de ${c.nome}`, (f) => <FormMovimentoCaixinha caixinha={c} acao="saldo" fechar={f} />)}>
          <span className="ic"><RefreshCcw /></span> Informar saldo
        </button>
        <button type="button" className="acao-icone" onClick={() => proxima(`Histórico de ${c.nome}`, () => <HistoricoCaixinha caixinha={c} />)}>
          <span className="ic"><History /></span> Histórico
        </button>
        <button type="button" className="acao-icone" onClick={() => proxima(`Editar ${c.nome}`, (f) => <FormCaixinha caixinha={c} fechar={f} />)}>
          <span className="ic"><Settings2 /></span> Editar
        </button>
      </div>
      <MovimentosRecentes caixinha={c} verTudo={() => proxima(`Histórico de ${c.nome}`, () => <HistoricoCaixinha caixinha={c} />)} />
    </div>
  );
}

export function Carteira() {
  const { snap } = useFinanc();
  const rota = useRota();
  const { abrir } = useFolhas();
  const aba = rota === '/carteira/contas' ? 'contas' : rota === '/carteira/caixinhas' ? 'caixinhas' : 'cartoes';
  if (!snap) return null;
  const vales = beneficios(snap);
  const contas = contasDeCaixa(snap);
  const totalContas = contas.reduce((s, c) => s + (c.saldo ?? 0), 0);
  const totalCaixinhas = snap.caixinhas.reduce((s, c) => s + c.saldo, 0);

  return (
    <>
      <header className="topo"><h1>Carteira</h1></header>
      <div style={{ marginBottom: 18 }}>
        <Segmentado
          rotulo="Seção da carteira"
          valor={aba}
          aoMudar={(v) => ir(v === 'cartoes' ? '/carteira' : `/carteira/${v}`, { substituir: true })}
          opcoes={[{ valor: 'cartoes', rotulo: 'Cartões' }, { valor: 'contas', rotulo: 'Contas' }, { valor: 'caixinhas', rotulo: 'Caixinhas' }]}
        />
      </div>

      {aba === 'cartoes' && (
        <>
          {snap.cartoes.length === 0 && vales.length === 0 && (
            <div className="grupo"><Vazio icone={<Wallet />} titulo="Nenhum cartão ainda" texto="Adicione o cartão de crédito ou o cartão de vale." /></div>
          )}
          {snap.cartoes.length > 0 && (
            <div className="pilha" aria-label="Cartões de crédito">
              {snap.cartoes.map((c) => {
                const f = faturaEmFoco(c);
                return (
                  <CartaoVisual
                    key={c.id}
                    nome={c.nome}
                    cor={c.cor ?? '#334155'}
                    tipo={c.padrao ? 'Crédito, padrão' : 'Crédito'}
                    final={c.final}
                    bandeira={c.bandeira}
                    rotuloValor={f ? `${f.status === 'fechada' ? 'Fechada' : 'Fatura'} de ${nomeMes(f.competencia)}` : 'Fatura'}
                    valor={f?.valor_fatura ?? 0}
                    rodapeDireita={f ? <span className="cartao-final" style={{ letterSpacing: 0 }}>vence {dataCurta(f.vencimento)}</span> : undefined}
                    aoClicar={() => ir(`/carteira/cartao/${c.id}`)}
                    rotuloAcessivel={`${c.nome}, fatura de ${nomeMes(f?.competencia ?? snap.mes)}: ${reaisCompacto(f?.valor_fatura ?? 0)}`}
                  />
                );
              })}
            </div>
          )}

          {vales.length > 0 && (
            <section className="secao" aria-label="Cartões de benefício">
              <div className="secao-cab"><h2>Benefícios</h2></div>
              <div className="pilha">
                {vales.map((v) => (
                  <CartaoVisual
                    key={v.id}
                    nome={v.nome}
                    cor={corPadraoConta(v)}
                    tipo={v.instituicao ? `Benefício, ${v.instituicao}` : 'Benefício'}
                    final={v.final}
                    bandeira={v.bandeira}
                    rotuloValor="Saldo"
                    valor={v.saldo ?? 0}
                    aoClicar={() => ir(`/carteira/conta/${v.id}`)}
                    rotuloAcessivel={`${v.nome}, saldo ${reaisCompacto(v.saldo ?? 0)}`}
                  />
                ))}
              </div>
            </section>
          )}

          <div className="acoes" style={{ marginTop: 22 }}>
            <button type="button" className="btn sec" onClick={() => abrir('Novo cartão de crédito', (f) => <FormCartao fechar={f} />)}>
              <Plus aria-hidden="true" /> Cartão de crédito
            </button>
            <button type="button" className="btn sec" onClick={() => abrir('Novo cartão de benefício', (f) => <FormConta fechar={f} tipoInicial="beneficio" />)}>
              <Plus aria-hidden="true" /> Vale
            </button>
          </div>
        </>
      )}

      {aba === 'contas' && (
        <>
          <div className="total-caixa" style={{ marginBottom: 14 }}>
            <div className="rot">Total em conta</div>
            <div className="saldo-grande"><Dinheiro valor={totalContas} /></div>
          </div>
          <div className="grupo">
            {contas.map((c) => (
              <button type="button" className="linha" key={c.id} onClick={() => ir(`/carteira/conta/${c.id}`)}>
                <span className="selo" style={{ background: corPadraoConta(c) }} aria-hidden="true">{iniciais(c.nome)}</span>
                <span className="linha-texto">
                  <span className="linha-titulo" style={{ display: 'block' }}>{c.nome}</span>
                  <span className="linha-sub" style={{ display: 'block' }}>{NOME_TIPO_CONTA[c.tipo]}{c.padrao ? ', padrão' : ''}</span>
                </span>
                <span className="linha-valor">
                  {c.saldo === null ? <span className="nota">sem saldo</span> : <Dinheiro valor={c.saldo} />}
                  {c.ultimo_ajuste && <small>conferido {quandoRelativo(c.ultimo_ajuste.data, snap.hoje)}</small>}
                </span>
              </button>
            ))}
            {contas.length === 0 && <Vazio icone={<Landmark />} titulo="Nenhuma conta" />}
          </div>
          <div className="acoes" style={{ marginTop: 16 }}>
            <button type="button" className="btn sec" onClick={() => abrir('Nova conta', (f) => <FormConta fechar={f} />)}><Plus aria-hidden="true" /> Conta</button>
            {contas.length > 1 && (
              <button type="button" className="btn sec" onClick={() => abrir('Transferir entre contas', (f) => <FormTransferencia fechar={f} />)}><ArrowLeftRight aria-hidden="true" /> Transferir</button>
            )}
          </div>
        </>
      )}

      {aba === 'caixinhas' && (
        <>
          <div className="total-caixa" style={{ marginBottom: 14 }}>
            <div className="rot">Total guardado</div>
            <div className="saldo-grande"><Dinheiro valor={totalCaixinhas} /></div>
          </div>
          <div className="grupo">
            {snap.caixinhas.map((c) => (
              <button type="button" className="linha" key={c.id} onClick={() => abrir(c.nome, (f) => <AcoesCaixinha c={c} fechar={f} />)} style={{ alignItems: 'start' }}>
                <span className="selo" style={{ background: c.cor ?? '#0E7490' }} aria-hidden="true"><PiggyBank size={20} /></span>
                <span className="linha-texto" style={{ display: 'grid', gap: 6 }}>
                  <span>
                    <span className="linha-titulo" style={{ display: 'block' }}>{c.nome}</span>
                    <span className="linha-sub" style={{ display: 'block' }}>
                      {c.meta ? `${Math.round(c.pct_meta ?? 0)}% da meta de ${reaisCompacto(c.meta)}` : c.rendimento}
                      {c.rendimento_mes ? `, rendeu ${reaisCompacto(c.rendimento_mes)} no mês` : ''}
                    </span>
                  </span>
                  {c.meta ? <Medidor pct={c.pct_meta ?? 0} rotulo={`${c.nome}: ${Math.round(c.pct_meta ?? 0)}% da meta`} /> : null}
                </span>
                <span className="linha-valor"><Dinheiro valor={c.saldo} /></span>
              </button>
            ))}
            {snap.caixinhas.length === 0 && <Vazio icone={<PiggyBank />} titulo="Nenhuma caixinha" texto="Crie uma para acompanhar o que você guarda." />}
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn sec cheio" onClick={() => abrir('Nova caixinha', (f) => <FormCaixinha fechar={f} />)}><Plus aria-hidden="true" /> Caixinha</button>
          </div>
        </>
      )}
    </>
  );
}
