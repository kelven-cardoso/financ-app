const brl = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** 1234.5 -> "1.234,50" (sem o símbolo; o componente Dinheiro cuida dele) */
export function numero(v: number): string {
  return brl.format(Math.abs(v) < 0.005 ? 0 : v);
}

/** 1234.5 -> "R$ 1.234,50"; com sinal opcional */
export function reais(v: number | null | undefined, opts: { sinal?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const s = numero(Math.abs(v));
  if (opts.sinal) return `${v < 0 ? '−' : '+'} R$ ${s}`;
  return `${v < 0 ? '−' : ''}R$ ${s}`;
}

export function reaisCompacto(v: number): string {
  const s = v < -0.5 ? '−' : '';
  const a = Math.abs(v);
  return a < 1000 ? `${s}R$ ${Math.round(a)}` : `${s}R$ ${compacto.format(a)}`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function dataLocal(iso: string): Date {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d, 12);
}

export function isoData(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** hoje no fuso de São Paulo */
export function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function somarDias(iso: string, n: number): string {
  const d = dataLocal(iso);
  d.setDate(d.getDate() + n);
  return isoData(d);
}

export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "2026-10" -> "outubro" ou "outubro de 2026" */
export function nomeMes(mes: string, comAno = false): string {
  const [a, m] = mes.split('-').map(Number);
  return comAno ? `${MESES[m - 1]} de ${a}` : MESES[m - 1];
}

export function mesCurto(mes: string, comAno = false): string {
  const [a, m] = mes.split('-').map(Number);
  return comAno ? `${MESES_CURTOS[m - 1]}/${String(a).slice(2)}` : MESES_CURTOS[m - 1];
}

/** "2026-10-28" -> "28 de out" */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = dataLocal(iso);
  return `${d.getDate()} de ${MESES_CURTOS[d.getMonth()]}`;
}

/** "2026-10-28" -> "28/10" */
export function ddmm(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** cabeçalho de dia no extrato: Hoje, Ontem, "segunda, 26 de outubro" */
export function tituloDia(iso: string, hoje: string): string {
  if (iso === hoje) return 'Hoje';
  if (iso === somarDias(hoje, -1)) return 'Ontem';
  if (iso === somarDias(hoje, 1)) return 'Amanhã';
  const d = dataLocal(iso);
  const base = `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
  return iso.slice(0, 4) === hoje.slice(0, 4) ? base : `${base} de ${iso.slice(0, 4)}`;
}

export function diasAte(iso: string, hoje: string): number {
  return Math.round((dataLocal(iso).getTime() - dataLocal(hoje).getTime()) / 86400000);
}

export function quandoRelativo(iso: string, hoje: string): string {
  const n = diasAte(iso, hoje);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  if (n > 1 && n < 7) return `em ${n} dias`;
  if (n < -1 && n > -7) return `há ${-n} dias`;
  return dataCurta(iso);
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
}

export const NOME_METODO: Record<string, string> = {
  credito: 'Crédito',
  debito: 'Débito',
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  boleto: 'Boleto',
  vale: 'Vale',
};

export const NOME_TIPO_CONTA: Record<string, string> = {
  pf: 'Pessoa física',
  pj: 'Empresa (PJ)',
  outro: 'Outra',
  beneficio: 'Benefício',
};

/** texto -> valor (aceita "1.234,56", "1234.56", "1234") */
export function lerValor(t: string): number | null {
  const s = t.replace(/[^\d,.-]/g, '');
  if (!s) return null;
  let n: number;
  if (/,\d{1,2}$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
  else n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function primeiraMaiuscula(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
