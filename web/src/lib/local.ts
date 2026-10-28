import { createStore, del, get, set, clear } from 'idb-keyval';
import type { Snapshot } from './tipos';

// tudo que fica guardado no aparelho para abrir sem internet
const loja = createStore('financ', 'dados');

export type OpFila = {
  id: string; // também é a Idempotency-Key
  criado_em: string;
  metodo: 'POST' | 'PATCH' | 'DELETE';
  caminho: string;
  corpo?: Record<string, unknown>;
  rotulo: string;
  temp_id?: number; // lançamento criado offline (id negativo no estado local)
  erro?: string;
};

export type ChaveLocal = { id: string; spki: string; alg: number };

export type PerfilLocal = {
  bloqueio_min: number | null;
  digitais: number;
  chaves: ChaveLocal[];
};

export const local = {
  snapshot: () => get<Snapshot>('snapshot', loja),
  salvarSnapshot: (s: Snapshot) => set('snapshot', s, loja),
  fila: async () => (await get<OpFila[]>('fila', loja)) ?? [],
  salvarFila: (f: OpFila[]) => set('fila', f, loja),
  perfil: () => get<PerfilLocal>('perfil', loja),
  salvarPerfil: (p: PerfilLocal) => set('perfil', p, loja),
  apagarTudo: async () => {
    await clear(loja);
    try {
      localStorage.removeItem('financ.atividade');
    } catch {
      /* sem armazenamento */
    }
  },
  apagarSnapshot: () => del('snapshot', loja),
};

const CHAVE_ATIVIDADE = 'financ.atividade';

export function marcarAtividade(): void {
  try {
    localStorage.setItem(CHAVE_ATIVIDADE, String(Date.now()));
  } catch {
    /* sem armazenamento */
  }
}

export function ultimaAtividade(): number {
  try {
    return Number(localStorage.getItem(CHAVE_ATIVIDADE) ?? 0);
  } catch {
    return 0;
  }
}

export function preferencia(chave: string, padrao: string): string {
  try {
    return localStorage.getItem(`financ.${chave}`) ?? padrao;
  } catch {
    return padrao;
  }
}

export function salvarPreferencia(chave: string, valor: string): void {
  try {
    localStorage.setItem(`financ.${chave}`, valor);
  } catch {
    /* sem armazenamento */
  }
}
