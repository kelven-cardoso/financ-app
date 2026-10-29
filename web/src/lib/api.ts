export class ErroApi extends Error {
  constructor(public status: number, message: string, public codigo?: string) {
    super(message);
  }
  get semRede() {
    return this.status === 0;
  }
}

type Opcoes = { idem?: string; sinal?: AbortSignal; etag?: string };

/** fetch para a API do app: mesmo domínio, cookie de sessão e o cabeçalho anti-CSRF */
export async function api<T>(metodo: string, caminho: string, corpo?: unknown, opts: Opcoes = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-financ': '1' };
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  if (opts.idem) headers['idempotency-key'] = opts.idem;
  if (opts.etag) headers['if-none-match'] = opts.etag;
  let r: Response;
  try {
    r = await fetch(caminho, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.sinal ?? AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new ErroApi(0, 'Sem conexão com o servidor', 'sem_rede');
  }
  if (r.status === 304) return null as T;
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new ErroApi(r.status, (dados as { erro?: string }).erro ?? `Falha (${r.status})`, (dados as { codigo?: string }).codigo);
  }
  return dados as T;
}

/** envia um arquivo (corpo bruto), ex.: o PDF da fatura */
export async function enviarArquivo<T>(caminho: string, arquivo: Blob, tipo: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(caminho, {
      method: 'POST',
      headers: { 'x-financ': '1', 'content-type': tipo },
      body: arquivo,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor', 'sem_rede');
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroApi(r.status, (dados as { erro?: string }).erro ?? `Falha (${r.status})`, (dados as { codigo?: string }).codigo);
  return dados as T;
}

export function novaChave(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
