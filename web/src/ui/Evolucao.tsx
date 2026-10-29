import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Table2 } from 'lucide-react';
import { mesCurto, nomeMes, primeiraMaiuscula, reais, reaisCompacto } from '../lib/formato';
import type { PainelMes, Snapshot } from '../lib/tipos';
import { Segmentado } from './base';

/** largura do elemento (o gráfico é desenhado em pixels reais para o texto não distorcer) */
function useLargura<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** passo "redondo" para as linhas de grade: 1, 2, 2,5 ou 5 × 10^n */
function passoBonito(alvo: number): number {
  if (!(alvo > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(alvo));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= alvo) return m * p;
  return 10 * p;
}

function rotuloEixo(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1000) return `${s}${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return `${s}${Math.round(a)}`;
}

/** retângulo com os cantos arredondados só na ponta do dado (base reta) */
function barra(x: number, w: number, base: number, ponta: number): string {
  const h = Math.abs(ponta - base);
  if (h < 0.5) return '';
  const r = Math.min(4, h, w / 2);
  if (ponta < base) {
    return `M${x},${base}V${ponta + r}Q${x},${ponta} ${x + r},${ponta}H${x + w - r}Q${x + w},${ponta} ${x + w},${ponta + r}V${base}Z`;
  }
  return `M${x},${base}V${ponta - r}Q${x},${ponta} ${x + r},${ponta}H${x + w - r}Q${x + w},${ponta} ${x + w},${ponta - r}V${base}Z`;
}

type Ponto = { mes: string; status: PainelMes['status']; receitas: number; despesas: number; saldo: number };

function MesAMes({ pontos, selecionado, aoEscolher, hoje }: { pontos: Ponto[]; selecionado: string; aoEscolher: (m: string) => void; hoje: string }) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<string | null>(null);
  const W = Math.max(220, largura || 300);
  const H = 196;
  const padL = 46, padR = 6, padT = 12, padB = 26;
  const n = pontos.length;
  const banda = (W - padL - padR) / Math.max(1, n);
  const bw = Math.max(6, Math.min(18, banda * 0.46));
  const maxRec = Math.max(0, ...pontos.map((p) => p.receitas));
  const maxDesp = Math.max(0, ...pontos.map((p) => p.despesas));
  const maior = Math.max(maxRec, maxDesp, 1);
  // domínio justo nos dados (com folga de 8%); linhas de grade só nos passos redondos que cabem
  const topo = Math.max(maxRec, maior * 0.12) * 1.08;
  const fundo = -Math.max(maxDesp, maior * 0.12) * 1.08;
  const passo = passoBonito(maior / 3);
  const y = (v: number) => padT + ((topo - v) / (topo - fundo)) * (H - padT - padB);
  const y0 = y(0);
  const cx = (i: number) => padL + banda * (i + 0.5);
  const ticks: number[] = [];
  for (let v = Math.ceil(fundo / passo) * passo; v <= topo; v += passo) ticks.push(Math.round(v * 100) / 100);
  const iAtual = pontos.findIndex((p) => p.status === 'em_andamento');
  const corte = iAtual >= 0 ? iAtual : pontos.findIndex((p) => p.status === 'projetado') - 1;
  const linha = (de: number, ate: number) => pontos.slice(de, ate + 1).map((p, k) => `${k ? 'L' : 'M'}${cx(de + k)},${y(p.saldo)}`).join('');
  const ativo = pontos.find((p) => p.mes === (foco ?? selecionado)) ?? pontos[pontos.length - 1];
  const previsto = ativo?.status === 'projetado';

  const tecla = (e: KeyboardEvent, mes: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      aoEscolher(mes);
    }
  };

  return (
    <div className="ev">
      {ativo && (
        <div className="ev-leitura" aria-live="polite">
          <div className="ev-mes">
            {primeiraMaiuscula(nomeMes(ativo.mes, ativo.mes.slice(0, 4) !== hoje.slice(0, 4)))}
            <span className="nota">{ativo.status === 'em_andamento' ? 'até o fim do mês' : previsto ? 'previsto' : 'realizado'}</span>
          </div>
          <div className="ev-valores">
            <span><i className="ev-chave rec" aria-hidden="true" /><strong className="num">{reais(ativo.receitas)}</strong> Receitas</span>
            <span><i className="ev-chave desp" aria-hidden="true" /><strong className="num">{reais(ativo.despesas)}</strong> Despesas</span>
            <span><i className="ev-chave saldo" aria-hidden="true" /><strong className={`num ${ativo.saldo < -0.004 ? 'negativo' : ''}`}>{reais(ativo.saldo)}</strong> Saldo do mês</span>
          </div>
        </div>
      )}
      <div ref={ref} className="ev-area" onPointerLeave={() => setFoco(null)}>
        <svg width={W} height={H} role="img" aria-label={`Receitas, despesas e saldo por mês: ${pontos.map((p) => `${nomeMes(p.mes)} receitas ${reaisCompacto(p.receitas)}, despesas ${reaisCompacto(p.despesas)}, saldo ${reaisCompacto(p.saldo)}`).join('; ')}`}>
          {/* grade */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? 'ev-zero' : 'ev-grade'} />
              <text x={padL - 6} y={y(t)} className="ev-eixo" textAnchor="end" dominantBaseline="middle">{rotuloEixo(t)}</text>
            </g>
          ))}
          {/* mês escolhido / apontado */}
          {pontos.map((p, i) => (p.mes === selecionado || p.mes === foco) && (
            <rect key={`f${p.mes}`} x={cx(i) - banda / 2 + 1} y={padT - 6} width={banda - 2} height={H - padT - padB + 12} rx={8}
              className={p.mes === selecionado ? 'ev-sel' : 'ev-foco'} />
          ))}
          {/* colunas: receitas para cima, despesas para baixo */}
          {pontos.map((p, i) => (
            <g key={p.mes} className={p.status === 'projetado' ? 'ev-prev' : ''}>
              <path d={barra(cx(i) - bw / 2, bw, y0 - 1, Math.min(y0 - 1, y(p.receitas)))} className="ev-rec" />
              <path d={barra(cx(i) - bw / 2, bw, y0 + 1, Math.max(y0 + 1, y(-p.despesas)))} className="ev-desp" />
            </g>
          ))}
          {/* saldo do mês: linha cheia até o mês atual, tracejada na previsão */}
          {corte >= 0 && <path d={linha(0, corte)} className="ev-linha" />}
          {corte < n - 1 && <path d={linha(Math.max(0, corte), n - 1)} className="ev-linha prev" />}
          {pontos.map((p, i) => (
            <circle key={`c${p.mes}`} cx={cx(i)} cy={y(p.saldo)} r={4.5} className={`ev-ponto ${p.status === 'projetado' ? 'prev' : ''}`} />
          ))}
          {/* meses */}
          {pontos.map((p, i) => (
            <text key={`m${p.mes}`} x={cx(i)} y={H - 8} textAnchor="middle" className={`ev-eixo ${p.mes === selecionado ? 'forte' : ''}`}>
              {mesCurto(p.mes)}
            </text>
          ))}
          {/* áreas de toque (maiores que as marcas) */}
          {pontos.map((p, i) => (
            <rect key={`h${p.mes}`} x={cx(i) - banda / 2} y={0} width={banda} height={H} className="ev-toque"
              role="button" tabIndex={0}
              aria-label={`${nomeMes(p.mes)}${p.status === 'projetado' ? ', previsto' : ''}: receitas ${reais(p.receitas)}, despesas ${reais(p.despesas)}, saldo ${reais(p.saldo)}. Abrir o mês.`}
              onPointerEnter={() => setFoco(p.mes)} onFocus={() => setFoco(p.mes)} onBlur={() => setFoco(null)}
              onClick={() => aoEscolher(p.mes)} onKeyDown={(e) => tecla(e, p.mes)} />
          ))}
        </svg>
      </div>
      <p className="nota ev-nota">Barras claras e linha tracejada: previsto (fixas, parcelas e faturas já lançadas). Toque num mês para abrir.</p>
    </div>
  );
}

function Tabela({ pontos }: { pontos: Ponto[] }) {
  return (
    <div className="ev-tabela-wrap">
      <table className="ev-tabela">
        <caption className="visualmente-oculto">Receitas, despesas e saldo por mês</caption>
        <thead>
          <tr><th scope="col">Mês</th><th scope="col">Receitas</th><th scope="col">Despesas</th><th scope="col">Saldo</th></tr>
        </thead>
        <tbody>
          {pontos.map((p) => (
            <tr key={p.mes} className={p.status === 'projetado' ? 'prev' : ''}>
              <th scope="row">{mesCurto(p.mes, true)}{p.status === 'projetado' ? <span className="nota"> prev.</span> : null}</th>
              <td className="num">{reais(p.receitas)}</td>
              <td className="num">{reais(p.despesas)}</td>
              <td className={`num ${p.saldo < -0.004 ? 'negativo' : ''}`}>{reais(p.saldo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** sobra (saldo livre) projetada do mês atual em diante */
function Sobra({ snap }: { snap: Snapshot }) {
  const meses = snap.painel.filter((p) => p.mes >= snap.mes).slice(0, 6);
  const valores = meses.map((p) => p.saldo_livre ?? 0);
  const maxPos = Math.max(0, ...valores);
  const minNeg = Math.min(0, ...valores);
  const span = maxPos - minNeg || 1;
  const area = 96, padT = 22, padB = minNeg < 0 ? 22 : 6;
  const y0 = padT + (area * maxPos) / span;
  return (
    <div role="img" aria-label={`Sobra prevista por mês: ${meses.map((p, i) => `${nomeMes(p.mes)} ${reaisCompacto(valores[i])}`).join('; ')}`}>
      <div className="colunas" style={{ height: padT + area + padB }}>
        <span className="colunas-base" style={{ top: y0 }} />
        {meses.map((p, i) => {
          const v = valores[i];
          const h = Math.max(2, (area * Math.abs(v)) / span);
          const esquerda = `${((i + 0.5) / meses.length) * 100}%`;
          return (
            <span key={p.mes} title={`${nomeMes(p.mes)}: ${reaisCompacto(v)}`}>
              <span className={`coluna-barra ${v < 0 ? 'neg' : ''}`} style={{ left: esquerda, top: v >= 0 ? y0 - h : y0, height: h }} />
              <span className="coluna-val" style={{ left: esquerda, top: v >= 0 ? y0 - h - 17 : y0 + h + 3 }}>{reaisCompacto(v)}</span>
            </span>
          );
        })}
      </div>
      <div className="colunas-rotulos">
        {meses.map((p) => <span key={p.mes}>{mesCurto(p.mes)}</span>)}
      </div>
      <p className="nota ev-nota">Quanto sobra no fim de cada mês depois de pagar faturas e fixas, somando a sobra do mês anterior.</p>
    </div>
  );
}

/** Evolução mensal: receitas e despesas de cada mês e o saldo do mês; ou a sobra acumulada prevista. */
export function Evolucao({ snap, selecionado, aoEscolher }: { snap: Snapshot; selecionado: string; aoEscolher: (m: string) => void }) {
  const [vista, setVista] = useState<'mes' | 'sobra'>('mes');
  const [tabela, setTabela] = useState(false);
  const pontos = useMemo<Ponto[]>(() => {
    const p = snap.painel;
    // começa no primeiro mês com algum movimento (antes disso o app ainda não era usado)
    const i = p.findIndex((m) => Math.abs(m.total_entradas) > 0.004 || Math.abs(m.total_despesas) > 0.004);
    return (i < 0 ? p : p.slice(i)).map((m) => ({
      mes: m.mes, status: m.status, receitas: m.total_entradas, despesas: m.total_despesas, saldo: m.total_entradas - m.total_despesas,
    }));
  }, [snap.painel]);
  if (!pontos.length) return null;
  return (
    <div className="grupo ev-grupo">
      <div className="ev-topo">
        <Segmentado rotulo="Gráfico" valor={vista} aoMudar={setVista}
          opcoes={[{ valor: 'mes', rotulo: 'Mês a mês' }, { valor: 'sobra', rotulo: 'Sobra prevista' }]} />
        {vista === 'mes' && (
          <button type="button" className="icone-btn" aria-pressed={tabela} aria-label={tabela ? 'Ver gráfico' : 'Ver em tabela'} onClick={() => setTabela(!tabela)}>
            <Table2 size={18} />
          </button>
        )}
      </div>
      {vista === 'sobra' ? <Sobra snap={snap} /> : tabela ? <Tabela pontos={pontos} /> : (
        <MesAMes pontos={pontos} selecionado={selecionado} aoEscolher={aoEscolher} hoje={snap.hoje} />
      )}
    </div>
  );
}
