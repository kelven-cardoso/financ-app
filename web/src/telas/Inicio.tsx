import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, CloudOff, Lock, RefreshCw } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { ir, useFolhas } from '../lib/navegacao';
import { beneficios, corPadraoConta, faturaDoMes, faturaEmFoco, gastosPorCategoria, painelDoMes, proximosVencimentos } from '../lib/financas';
import { dataCurta, nomeMes, primeiraMaiuscula, quandoRelativo, reaisCompacto, somarMeses } from '../lib/formato';
import type { PainelMes, Snapshot } from '../lib/tipos';
import { Dinheiro, Medidor, Vazio } from '../ui/base';
import { CartaoVisual } from '../ui/CartaoVisual';
import { LinhaLancamento } from '../ui/Lancamentos';
import { Evolucao } from '../ui/Evolucao';
import { FolhaPrevisto } from '../formularios/Previsto';
import { FormSaldo } from '../formularios/Contas';

type LinhaEq = { op: '' | '−' | '+'; rotulo: string; nota?: string; valor: number; itens?: { descricao: string; valor: number; nota?: string }[] };

function montarEquacao(snap: Snapshot, p: PainelMes): { linhas: LinhaEq[]; total: number | null; rotuloTotal: string } {
  const mesNome = nomeMes(p.mes);
  if (p.status === 'projetado') {
    const anterior = painelDoMes(snap, somarMeses(p.mes, -1));
    return {
      linhas: [
        { op: '', rotulo: `Sobra de ${nomeMes(somarMeses(p.mes, -1))}`, valor: anterior?.saldo_livre ?? 0 },
        {
          op: '+', rotulo: 'Entradas previstas', valor: p.total_entradas,
          itens: [...p.entradas_itens, ...p.fixas_previstas_itens.filter((i) => i.tipo === 'entrada')].map((i) => ({ descricao: i.descricao, valor: i.valor })),
        },
        {
          op: '−', rotulo: 'Despesas previstas', valor: p.total_despesas,
          nota: 'faturas, contas fixas e parcelas',
          itens: [
            ...p.faturas.filter((f) => Number(f.valor) > 0).map((f) => ({ descricao: `Fatura ${f.cartao}`, valor: Number(f.valor) })),
            ...p.fixas_previstas_itens.filter((i) => i.tipo !== 'entrada').map((i) => ({ descricao: i.descricao, valor: i.valor, nota: `dia ${i.dia}` })),
          ],
        },
      ],
      total: p.saldo_livre,
      rotuloTotal: `Fecho ${mesNome} com`,
    };
  }
  if (p.status === 'realizado') {
    return {
      linhas: [
        { op: '', rotulo: `Em conta em ${dataCurta(p.data_ref)}`, valor: p.saldo_em_conta ?? 0 },
        { op: '−', rotulo: 'Faturas que ficaram abertas', valor: p.a_pagar },
      ],
      total: p.saldo_livre,
      rotuloTotal: `Sobra de ${mesNome}`,
    };
  }
  // mês em andamento
  const faturasAbertas: { descricao: string; valor: number; nota?: string }[] = [];
  for (const c of snap.cartoes) {
    for (const f of c.faturas) {
      if (f.competencia <= p.mes && f.competencia >= somarMeses(p.mes, -6) && !f.paga && Math.abs(f.valor_fatura) > 0.004) {
        faturasAbertas.push({ descricao: `${c.nome}, ${nomeMes(f.competencia)}`, valor: f.valor_fatura, nota: `vence ${dataCurta(f.vencimento)}` });
      }
    }
  }
  const totalFaturas = Math.max(0, p.a_pagar - p.fixas_previstas - p.saidas_futuras);
  const linhas: LinhaEq[] = [
    { op: '', rotulo: 'Em conta hoje', valor: p.saldo_em_conta ?? 0, itens: p.saldo_contas.filter((c) => c.tipo !== 'beneficio').map((c) => ({ descricao: c.nome, valor: c.saldo ?? 0 })) },
    { op: '−', rotulo: 'Faturas a pagar', valor: totalFaturas, itens: faturasAbertas },
    {
      op: '−', rotulo: 'Contas fixas a vencer', valor: p.fixas_previstas,
      itens: p.fixas_previstas_itens.filter((i) => i.tipo !== 'entrada').map((i) => ({ descricao: i.descricao, valor: i.valor, nota: `dia ${i.dia}` })),
    },
  ];
  if (p.saidas_futuras > 0.004) {
    linhas.push({ op: '−', rotulo: 'Lançado para depois', valor: p.saidas_futuras, itens: p.saidas_futuras_itens.map((i) => ({ descricao: i.descricao, valor: i.valor, nota: i.data ? dataCurta(i.data) : undefined })) });
  }
  linhas.push({
    op: '+', rotulo: 'A receber', valor: p.a_receber,
    itens: [
      ...p.fixas_previstas_itens.filter((i) => i.tipo === 'entrada').map((i) => ({ descricao: i.descricao, valor: i.valor, nota: `dia ${i.dia}` })),
      ...p.entradas_futuras_itens.map((i) => ({ descricao: i.descricao, valor: i.valor, nota: i.data ? dataCurta(i.data) : undefined })),
    ],
  });
  return { linhas, total: p.saldo_livre, rotuloTotal: `Fecho ${mesNome} com` };
}

