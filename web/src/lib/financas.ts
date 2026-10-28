import type { Cartao, Conta, Fatura, Lancamento, PainelMes, Snapshot } from './tipos';
import { somarDias, somarMeses, NOME_METODO } from './formato';

/** mesmo cálculo de financ.fn_data_no_mes: dia limitado ao último dia do mês */
export function dataNoMes(mes: string, dia: number): string {
  const [a, m] = mes.slice(0, 7).split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${mes.slice(0, 7)}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

/** data + n meses, como o Postgres (31/01 + 1 mês = 28/02) */
export function somarMesesData(iso: string, n: number): string {
  return dataNoMes(somarMeses(iso.slice(0, 7), n), Number(iso.slice(8, 10)));
}

/** mesmo cálculo de financ.fn_competencia_credito */
export function competenciaCredito(dataIso: string, c: Pick<Cartao, 'dia_fechamento' | 'dia_vencimento' | 'competencia_por'>): string {
  const dia = Number(dataIso.slice(8, 10));
  const mes = dataIso.slice(0, 7);
  const fech = dia < c.dia_fechamento ? dataNoMes(mes, c.dia_fechamento) : dataNoMes(somarMeses(mes, 1), c.dia_fechamento);
  if (c.competencia_por === 'fechamento') return fech.slice(0, 7);
  const venc = c.dia_vencimento > c.dia_fechamento ? dataNoMes(fech, c.dia_vencimento) : dataNoMes(somarMeses(fech.slice(0, 7), 1), c.dia_vencimento);
  return venc.slice(0, 7);
}

/** mesmo cálculo de financ.fn_fatura_datas */
export function faturaDatas(c: Pick<Cartao, 'dia_fechamento' | 'dia_vencimento' | 'competencia_por'>, comp: string) {
  if (c.competencia_por === 'fechamento') {
    const fechamento = dataNoMes(comp, c.dia_fechamento);
    const vencimento = c.dia_vencimento > c.dia_fechamento ? dataNoMes(comp, c.dia_vencimento) : dataNoMes(somarMeses(comp, 1), c.dia_vencimento);
    return { fechamento, vencimento };
  }
  const vencimento = dataNoMes(comp, c.dia_vencimento);
  const fechamento = c.dia_vencimento > c.dia_fechamento ? dataNoMes(comp, c.dia_fechamento) : dataNoMes(somarMeses(comp, -1), c.dia_fechamento);
  return { fechamento, vencimento };
}

export function faturaDoMes(c: Cartao, comp: string): Fatura | undefined {
  return c.faturas.find((f) => f.competencia === comp);
}

/** fatura que o app mostra primeiro: uma fechada ainda sem pagar; se não houver, a atual */
export function faturaEmFoco(c: Cartao): Fatura | undefined {
  const fechada = c.faturas.find((f) => f.status === 'fechada' && !f.paga && f.valor_fatura > 0.004 && f.competencia < c.competencia_atual);
  return fechada ?? faturaDoMes(c, c.competencia_atual) ?? c.faturas[c.faturas.length - 1];
}

export function limiteDisponivel(c: Cartao): { limite: number | null; usado: number; disponivel: number | null } {
  const f = c.faturas[0];
  return { limite: c.limite, usado: f?.limite_usado_total ?? 0, disponivel: f?.limite_disponivel ?? null };
}

export type ParcelaSimulada = { n: number; valor: number; competencia: string; vencimento: string; faturaAntes: number; faturaDepois: number };

export function simularCompra(c: Cartao, valor: number, parcelas: number, dataIso: string) {
  const lista: ParcelaSimulada[] = [];
  const base = Math.round((valor / parcelas) * 100) / 100;
  let acum = 0;
  for (let i = 1; i <= parcelas; i++) {
    const di = somarMesesData(dataIso, i - 1);
    const comp = competenciaCredito(di, c);
    const v = i === parcelas ? Math.round((valor - acum) * 100) / 100 : base;
    acum += v;
    const antes = faturaDoMes(c, comp)?.valor_fatura ?? 0;
    lista.push({ n: i, valor: v, competencia: comp, vencimento: faturaDatas(c, comp).vencimento, faturaAntes: antes, faturaDepois: antes + v });
  }
  const { limite, disponivel } = limiteDisponivel(c);
  return { parcelas: lista, limiteDepois: disponivel === null ? null : disponivel - valor, limite };
}

/** Lançamentos que contam no caixa (exclui vale/benefício) */
export function contaBeneficio(snap: Snapshot, contaId: number | null): boolean {
  if (!contaId) return false;
  return snap.contas.find((c) => c.id === contaId)?.tipo === 'beneficio';
}

export function lancamentosDoMes(snap: Snapshot, mes: string): Lancamento[] {
  return snap.lancamentos.filter((l) => l.data.slice(0, 7) === mes);
}

export function gastosPorCategoria(snap: Snapshot, mes: string) {
  const mapa = new Map<string, { categoria: string; valor: number; n: number }>();
  for (const l of lancamentosDoMes(snap, mes)) {
    if (l.tipo !== 'saida') continue;
    const k = l.categoria || 'Outros';
    const e = mapa.get(k) ?? { categoria: k, valor: 0, n: 0 };
    e.valor += l.valor;
    e.n += 1;
    mapa.set(k, e);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}

export function painelDoMes(snap: Snapshot, mes: string): PainelMes | undefined {
  return snap.painel.find((p) => p.mes === mes);
}

/** "Nubank", "Pix · PF", "Vale-alimentação" */
export function meioDoLancamento(l: Lancamento, snap: Snapshot): string {
  if (l.metodo === 'credito') return snap.cartoes.find((c) => c.id === l.cartao_id)?.nome ?? 'Crédito';
  const conta = snap.contas.find((c) => c.id === l.conta_id);
  if (l.metodo === 'vale') return conta?.nome ?? 'Vale';
  const m = NOME_METODO[l.metodo] ?? l.metodo;
  return conta && snap.contas.filter((c) => c.tipo !== 'beneficio').length > 1 ? `${m}, ${conta.nome}` : m;
}

export type Vencimento = { data: string; titulo: string; valor: number; tipo: 'fatura' | 'fixa' | 'receita' | 'agendado'; ref?: number };

/** o que vence ou cai nos próximos dias (faturas não pagas, fixas e receitas previstas, lançamentos com data futura) */
export function proximosVencimentos(snap: Snapshot, dias = 15): Vencimento[] {
  const hoje = snap.hoje;
  const limite = somarDias(hoje, dias);
  const out: Vencimento[] = [];
  for (const c of snap.cartoes) {
    for (const f of c.faturas) {
      if (!f.paga && f.valor_fatura > 0.004 && f.vencimento >= somarDias(hoje, -10) && f.vencimento <= limite) {
        out.push({ data: f.vencimento, titulo: `Fatura ${c.nome}`, valor: f.valor_fatura, tipo: 'fatura', ref: c.id });
      }
    }
  }
  for (const r of snap.recorrentes) {
    if (!r.ativo || contaBeneficio(snap, r.conta_id) || r.metodo === 'credito') continue;
    for (const mes of [snap.mes, somarMeses(snap.mes, 1)]) {
      if (r.inicio.slice(0, 7) > mes || (r.fim && r.fim.slice(0, 7) < mes)) continue;
      const d = dataNoMes(mes, r.dia_vencimento);
      if (d < hoje || d > limite) continue;
      const lancado = snap.lancamentos.some((l) => l.recorrente_id === r.id && l.competencia === mes);
      if (lancado) continue;
      out.push({ data: d, titulo: r.descricao, valor: r.valor, tipo: r.tipo === 'entrada' ? 'receita' : 'fixa', ref: r.id });
    }
  }
  for (const l of snap.lancamentos) {
    if (l.data > hoje && l.data <= limite && l.metodo !== 'credito' && !contaBeneficio(snap, l.conta_id)) {
      out.push({ data: l.data, titulo: l.descricao, valor: l.valor, tipo: l.tipo === 'entrada' ? 'receita' : 'agendado', ref: l.id });
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

export function contasDeCaixa(snap: Snapshot): Conta[] {
  return snap.contas.filter((c) => c.tipo !== 'beneficio');
}

export function beneficios(snap: Snapshot): Conta[] {
  return snap.contas.filter((c) => c.tipo === 'beneficio');
}

/** categorias mais usadas para o tipo, para os atalhos do formulário */
export function categoriasFrequentes(snap: Snapshot, tipo: 'saida' | 'entrada', n = 8): string[] {
  const base = tipo === 'saida'
    ? ['Alimentação', 'Restaurante', 'Transporte', 'Mercado', 'Moradia', 'Saúde', 'Lazer', 'Compras', 'Assinaturas', 'Educação', 'Outros']
    : ['Salário', 'Freela', 'Renda', 'Reembolso', 'Outros'];
  const usadas = snap.categorias.filter((c) => c.tipo === tipo).map((c) => c.nome);
  const todas = [...new Set([...usadas, ...base])];
  return todas.slice(0, n);
}

/** sugestão a partir de um lançamento anterior com a mesma descrição */
export function sugestaoPorDescricao(snap: Snapshot, descricao: string): Lancamento | undefined {
  const alvo = normalizar(descricao);
  if (alvo.length < 3) return undefined;
  return snap.lancamentos.find((l) => normalizar(l.descricao) === alvo && l.origem === 'avulso');
}

export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** cor de texto legível sobre a cor do cartão */
export function textoSobre(cor: string): '#FFFFFF' | '#141A26' {
  const { r, g, b } = hexRgb(cor);
  const lum = (0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b));
  return lum > 0.42 ? '#141A26' : '#FFFFFF';
}

export function hexRgb(hex: string) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function lin(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** mistura a cor com preto (t<0) ou branco (t>0) */
export function tom(hex: string, t: number): string {
  const { r, g, b } = hexRgb(hex);
  const alvo = t < 0 ? 0 : 255;
  const k = Math.abs(t);
  const m = (c: number) => Math.round(c + (alvo - c) * k).toString(16).padStart(2, '0');
  return `#${m(r)}${m(g)}${m(b)}`;
}

export const CORES_CARTAO = ['#6D28D9', '#1F2937', '#0F766E', '#B91C1C', '#C2410C', '#B45309', '#1D4ED8', '#0E7490', '#BE185D', '#475569', '#A3A3A3', '#D4B483'];

export function corPadraoConta(c: Pick<Conta, 'tipo' | 'cor'>): string {
  if (c.cor) return c.cor;
  return c.tipo === 'pf' ? '#6D28D9' : c.tipo === 'pj' ? '#0F766E' : c.tipo === 'beneficio' ? '#C2410C' : '#334155';
}
