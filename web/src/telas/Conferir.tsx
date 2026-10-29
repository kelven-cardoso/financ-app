import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRightLeft, CheckCircle2, CircleAlert, EyeOff, FileUp, Info, RotateCcw, Unlink } from 'lucide-react';
import { api, enviarArquivo, ErroApi } from '../lib/api';
import { useFinanc } from '../lib/estado';
import { categoriasFrequentes } from '../lib/financas';
import { dataCurta, ddmm, nomeMes, primeiraMaiuscula, reais } from '../lib/formato';
import { voltar } from '../lib/navegacao';
import type { Conciliacao, EstadoItemBanco, ItemBanco, Snapshot } from '../lib/tipos';
import { Dinheiro, useTorrada, Vazio } from '../ui/base';
import { LinhaLancamento } from '../ui/Lancamentos';

type Aba = 'faltando' | 'diferente' | 'so_app' | 'conferido' | 'ignorado';
type Resposta = { ok: true; conciliacao: Conciliacao | null; snapshot?: Snapshot };

function mesDaUrl(): string | null {
  const m = new URLSearchParams(location.search).get('mes');
  return m && /^\d{4}-\d{2}$/.test(m) ? m : null;
}

export function Conferir({ cartaoId }: { cartaoId: number }) {
  const { snap, online, aplicarSnapshot } = useFinanc();
  const torrada = useTorrada();
  const cartao = snap?.cartoes.find((c) => c.id === cartaoId);
  const ultimaImport = snap?.importacoes?.find((i) => i.cartao_id === cartaoId)?.competencia ?? null;
  const [mes, setMes] = useState<string | null>(() => mesDaUrl() ?? ultimaImport);
  const [conc, setConc] = useState<Conciliacao | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('faltando');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cats, setCats] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const receber = useCallback(async (r: Resposta, abaPadrao = true) => {
    setConc(r.conciliacao);
    if (r.snapshot) await aplicarSnapshot(r.snapshot);
    if (r.conciliacao) {
      setMes(r.conciliacao.importacao.competencia);
      const faltando = r.conciliacao.itens.filter((i) => i.estado === 'faltando').map((i) => i.id);
      setSel(new Set(faltando));
      if (abaPadrao) {
        const c = r.conciliacao.contagem;
        setAba(c.faltando ? 'faltando' : c.diferente ? 'diferente' : r.conciliacao.so_no_app.length ? 'so_app' : 'conferido');
      }
    }
  }, [aplicarSnapshot]);

  const carregar = useCallback(async () => {
    if (!mes) { setConc(null); return; }
    setErro(null);
    try {
      await receber(await api<Resposta>('GET', `/api/faturas/conciliacao?cartao_id=${cartaoId}&mes=${mes}`));
    } catch (e) {
      setErro(e instanceof ErroApi && e.semRede ? 'A conferência precisa de internet.' : (e as Error).message);
      setConc(null);
    }
  }, [cartaoId, mes, receber]);

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cartaoId]);

  const enviarPdf = async (f: File) => {
    if (f.type && f.type !== 'application/pdf') { torrada('Escolha o arquivo PDF da fatura.'); return; }
    setOcupado(true);
    setErro(null);
    try {
      const nome = encodeURIComponent(f.name.slice(0, 100));
      const r = await enviarArquivo<Resposta>(`/api/faturas/importar?cartao_id=${cartaoId}&nome=${nome}`, f, 'application/pdf');
      await receber(r);
      const c = r.conciliacao;
      if (c && c.importacao.cartao_id !== cartaoId) torrada(`Essa fatura é do cartão ${c.importacao.cartao}.`);
      else torrada('Fatura lida.');
    } catch (e) {
      setErro(e instanceof ErroApi && e.semRede ? 'Sem conexão: tente de novo com internet.' : (e as Error).message);
    } finally {
      setOcupado(false);
      if (arquivo.current) arquivo.current.value = '';
    }
  };

  const acao = async (acao: string, itens: number[], msg?: string) => {
    if (!conc) return;
    setOcupado(true);
    try {
      const categorias = Object.fromEntries(itens.filter((id) => cats[id]).map((id) => [String(id), cats[id]]));
      const r = await api<Resposta>('POST', '/api/faturas/conciliacao', { importacao_id: conc.importacao.id, acao, itens, categorias });
      await receber(r, false);
      const c = r.conciliacao;
      if (c?.erros?.length) torrada(`${c.erros.length} não ${c.erros.length === 1 ? 'pôde' : 'puderam'} ser lançados.`, true);
      else if (msg) torrada(msg);
    } catch (e) {
      torrada(e instanceof ErroApi && e.semRede ? 'Sem conexão.' : (e as Error).message, true);
    } finally {
      setOcupado(false);
    }
  };

  const categorias = useMemo(() => {
    if (!snap) return [];
    const base = categoriasFrequentes(snap, 'saida', 80);
    const sug = conc?.itens.map((i) => i.categoria) ?? [];
    return [...new Set([...base, ...sug, 'Outros'])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [snap, conc]);

  if (!snap) return null;

  const porEstado = (e: EstadoItemBanco[]) => conc?.itens.filter((i) => e.includes(i.estado)) ?? [];
  const faltando = porEstado(['faltando']);
  const diferentes = porEstado(['diferente']);
  const conferidos = porEstado(['conferido', 'lancado']);
  const ignorados = porEstado(['ignorado']);
  const soApp = conc ? snap.lancamentos.filter((l) => conc.so_no_app.some((s) => s.id === l.id)) : [];
  const outroMes = conferidos.filter((i) => i.lancamento?.outro_mes);
  const selecionados = faltando.filter((i) => sel.has(i.id));
  const totalSel = selecionados.reduce((s, i) => s + (i.tipo === 'estorno' ? -i.valor : i.valor), 0);
  const imp = conc?.importacao;

  const seletorArquivo = (
    <input ref={arquivo} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarPdf(f); }} />
  );

  return (
    <>
      <header className="topo">
        <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar(`/carteira/cartao/${cartaoId}`)}><ArrowLeft size={20} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>Conferir fatura</h1>
          <div className="sub">{cartao?.nome ?? 'Cartão'}{mes ? `, ${nomeMes(mes, true)}` : ''}</div>
        </div>
        <button type="button" className="icone-btn" aria-label="Enviar PDF da fatura" disabled={ocupado || !online} onClick={() => arquivo.current?.click()}>
          <FileUp size={19} />
        </button>
        {seletorArquivo}
      </header>

      {erro && <div className="faixa alerta" role="alert"><CircleAlert aria-hidden="true" /><span>{erro}</span></div>}

      {conc === undefined && !erro && <div className="grupo"><Vazio titulo="Carregando a conferência" /></div>}

      {conc === null && (
        <div className="grupo">
          <Vazio
            icone={<FileUp />}
            titulo={mes ? `Ainda não li a fatura de ${nomeMes(mes)} do banco` : 'Nenhuma fatura do banco lida ainda'}
            texto="Quando a fatura fecha, o PDF que chega no e-mail é lido sozinho. Você também pode enviar o PDF aqui: eu comparo item a item com o que está no app, sem duplicar."
            acao={<button type="button" className="btn" disabled={ocupado || !online} onClick={() => arquivo.current?.click()}><FileUp aria-hidden="true" /> {ocupado ? 'Lendo o PDF…' : 'Enviar PDF da fatura'}</button>}
          />
        </div>
      )}

      {conc && imp && (
        <>
          <section className="grupo conc-resumo" aria-label="Resumo da conferência">
            <div className="conc-nums">
              <div><span className="nota">Banco</span><strong><Dinheiro valor={imp.total ?? conc.totais.banco_itens} /></strong></div>
              <div><span className="nota">No app</span><strong><Dinheiro valor={conc.totais.app_lancado + (imp.saldo_financiado || 0)} /></strong></div>
              <div><span className="nota">Diferença</span><strong className={Math.abs(conc.totais.diferenca) < 0.01 ? 'positivo' : ''}><Dinheiro valor={conc.totais.diferenca} /></strong></div>
            </div>
            <p className="nota conc-meta">
              {imp.periodo_ini && imp.fechamento ? `Compras de ${dataCurta(imp.periodo_ini)} a ${dataCurta(imp.fechamento)}, ` : ''}
              {imp.vencimento ? `vence ${dataCurta(imp.vencimento)}. ` : ''}
              {imp.origem === 'email' ? 'Lida do e-mail' : 'PDF enviado pelo app'} em {dataCurta(imp.atualizado_em.slice(0, 10))}.
            </p>
            {imp.saldo_financiado > 0 && (
              <p className="nota conc-meta"><Info size={14} aria-hidden="true" /> O total inclui {reais(imp.saldo_financiado)} de saldo da fatura anterior que ficou no rotativo (não é compra nova).</p>
            )}
            {imp.checagem && !imp.checagem.ok && (
              <p className="nota conc-meta" style={{ color: 'var(--warn)' }}><CircleAlert size={14} aria-hidden="true" /> A soma dos itens lidos difere do total do PDF em {reais(imp.checagem.diferenca)}. Confira se algo ficou de fora.</p>
            )}
          </section>

          <div className="chips rolagem conc-abas" role="group" aria-label="Filtrar itens">
            {([
              ['faltando', `Faltam ${faltando.length}`],
              ['diferente', `Valor diferente ${diferentes.length}`],
              ['so_app', `Só no app ${soApp.length}`],
              ['conferido', `Conferidos ${conferidos.length}`],
              ['ignorado', `Ignorados ${ignorados.length}`],
            ] as [Aba, string][]).filter(([a]) => a === 'faltando' || a === 'conferido' || (a === 'diferente' ? diferentes.length : a === 'so_app' ? soApp.length : ignorados.length) > 0)
              .map(([a, r]) => <button key={a} type="button" className="chip" aria-pressed={aba === a} onClick={() => setAba(a)}>{r}</button>)}
          </div>

          {aba === 'faltando' && (
            faltando.length === 0 ? (
              <div className="grupo"><Vazio icone={<CheckCircle2 />} titulo="Nada faltando" texto="Tudo o que está no PDF do banco já está no app." /></div>
            ) : (
              <>
                <div className="secao-cab">
                  <span className="nota">No banco, mas não no app. Escolha o que lançar; a categoria dá para trocar em cada item.</span>
                  <button type="button" className="link" onClick={() => setSel(sel.size === faltando.length ? new Set() : new Set(faltando.map((i) => i.id)))}>
                    {sel.size === faltando.length ? 'Nenhum' : 'Todos'}
                  </button>
                </div>
                <div className="grupo">
                  {faltando.map((i) => (
                    <ItemFaltando key={i.id} item={i} marcado={sel.has(i.id)} categoria={cats[i.id] ?? i.categoria} categorias={categorias}
                      aoMarcar={(v) => setSel((s) => { const n = new Set(s); if (v) n.add(i.id); else n.delete(i.id); return n; })}
                      aoCategoria={(c) => setCats((x) => ({ ...x, [i.id]: c }))} />
                  ))}
                </div>
                <div className="conc-barra">
                  <button type="button" className="btn sec" disabled={ocupado || !selecionados.length} onClick={() => acao('ignorar', selecionados.map((i) => i.id), 'Itens ignorados.')}>
                    <EyeOff aria-hidden="true" /> Ignorar
                  </button>
                  <button type="button" className="btn" disabled={ocupado || !selecionados.length} onClick={() => acao('lancar', selecionados.map((i) => i.id), `${selecionados.length} ${selecionados.length === 1 ? 'lançado' : 'lançados'}.`)}>
                    {ocupado ? 'Lançando…' : `Lançar ${selecionados.length} · ${reais(totalSel)}`}
                  </button>
                </div>
              </>
            )
          )}

          {aba === 'diferente' && (
            <>
              <p className="nota" style={{ margin: '0 2px 10px' }}>Parecem o mesmo gasto, mas com valor diferente no app. Escolha qual vale.</p>
              <div className="grupo">
                {diferentes.map((i) => (
                  <div key={i.id} className="conc-dif">
                    <div className="linha sem-icone" style={{ padding: 0 }}>
                      <span className="linha-texto">
                        <span className="linha-titulo" style={{ display: 'block' }}>{i.descricao_limpa}</span>
                        <span className="linha-sub" style={{ display: 'block' }}>Banco {ddmm(i.data)}: {reais(i.valor)} · App {ddmm(i.lancamento?.data)}: {i.lancamento?.descricao} {reais(i.lancamento?.valor)}</span>
                      </span>
                      <span className="linha-valor"><Dinheiro valor={i.valor} /></span>
                    </div>
                    <div className="acoes">
                      <button type="button" className="btn peq" disabled={ocupado} onClick={() => acao('usar_valor_banco', [i.id], 'Valor corrigido.')}>Usar {reais(i.valor)}</button>
                      <button type="button" className="btn sec peq" disabled={ocupado} onClick={() => acao('vincular', [i.id], 'Mantido o valor do app.')}>Manter {reais(i.lancamento?.valor)}</button>
                      <button type="button" className="btn sec peq" disabled={ocupado} onClick={() => acao('nao_e_o_mesmo', [i.id])}>Não é o mesmo</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {aba === 'so_app' && (
            <>
              <p className="nota" style={{ margin: '0 2px 10px' }}>Estão no app nesta fatura, mas não aparecem no PDF do banco: pode ser um gasto lançado no cartão errado, um valor agrupado ou algo que ficou para a próxima fatura. Toque para editar ou apagar.</p>
              <div className="grupo">
                {soApp.map((l) => <LinhaLancamento key={l.id} l={l} snap={snap} mostrarData />)}
              </div>
            </>
          )}

          {aba === 'conferido' && (
            <>
              {outroMes.length > 0 && (
                <div className="faixa">
                  <ArrowRightLeft aria-hidden="true" />
                  <span>{outroMes.length} {outroMes.length === 1 ? 'estava' : 'estavam'} no app em outra fatura.</span>
                  <button type="button" className="btn peq" disabled={ocupado} onClick={() => acao('lancar', outroMes.map((i) => i.id), 'Movidos para esta fatura.')}>Trazer para cá</button>
                </div>
              )}
              {conferidos.length === 0 ? (
                <div className="grupo"><Vazio titulo="Nenhum item conferido ainda" /></div>
              ) : (
                <div className="grupo">
                  {conferidos.map((i) => (
                    <div key={i.id} className="linha sem-icone">
                      <span className="linha-texto">
                        <span className="linha-titulo" style={{ display: 'block' }}>{i.descricao_limpa}{i.parcela ? <span className="tag-parcela">{i.parcela}</span> : null}</span>
                        <span className="linha-sub" style={{ display: 'block' }}>
                          {ddmm(i.data)} · {i.estado === 'lancado' ? 'lançado pela conferência' : `no app: ${i.lancamento?.descricao}`}
                          {i.lancamento?.outro_mes ? ` (fatura de ${nomeMes(i.lancamento.competencia)})` : ''}
                        </span>
                      </span>
                      <span className="linha-valor">
                        <Dinheiro valor={i.valor} />
                        {i.estado === 'conferido' && (
                          <button type="button" className="icone-btn" style={{ width: 32, height: 32 }} aria-label={`Não é o mesmo gasto: ${i.descricao_limpa}`} disabled={ocupado} onClick={() => acao('nao_e_o_mesmo', [i.id])}>
                            <Unlink size={15} />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {aba === 'ignorado' && (
            <div className="grupo">
              {ignorados.map((i) => (
                <div key={i.id} className="linha sem-icone">
                  <span className="linha-texto">
                    <span className="linha-titulo" style={{ display: 'block' }}>{i.descricao_limpa}</span>
                    <span className="linha-sub" style={{ display: 'block' }}>{ddmm(i.data)}</span>
                  </span>
                  <span className="linha-valor">
                    <Dinheiro valor={i.valor} />
                    <button type="button" className="icone-btn" style={{ width: 32, height: 32 }} aria-label={`Restaurar ${i.descricao_limpa}`} disabled={ocupado} onClick={() => acao('restaurar', [i.id])}>
                      <RotateCcw size={15} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

const NOVA = '__nova__';

function ItemFaltando({ item, marcado, categoria, categorias, aoMarcar, aoCategoria }: {
  item: ItemBanco; marcado: boolean; categoria: string; categorias: string[];
  aoMarcar: (v: boolean) => void; aoCategoria: (c: string) => void;
}) {
  const id = `item-${item.id}`;
  const [nova, setNova] = useState(false);
  const [texto, setTexto] = useState('');
  const confirmarNova = () => {
    const nome = texto.trim().replace(/\s+/g, ' ');
    if (nome) aoCategoria(nome.charAt(0).toUpperCase() + nome.slice(1));
    setNova(false);
    setTexto('');
  };
  return (
    <div className="linha conc-item">
      <input id={id} type="checkbox" className="conc-check" checked={marcado} onChange={(e) => aoMarcar(e.target.checked)} />
      <label htmlFor={id} className="linha-texto">
        <span className="linha-titulo" style={{ display: 'block' }}>
          {item.tipo === 'estorno' ? 'Estorno ' : ''}{item.descricao_limpa}
          {item.parcela ? <span className="tag-parcela">{item.parcela}</span> : null}
        </span>
        <span className="linha-sub" style={{ display: 'block' }}>
          {ddmm(item.data)}{item.final ? ` · final ${item.final}` : ''}{item.parcela && item.parcela.split('/')[0] !== item.parcela.split('/')[1] ? ' · cria as próximas parcelas' : ''}
        </span>
      </label>
      <span className="linha-valor conc-direita">
        <Dinheiro valor={item.valor} tipo={item.tipo === 'estorno' ? 'entrada' : undefined} sinal={item.tipo === 'estorno'} />
        {nova ? (
          <input className="conc-cat conc-cat-nova" aria-label={`Nova categoria para ${item.descricao_limpa}`} autoFocus maxLength={60}
            placeholder="Nova categoria" value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={confirmarNova}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarNova(); } if (e.key === 'Escape') { setNova(false); setTexto(''); } }} />
        ) : (
          <select className="conc-cat" aria-label={`Categoria de ${item.descricao_limpa}`} value={categoria}
            onChange={(e) => (e.target.value === NOVA ? setNova(true) : aoCategoria(e.target.value))}>
            {(categorias.includes(categoria) ? categorias : [categoria, ...categorias]).map((c) => <option key={c} value={c}>{primeiraMaiuscula(c)}</option>)}
            <option value={NOVA}>Nova categoria…</option>
          </select>
        )}
      </span>
    </div>
  );
}
