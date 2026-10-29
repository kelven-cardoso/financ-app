import { useId, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronRight, Plus, Tags } from 'lucide-react';
import { ErroApi } from '../lib/api';
import { useFinanc } from '../lib/estado';
import { voltar, useFolhas } from '../lib/navegacao';
import { normalizar } from '../lib/financas';
import type { Categoria } from '../lib/tipos';
import { CorpoFolha, Interruptor, RodapeFolha, Segmentado, useTorrada, Vazio } from '../ui/base';
import { chaveIcone, ICONES, IconePorChave, palpiteIcone } from '../ui/icones';

type TipoCat = 'saida' | 'entrada' | 'ambos';

function usoTexto(c: Categoria): string {
  const partes: string[] = [];
  if (c.n) partes.push(`${c.n} ${c.n === 1 ? 'lançamento' : 'lançamentos'}`);
  if (c.n_fixas) partes.push(`${c.n_fixas} ${c.n_fixas === 1 ? 'fixa' : 'fixas'}`);
  return partes.join(', ') || 'Sem uso ainda';
}

function SeletorIcone({ valor, nome, aoMudar }: { valor: string | null; nome: string; aoMudar: (v: string | null) => void }) {
  const auto = palpiteIcone(nome || 'outros');
  const id = useId();
  return (
    <div className="campo">
      <span className="rotulo" id={id}>Ícone</span>
      <div className="icones-grade" role="group" aria-labelledby={id}>
        <button type="button" className="icone-opcao" aria-pressed={valor === null} aria-label={`Automático pelo nome (${ICONES.find((i) => i.chave === auto)?.nome ?? 'Outros'})`} title="Automático" onClick={() => aoMudar(null)}>
          Auto
        </button>
        {ICONES.map((i) => (
          <button key={i.chave} type="button" className="icone-opcao" aria-pressed={valor === i.chave} aria-label={i.nome} title={i.nome} onClick={() => aoMudar(i.chave)}>
            <i.Icone aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function FormCategoria({ fechar, c, tipoInicial }: { fechar: () => void; c?: Categoria; tipoInicial: 'saida' | 'entrada' }) {
  const { snap, executar } = useFinanc();
  const torrada = useTorrada();
  const id = useId();
  const [nome, setNome] = useState(c?.nome ?? '');
  const [icone, setIcone] = useState<string | null>(c?.icone ?? null);
  const [tipo, setTipo] = useState<TipoCat>((c?.tipo as TipoCat) ?? tipoInicial);
  const [visivel, setVisivel] = useState(!c?.oculta);
  const [erro, setErro] = useState<string | null>(null);
  const [juntarCom, setJuntarCom] = useState<string | null>(null);
  const [excluir, setExcluir] = useState(false);
  const [destino, setDestino] = useState('');
  const [ocupado, setOcupado] = useState(false);
  if (!snap) return null;
  const emUso = (c?.n ?? 0) + (c?.n_fixas ?? 0);
  const outras = (snap.categorias ?? []).filter((x) => x.id !== c?.id && !x.oculta).map((x) => x.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const salvar = async (e?: FormEvent, juntar = false) => {
    e?.preventDefault();
    setErro(null);
    if (!nome.trim()) return setErro('Dê um nome.');
    // nome igual ao de outra categoria: junta as duas, só depois de confirmar
    const igual = c?.id && !juntar ? (snap.categorias ?? []).find((x) => x.id !== undefined && x.id !== c.id && normalizar(x.nome) === normalizar(nome)) : undefined;
    if (igual) return setJuntarCom(igual.nome);
    setOcupado(true);
    try {
      if (c?.id) {
        const corpo: Record<string, unknown> = { icone, tipo, oculta: !visivel };
        if (nome.trim() !== c.nome) corpo.nome = nome.trim();
        if (juntar) corpo.juntar = true;
        const r = await executar<{ acao?: string; para?: string; movidos?: number }>({ metodo: 'PATCH', caminho: `/api/categorias/${c.id}`, corpo, rotulo: `Categoria ${c.nome}` });
        torrada(r.resultado?.acao === 'juntar' ? `${c.nome} juntada em ${r.resultado.para}` : r.resultado?.movidos ? `Renomeada em ${r.resultado.movidos} lançamentos` : 'Categoria salva');
      } else {
        await executar({ metodo: 'POST', caminho: '/api/categorias', corpo: { nome: nome.trim(), icone, tipo }, rotulo: `Nova categoria ${nome}` });
        torrada('Categoria criada');
      }
      fechar();
    } catch (err) {
      if (err instanceof ErroApi && err.codigo === 'existe' && c?.id) {
        const outra = (snap.categorias ?? []).find((x) => x.id !== c.id && normalizar(x.nome) === normalizar(nome));
        setJuntarCom(outra?.nome ?? nome.trim());
      } else {
        setErro((err as Error).message);
      }
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (!c?.id) return;
    if (emUso && !destino) return setErro('Escolha para qual categoria mover os lançamentos.');
    setOcupado(true);
    try {
      await executar({ metodo: 'POST', caminho: `/api/categorias/${c.id}/excluir`, corpo: { mover_para: emUso ? destino : undefined }, rotulo: `Excluir ${c.nome}` });
      torrada(emUso ? `${c.nome} excluída; lançamentos em ${destino}` : `${c.nome} excluída`);
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
        {juntarCom && (
          <div className="eq-aviso" role="alert">
            <span>
              Já existe a categoria {juntarCom}. Juntar {c?.nome} nela?{emUso > 0 ? ` ${emUso === 1 ? 'O item vai' : `Os ${emUso} itens vão`} para ${juntarCom}.` : ''}{' '}
              <button type="button" onClick={() => salvar(undefined, true)} disabled={ocupado}>Juntar</button>
            </span>
          </div>
        )}
        <div className="campo">
          <label htmlFor={id}>Nome</label>
          <input id={id} className="entrada" value={nome} maxLength={60} required autoFocus={!c}
            onChange={(e) => { setNome(e.target.value); setJuntarCom(null); }} placeholder="Ex.: Jogos, Academia, Farmácia" />
          {c && nome.trim() && nome.trim() !== c.nome && emUso > 0 && (
            <span className="dica">Os {emUso} {emUso === 1 ? 'item' : 'itens'} desta categoria passam a usar o nome novo.</span>
          )}
        </div>
        <div className="campo">
          <span className="rotulo">Usada em</span>
          <Segmentado rotulo="Usada em" valor={tipo} aoMudar={setTipo}
            opcoes={[{ valor: 'saida', rotulo: 'Saídas' }, { valor: 'entrada', rotulo: 'Entradas' }, { valor: 'ambos', rotulo: 'As duas' }]} />
        </div>
        <SeletorIcone valor={icone} nome={nome} aoMudar={setIcone} />
        {c && (
          <Interruptor rotulo="Mostrar nos atalhos" dica="Oculta, ela some das sugestões; os lançamentos antigos continuam com ela." valor={visivel} aoMudar={setVisivel} />
        )}
        {c?.id && normalizar(c.nome) !== 'outros' && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 6 }}>
            {!excluir ? (
              <button type="button" className="btn perigo cheio" onClick={() => setExcluir(true)}>Excluir categoria</button>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {emUso > 0 ? (
                  <>
                    <label className="nota" htmlFor={`${id}-m`} style={{ margin: 0 }}>{c.nome} está em {usoTexto(c).toLowerCase()}. Mover para:</label>
                    <select id={`${id}-m`} className="entrada" value={destino} onChange={(e) => setDestino(e.target.value)}>
                      <option value="">Escolha a categoria</option>
                      {outras.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </>
                ) : <p className="nota" style={{ margin: 0 }}>Nenhum lançamento usa {c.nome}.</p>}
                <button type="button" className="btn perigo cheio" onClick={remover} disabled={ocupado || (emUso > 0 && !destino)}>Excluir {c.nome}</button>
              </div>
            )}
          </div>
        )}
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>{c ? 'Salvar' : 'Criar categoria'}</button></RodapeFolha>
    </form>
  );
}

export function Categorias() {
  const { snap, online } = useFinanc();
  const { abrir } = useFolhas();
  const [tipo, setTipo] = useState<'saida' | 'entrada'>('saida');
  if (!snap) return null;
  const todas = (snap.categorias ?? []).filter((c) => c.id !== undefined);
  const daAba = todas.filter((c) => c.tipo === tipo || c.tipo === 'ambos');
  const visiveis = daAba.filter((c) => !c.oculta);
  const ocultas = daAba.filter((c) => c.oculta);
  const linha = (c: Categoria) => (
    <button type="button" className="linha" key={c.id} style={{ opacity: c.oculta ? 0.6 : 1 }}
      onClick={() => abrir(c.nome, (f) => <FormCategoria fechar={f} c={c} tipoInicial={tipo} />)}>
      <span className="linha-icone"><IconePorChave chave={chaveIcone(c.nome, snap)} /></span>
      <span className="linha-texto">
        <span className="linha-titulo" style={{ display: 'block' }}>{c.nome}</span>
        <span className="linha-sub" style={{ display: 'block' }}>{usoTexto(c)}{c.tipo === 'ambos' ? ', entradas e saídas' : ''}{c.oculta ? ', oculta' : ''}</span>
      </span>
      <ChevronRight size={18} color="var(--ink-3)" aria-hidden="true" />
    </button>
  );
  return (
    <>
      <header className="topo">
        <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar('/ajustes')}><ArrowLeft size={20} /></button>
        <h1>Categorias</h1>
        <button type="button" className="icone-btn" aria-label="Nova categoria" disabled={!online}
          onClick={() => abrir('Nova categoria', (f) => <FormCategoria fechar={f} tipoInicial={tipo} />)}><Plus size={20} /></button>
      </header>
      {!online && <div className="faixa alerta" role="status"><span>Sem conexão: dá para ver, mas criar ou editar precisa de internet.</span></div>}
      <div style={{ marginBottom: 14 }}>
        <Segmentado rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={[{ valor: 'saida', rotulo: 'Saídas' }, { valor: 'entrada', rotulo: 'Entradas' }]} />
      </div>
      {todas.length === 0 ? (
        <div className="grupo"><Vazio icone={<Tags />} titulo="Sincronize para ver as categorias" texto="Elas aparecem depois da próxima atualização." /></div>
      ) : (
        <>
          <div className="grupo">{visiveis.map(linha)}</div>
          {ocultas.length > 0 && (
            <section className="secao" aria-label="Ocultas">
              <div className="secao-cab"><h2>Ocultas</h2></div>
              <div className="grupo">{ocultas.map(linha)}</div>
            </section>
          )}
        </>
      )}
      <p className="nota" style={{ margin: '16px 2px' }}>
        Categoria nova também nasce sozinha quando você usa um nome novo num lançamento, aqui ou no WhatsApp. Renomear ou juntar muda todos os lançamentos, fixas e orçamentos que usam a categoria.
      </p>
    </>
  );
}
