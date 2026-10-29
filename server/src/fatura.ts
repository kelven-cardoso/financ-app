import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ErroApi } from './http.js';

/** Item lido da fatura do banco */
export type ItemFatura = {
  data: string;
  descricao: string;
  valor: number;
  tipo: 'compra' | 'encargo' | 'estorno';
  parcela_num: number | null;
  parcela_total: number | null;
  final: string | null;
};

export type FaturaLida = {
  banco: 'nubank';
  empresa: boolean;
  titular: string | null;
  vencimento: string;
  fechamento: string | null;
  periodo_ini: string | null;
  total: number | null;
  saldo_financiado: number;
  itens: ItemFatura[];
  checagem: { soma_itens: number; esperado: number | null; diferenca: number | null; ok: boolean; linhas_ignoradas: number };
};

const MESES: Record<string, number> = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const MAX_PDF = 10 * 1024 * 1024;

/** Extrai o texto do PDF com o pdftotext (poppler), mantendo o layout das colunas. */
export async function textoDoPdf(pdf: Buffer): Promise<string> {
  if (pdf.length > MAX_PDF) throw new ErroApi(413, 'PDF grande demais (máximo 10 MB).', 'pdf_grande');
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ErroApi(400, 'O arquivo enviado não é um PDF.', 'nao_pdf');
  const pasta = await mkdtemp(path.join(tmpdir(), 'fatura-'));
  const arq = path.join(pasta, randomBytes(8).toString('hex') + '.pdf');
  try {
    await writeFile(arq, pdf, { mode: 0o600 });
    return await new Promise<string>((ok, falha) => {
      execFile('pdftotext', ['-layout', '-enc', 'UTF-8', '-l', '30', arq, '-'], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message);
          if (/password|encrypt/i.test(msg)) falha(new ErroApi(422, 'O PDF está protegido por senha. Envie a versão sem senha.', 'pdf_senha'));
          else falha(new ErroApi(422, 'Não consegui ler esse PDF.', 'pdf_ilegivel'));
          return;
        }
        ok(stdout);
      });
    });
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

const valorBr = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Lê o texto da fatura do Nubank (cartão pessoal ou Nu Empresas). */
export function lerFaturaNubank(texto: string): FaturaLida {
  const t = texto.replace(/\r/g, '').replace(/−/g, '-');
  if (!/nubank|nu pagamentos/i.test(t)) throw new ErroApi(422, 'Esse PDF não parece ser uma fatura do Nubank.', 'fatura_desconhecida');

  const venc = t.match(/Data de vencimento:\s*(\d{2})\s+([A-Z]{3})\s+(\d{4})/);
  if (!venc || !MESES[venc[2]]) throw new ErroApi(422, 'Não achei a data de vencimento no PDF.', 'sem_vencimento');
  const anoV = Number(venc[3]);
  const mesV = MESES[venc[2]];
  const vencimento = iso(anoV, mesV, Number(venc[1]));

  // datas sem ano: o ano é o do vencimento, voltando um se o mês for depois do mês do vencimento
  const dataSemAno = (d: string, mes: string) => {
    const m = MESES[mes];
    return iso(m > mesV ? anoV - 1 : anoV, m, Number(d));
  };

  const per = t.match(/Per[ií]odo vigente:\s*(\d{2})\s+([A-Z]{3})\s+a\s+(\d{2})\s+([A-Z]{3})/);
  const periodo_ini = per ? dataSemAno(per[1], per[2]) : null;
  const fechamento = per ? dataSemAno(per[3], per[4]) : null;

  // o total da saudação ("no valor de R$ ...") ou a linha "Total a pagar" do resumo (a tabela de parcelamento tem duas colunas)
  const totalM = t.match(/no valor de\s*R\$\s*([\d.]+,\d{2})/) ?? t.match(/^\s*Total a pagar\s+R\$\s*([\d.]+,\d{2})\s*$/m);
  const total = totalM ? valorBr(totalM[1]) : null;

  const titularM = t.match(/Ol[aá],\s*([^.\n]+)\./);
  const titular = titularM ? titularM[1].trim() : null;
  // Nu Empresas: CNPJ (parcial) antes do nome no cabeçalho, ou o nome da empresa na saudação
  const empresa = /\n\s*\d{2}\.\d{3}\.\d{3}\s+[A-ZÀ-Ú]/.test(t) || /Nu Empresas/i.test(t);

  // só as linhas das páginas de transações
  const linha = /^\s+(\d{2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(?:[•·]+\s*(\d{4})\s+)?(.+?)\s{2,}(-?)R\$\s*([\d.]+,\d{2})\s*$/;
  const itens: ItemFatura[] = [];
  let saldo_financiado = 0;
  let ignoradas = 0;
  let emTransacoes = false;
  for (const bruta of t.split('\n')) {
    if (/^\s*TRANSA[ÇC][ÕO]ES\s/i.test(bruta)) emTransacoes = true;
    if (!emTransacoes) continue;
    const m = bruta.match(linha);
    if (!m) continue;
    const data = dataSemAno(m[1], m[2]);
    let descricao = m[4].replace(/\s{2,}/g, ' ').trim();
    const negativo = m[5] === '-';
    const valor = valorBr(m[6]);
    if (!valor) continue;
    if (/^Pagamento em\b/i.test(descricao) || /^Pagamento recebido/i.test(descricao)) { ignoradas++; continue; }
    if (/^Cr[eé]dito de rotativo/i.test(descricao)) { ignoradas++; continue; }
    if (/^Saldo em rotativo|^Saldo financiado|^Saldo em atraso/i.test(descricao)) {
      if (!negativo) saldo_financiado += valor;
      continue;
    }
    let parcela_num: number | null = null;
    let parcela_total: number | null = null;
    const pm = descricao.match(/\s+-\s+Parcela\s+(\d+)\/(\d+)\s*$/i);
    if (pm) {
      parcela_num = Number(pm[1]);
      parcela_total = Number(pm[2]);
    }
    const encargo = /^(IOF|Juros|Multa|Encargos?|Mora|Tarifa|Anuidade)\b/i.test(descricao);
    descricao = descricao.slice(0, 200);
    itens.push({
      data,
      descricao,
      valor,
      tipo: negativo ? 'estorno' : encargo ? 'encargo' : 'compra',
      parcela_num,
      parcela_total,
      final: m[3] ?? null,
    });
  }
  if (itens.length === 0) throw new ErroApi(422, 'Não encontrei transações nesse PDF.', 'sem_itens');

  const soma = Math.round((itens.reduce((s, i) => s + (i.tipo === 'estorno' ? -i.valor : i.valor), 0) + saldo_financiado) * 100) / 100;
  const diferenca = total === null ? null : Math.round((total - soma) * 100) / 100;
  return {
    banco: 'nubank',
    empresa,
    titular,
    vencimento,
    fechamento,
    periodo_ini,
    total,
    saldo_financiado: Math.round(saldo_financiado * 100) / 100,
    itens,
    checagem: { soma_itens: soma, esperado: total, diferenca, ok: diferenca !== null && Math.abs(diferenca) <= 0.05, linhas_ignoradas: ignoradas },
  };
}
