import { CalendarClock, Clock3 } from 'lucide-react';
import type { Lancamento, Previsto, Snapshot } from '../lib/tipos';
import { meioDoLancamento, meioDoPrevisto } from '../lib/financas';
import { dataCurta, tituloDia } from '../lib/formato';
import { useFolhas } from '../lib/navegacao';
import { Dinheiro } from './base';
import { IconeCategoria } from './icones';
import { FormLancamento } from '../formularios/Lancamento';
import { FolhaPrevisto } from '../formularios/Previsto';

export { IconeCategoria } from './icones';

/** "Agendado" (lançado com data futura), "Previsto" (fixa ainda não lançada), "Atrasada" */
function Marca({ tipo }: { tipo: 'agendado' | 'previsto' | 'atrasado' | 'hoje' }) {
  const texto = { agendado: 'Agendado', previsto: 'Previsto', atrasado: 'Atrasada', hoje: 'Vence hoje' }[tipo];
  return <span className={`marca-futuro ${tipo}`}>{texto}</span>;
}

export function LinhaLancamento({ l, snap, mostrarData }: { l: Lancamento; snap: Snapshot; mostrarData?: boolean }) {
  const { abrir } = useFolhas();
  const meio = meioDoLancamento(l, snap);
  const parcela = l.parcela_num ? ` ${l.parcela_num}/${l.parcela_total}` : '';
  const sub = [l.categoria, meio].filter(Boolean).join(', ') + parcela;
  const futuro = l.data > snap.hoje;
  return (
    <button
      type="button"
      className={`linha ${futuro ? 'futuro' : ''}`}
      onClick={() => abrir('Lançamento', (fechar) => <FormLancamento fechar={fechar} lancamento={l} />)}
    >
      <span className="linha-icone" style={l.tipo === 'entrada' && !futuro ? { background: 'var(--good-soft)', color: 'var(--good)' } : undefined}>
        <IconeCategoria categoria={l.categoria} snap={snap} />
      </span>
      <span className="linha-texto">
        <span className="linha-titulo" style={{ display: 'block' }}>{l.descricao}</span>
        <span className="linha-sub" style={{ display: 'block' }}>
          {l.pendente && <span className="pendente-marca"><Clock3 size={12} aria-hidden="true" /> Aguardando envio, </span>}
          {futuro && <Marca tipo="agendado" />}
          {mostrarData ? `${l.data.slice(8, 10)}/${l.data.slice(5, 7)}, ` : ''}{sub}
        </span>
      </span>
      <span className="linha-valor">
        <Dinheiro valor={l.valor} tipo={l.tipo} sinal={l.tipo === 'entrada'} />
      </span>
    </button>
  );
}

export function LinhaPrevisto({ p, snap, mostrarData }: { p: Previsto; snap: Snapshot; mostrarData?: boolean }) {
  const { abrir } = useFolhas();
  const marca = p.atrasado ? 'atrasado' : p.data === snap.hoje ? 'hoje' : 'previsto';
  const sub = [p.categoria, meioDoPrevisto(p, snap)].filter(Boolean).join(', ');
  return (
    <button
      type="button"
      className={`linha futuro ${p.atrasado ? 'atrasado' : ''}`}
      onClick={() => abrir(p.descricao, (fechar) => <FolhaPrevisto fechar={fechar} recorrenteId={p.recorrente_id} mes={p.mes} />)}
      aria-label={`${p.descricao}, ${marca === 'atrasado' ? 'atrasada' : 'prevista'} para ${dataCurta(p.data)}`}
    >
      <span className="linha-icone"><IconeCategoria categoria={p.categoria} snap={snap} /></span>
      <span className="linha-texto">
        <span className="linha-titulo" style={{ display: 'block' }}>{p.descricao}</span>
        <span className="linha-sub" style={{ display: 'block' }}>
          <Marca tipo={marca} />
          {mostrarData ? `${p.data.slice(8, 10)}/${p.data.slice(5, 7)}, ` : ''}{sub}{p.ajustado ? ', valor deste mês' : ''}
        </span>
      </span>
      <span className="linha-valor">
        <Dinheiro valor={p.valor} tipo={p.tipo} sinal={p.tipo === 'entrada'} />
      </span>
    </button>
  );
}

type Entrada = { data: string; l?: Lancamento; p?: Previsto };

function grupos(itens: Entrada[]) {
  const out: { dia: string; itens: Entrada[] }[] = [];
  for (const e of itens) {
    const g = out[out.length - 1];
    if (g && g.dia === e.data) g.itens.push(e);
    else out.push({ dia: e.data, itens: [e] });
  }
  return out;
}

const valorAssinado = (e: Entrada) => {
  const x = e.l ?? e.p!;
  return x.tipo === 'entrada' ? x.valor : -x.valor;
};

function Dias({ itens, snap }: { itens: Entrada[]; snap: Snapshot }) {
  return (
    <>
      {grupos(itens).map((g) => (
        <section key={g.dia} aria-label={tituloDia(g.dia, snap.hoje)}>
          <div className="dia-cab">
            <span>{tituloDia(g.dia, snap.hoje)}</span>
            <span className="num"><Dinheiro valor={g.itens.reduce((s, e) => s + valorAssinado(e), 0)} /></span>
          </div>
          <div className="grupo">
            {g.itens.map((e) => (e.l
              ? <LinhaLancamento key={`l${e.l.id}`} l={e.l} snap={snap} />
              : <LinhaPrevisto key={`p${e.p!.recorrente_id}-${e.p!.mes}`} p={e.p!} snap={snap} />))}
          </div>
        </section>
      ))}
    </>
  );
}

/**
 * Lista agrupada por dia, com o total do dia. O que ainda vai acontecer (agendado ou previsto)
 * fica num bloco à parte, em ordem de data (o mais próximo primeiro); o resto, do mais recente ao mais antigo.
 */
export function ListaPorDia({ lancamentos, previstos = [], snap }: { lancamentos: Lancamento[]; previstos?: Previsto[]; snap: Snapshot }) {
  const futuros: Entrada[] = [
    ...lancamentos.filter((l) => l.data > snap.hoje).map((l): Entrada => ({ data: l.data, l })),
    // fixa atrasada aparece no dia de hoje, no topo do que falta
    ...previstos.map((p): Entrada => ({ data: p.atrasado ? snap.hoje : p.data, p })),
  ].sort((a, b) => a.data.localeCompare(b.data) || Number(!!a.l) - Number(!!b.l));
  const feitos: Entrada[] = lancamentos.filter((l) => l.data <= snap.hoje).map((l) => ({ data: l.data, l }));
  const totalFuturo = futuros.reduce((s, e) => s + valorAssinado(e), 0);
  return (
    <>
      {futuros.length > 0 && (
        <div className="bloco-futuro">
          <div className="bloco-cab">
            <h2><CalendarClock size={16} aria-hidden="true" /> A acontecer</h2>
            <span className="num"><Dinheiro valor={totalFuturo} sinal={totalFuturo > 0} tipo={totalFuturo > 0 ? 'entrada' : undefined} /></span>
          </div>
          <Dias itens={futuros} snap={snap} />
        </div>
      )}
      {feitos.length > 0 && futuros.length > 0 && (
        <div className="bloco-cab" style={{ marginTop: 22 }}><h2>Já aconteceu</h2></div>
      )}
      <Dias itens={feitos} snap={snap} />
    </>
  );
}