function Equacao({ snap, p }: { snap: Snapshot; p: PainelMes }) {
  const [aberta, setAberta] = useState<number | null>(null);
  const { abrir } = useFolhas();
  const { linhas, total, rotuloTotal } = montarEquacao(snap, p);
  const semSaldo = p.status === 'em_andamento' && !p.saldo_informado;
  const contaSemSaldo = snap.contas.find((c) => c.tipo !== 'beneficio' && c.saldo === null);
  return (
    <section className="equacao" aria-label="Como fecho o mês">
      <p className="equacao-titulo">
        {p.status === 'em_andamento' ? 'Como fecho o mês' : p.status === 'realizado' ? 'Como terminou o mês' : 'Projeção do mês'}
      </p>
      {semSaldo && contaSemSaldo && (
        <div className="eq-aviso">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Falta o saldo de {contaSemSaldo.nome}.{' '}
            <button type="button" onClick={() => abrir(`Saldo de ${contaSemSaldo.nome}`, (f) => <FormSaldo conta={contaSemSaldo} fechar={f} />)}>Informar agora</button>
          </span>
        </div>
      )}
      {linhas.map((l, i) => {
        const temItens = (l.itens?.length ?? 0) > 0;
        const Comp = temItens ? 'button' : 'div';
        return (
          <div key={l.rotulo}>
            <Comp
              {...(temItens ? { type: 'button' as const, onClick: () => setAberta(aberta === i ? null : i), 'aria-expanded': aberta === i } : {})}
              className="eq-linha"
            >
              <span className="eq-op" aria-hidden="true">{l.op}</span>
              <span className="eq-rotulo">
                {l.rotulo}
                {temItens && <ChevronDown size={15} className="eq-seta" aria-hidden="true" />}
                {l.nota && <small>{l.nota}</small>}
              </span>
              <span className="eq-valor num"><Dinheiro valor={l.valor} /></span>
            </Comp>
            {aberta === i && temItens && (
              <div className="eq-linha" style={{ paddingTop: 0 }}>
                <span />
                <div className="eq-itens" style={{ gridColumn: '2 / 4' }}>
                  {l.itens!.map((it, k) => (
                    <div className="eq-item" key={k}>
                      <span>{it.descricao}{it.nota ? <span style={{ color: 'var(--ink-3)' }}>, {it.nota}</span> : null}</span>
                      <span className="num"><Dinheiro valor={it.valor} /></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="eq-total">
        <span className="eq-op" aria-hidden="true">=</span>
        <span className="eq-rotulo">{rotuloTotal}</span>
        <span className={`eq-valor ${total !== null && total < 0 ? 'negativo' : ''}`}>
          <Dinheiro valor={total} className={total !== null && total < 0 ? 'negativo' : ''} />
        </span>
      </div>
    </section>
  );
}

function GastosCategoria({ snap, mes }: { snap: Snapshot; mes: string }) {
  const lista = gastosPorCategoria(snap, mes);
  if (!lista.length) return <div className="grupo"><Vazio titulo="Nenhum gasto neste mês" /></div>;
  const top = lista.slice(0, 6);
  const resto = lista.slice(6).reduce((s, x) => s + x.valor, 0);
  if (resto > 0) top.push({ categoria: 'Demais categorias', valor: resto, n: 0 });
  const max = Math.max(...top.map((x) => x.valor));
  return (
    <div className="grupo">
      <div className="barras">
        {top.map((x) => (
          <div className="barra-linha" key={x.categoria}>
            <span className="barra-rot">{x.categoria}</span>
            <span className="barra-trilho">
              <span className="barra" style={{ width: `calc((100% - 92px) * ${x.valor / max})` }} />
              <span className="barra-val">{reaisCompacto(x.valor)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Inicio() {
  const { snap, online, sincronizando, sincronizar, fila, erroSync, perfil, bloquearAgora } = useFinanc();
  const { abrir } = useFolhas();
  const [mes, setMes] = useState<string | null>(null);
  const atual = mes ?? snap?.mes ?? '';
  const painel = useMemo(() => (snap ? painelDoMes(snap, atual) : undefined), [snap, atual]);
  const minMes = snap?.painel[0]?.mes ?? atual;
  const maxMes = snap?.painel[snap.painel.length - 1]?.mes ?? atual;

  if (!snap) {
    return <Vazio titulo="Carregando seus dados" texto={erroSync ?? undefined} />;
  }

  const venc = proximosVencimentos(snap, 12).slice(0, 6);
  const ultimos = snap.lancamentos.filter((l) => l.data <= snap.hoje).slice(0, 5);
  const cartoes = snap.cartoes;
  const vales = beneficios(snap);
  const pendentes = fila.filter((o) => !o.erro).length;

  return (
    <>
      <header className="topo">
        <h1>{primeiraMaiuscula(nomeMes(atual))}{atual.slice(0, 4) !== snap.hoje.slice(0, 4) ? ` de ${atual.slice(0, 4)}` : ''}</h1>
        <div className="topo-acoes">
          <button type="button" className="icone-btn" aria-label="Mês anterior" disabled={atual <= minMes} onClick={() => setMes(somarMeses(atual, -1))}>
            <ChevronLeft size={20} />
          </button>
          <button type="button" className="icone-btn" aria-label="Próximo mês" disabled={atual >= maxMes} onClick={() => setMes(somarMeses(atual, 1))}>
            <ChevronRight size={20} />
          </button>
          <button type="button" className="icone-btn" aria-label="Atualizar" onClick={() => sincronizar()}>
            {online ? <RefreshCw size={19} className={sincronizando ? 'girando' : ''} /> : <CloudOff size={19} />}
          </button>
          {perfil?.bloqueio_min ? (
            <button type="button" className="icone-btn" aria-label="Bloquear agora" onClick={bloquearAgora}><Lock size={19} /></button>
          ) : null}
        </div>
      </header>

      {(!online || pendentes > 0) && (
        <div className="faixa alerta" role="status">
          <CloudOff aria-hidden="true" />
          <span>
            {!online ? 'Sem conexão: dados salvos neste aparelho.' : ''}
            {pendentes > 0 ? ` ${pendentes} ${pendentes === 1 ? 'lançamento aguarda' : 'lançamentos aguardam'} envio; os totais mudam quando sincronizar.` : ''}
          </span>
        </div>
      )}

      <div className="grade-2">
        <div className="col">
          {painel ? <Equacao snap={snap} p={painel} /> : <div className="grupo"><Vazio titulo="Sem dados para este mês" /></div>}

          {(cartoes.length > 0 || vales.length > 0) && (
            <section className="secao" aria-label="Cartões">
              <div className="secao-cab">
                <h2>Cartões</h2>
                <button type="button" className="link" onClick={() => ir('/carteira')}>Carteira</button>
              </div>
              <div className="trilha-cartoes">
                {cartoes.map((c) => {
                  // no mês atual mostra a fatura em foco; ao navegar, a fatura daquele mês
                  const f = atual === snap.mes ? faturaEmFoco(c) : faturaDoMes(c, atual);
                  const fechada = f?.status === 'fechada';
                  return (
                    <div key={c.id}>
                      <CartaoVisual
                        nome={c.nome}
                        cor={c.cor ?? '#334155'}
                        tipo="Crédito"
                        final={c.final}
                        bandeira={c.bandeira}
                        rotuloValor={`Fatura de ${nomeMes(f?.competencia ?? atual)}`}
                        valor={f?.valor_fatura ?? 0}
                        aoClicar={() => ir(`/carteira/cartao/${c.id}${f ? `?mes=${f.competencia}` : ''}`)}
                        rotuloAcessivel={`${c.nome}: fatura de ${nomeMes(f?.competencia ?? atual)}, ${reaisCompacto(f?.valor_fatura ?? 0)}`}
                      />
                      <div className="cartao-legenda">
                        <span>{f ? (f.paga ? `Paga` : `${fechada ? 'Fechada, vence' : 'Vence'} ${quandoRelativo(f.vencimento, snap.hoje)}`) : 'Sem fatura neste mês'}</span>
                        <span>{f && c.limite ? ((f.limite_disponivel ?? 0) < 0 ? `Acima do limite ${reaisCompacto(-(f.limite_disponivel ?? 0))}` : `Disponível ${reaisCompacto(f.limite_disponivel ?? 0)}`) : ''}</span>
                      </div>
                    </div>
                  );
                })}
                {vales.map((v) => (
                  <div key={v.id}>
                    <CartaoVisual
                      nome={v.nome}
                      cor={corPadraoConta(v)}
                      tipo="Benefício"
                      final={v.final}
                      bandeira={v.bandeira}
                      rotuloValor="Saldo"
                      valor={v.saldo ?? 0}
                      aoClicar={() => ir(`/carteira/conta/${v.id}`)}
                      rotuloAcessivel={`${v.nome}: saldo ${reaisCompacto(v.saldo ?? 0)}`}
                    />
                    <div className="cartao-legenda"><span>{v.instituicao ?? 'Vale'}</span><span /></div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="secao" aria-label="Evolução mensal">
            <div className="secao-cab">
              <h2>Evolução mensal</h2>
              <span className="nota">receitas, despesas e saldo</span>
            </div>
            <Evolucao snap={snap} selecionado={atual} aoEscolher={(m) => {
              setMes(m);
              if (window.innerWidth < 960) window.scrollTo({ top: 0, behavior: 'smooth' });
            }} />
          </section>
        </div>

        <div className="col">
          <section className="secao" aria-label="Próximos dias">
            <div className="secao-cab"><h2>Próximos dias</h2></div>
            <div className="grupo">
              {venc.length === 0 && <Vazio icone={<CalendarClock />} titulo="Nada vencendo nos próximos dias" />}
              {venc.map((v, i) => (
                <button
                  type="button"
                  className="linha"
                  key={i}
                  onClick={() => {
                    if (v.tipo === 'fatura' && v.ref) ir(`/carteira/cartao/${v.ref}`);
                    else if ((v.tipo === 'fixa' || v.tipo === 'receita') && v.ref && v.mes) abrir(v.titulo, (f) => <FolhaPrevisto fechar={f} recorrenteId={v.ref!} mes={v.mes!} />);
                    else ir('/extrato');
                  }}
                >
                  <span className="linha-icone num" style={{ fontSize: 13, fontWeight: 700, flexDirection: 'column', lineHeight: 1 }}>
                    {v.data.slice(8, 10)}
                  </span>
                  <span className="linha-texto">
                    <span className="linha-titulo" style={{ display: 'block' }}>{v.titulo}</span>
                    <span className="linha-sub" style={{ display: 'block' }}>
                      {v.atrasado ? 'Atrasada' : primeiraMaiuscula(quandoRelativo(v.data, snap.hoje))}{v.tipo === 'fatura' ? ', fatura' : v.tipo === 'receita' ? ', a receber' : v.tipo === 'agendado' ? ', agendado' : ', conta fixa'}
                    </span>
                  </span>
                  <span className="linha-valor"><Dinheiro valor={v.valor} tipo={v.tipo === 'receita' ? 'entrada' : 'saida'} sinal={v.tipo === 'receita'} /></span>
                </button>
              ))}
            </div>
          </section>

          {snap.orcamentos.length > 0 && atual === snap.mes && (
            <section className="secao" aria-label="Orçamentos">
              <div className="secao-cab">
                <h2>Orçamentos</h2>
                <button type="button" className="link" onClick={() => ir('/ajustes/orcamentos')}>Ajustar</button>
              </div>
              <div className="grupo">
                {snap.orcamentos.map((o) => {
                  const pct = o.pct ?? 0;
                  return (
                    <div className="orc" key={o.categoria}>
                      <div className="orc-topo">
                        <span className="orc-nome">{o.categoria}</span>
                        <span className="num"><Dinheiro valor={o.gasto} /> <span className="nota">de {reaisCompacto(o.orcamento)}</span></span>
                      </div>
                      <Medidor pct={pct} rotulo={`${o.categoria}: ${pct}% usado`} />
                      <div className="orc-pe">
                        <span>{o.categorias.length > 1 ? o.categorias.join(', ') : ''}</span>
                        <span className={`status ${pct >= 100 ? 'estourou' : pct >= 80 ? 'alerta' : ''}`}>
                          {pct >= 100 ? <><AlertTriangle size={13} aria-hidden="true" /> passou {reaisCompacto(-o.restante)}</> : `${pct}% usado`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="secao" aria-label="Gastos por categoria">
            <div className="secao-cab"><h2>Gastos por categoria</h2><span className="nota">{nomeMes(atual)}, pela data da compra</span></div>
            <GastosCategoria snap={snap} mes={atual} />
          </section>

          <section className="secao" aria-label="Últimos lançamentos">
            <div className="secao-cab">
              <h2>Últimos lançamentos</h2>
              <button type="button" className="link" onClick={() => ir('/extrato')}>Extrato</button>
            </div>
            <div className="grupo">
              {ultimos.length === 0 && <Vazio titulo="Nenhum lançamento ainda" texto="Use o botão + para registrar o primeiro." />}
              {ultimos.map((l) => <LinhaLancamento key={l.id} l={l} snap={snap} mostrarData />)}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
