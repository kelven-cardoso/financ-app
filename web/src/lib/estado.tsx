import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ErroApi, novaChave } from './api';
import { buscarChavesLocais, desbloquearSemInternet, usarDigital } from './digital';
import { competenciaCredito, somarMesesData } from './financas';
import { hojeSP } from './formato';
import { local, marcarAtividade, ultimaAtividade, type OpFila, type PerfilLocal } from './local';
import type { EstadoAuth, Lancamento, RespostaMutacao, Snapshot } from './tipos';

export type Fase =
  | { tipo: 'iniciando' }
  | { tipo: 'configurar'; token: string }
  | { tipo: 'entrar'; configurado: boolean; digitais: number; semRede?: boolean }
  | { tipo: 'bloqueado'; digitais: number; offline: boolean }
  | { tipo: 'pronto' };

export type Operacao = {
  metodo: 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  caminho: string;
  corpo?: Record<string, unknown>;
  rotulo: string;
  /** pode esperar na fila se estiver sem internet (só lançamentos) */
  podeEsperar?: boolean;
};

type Ctx = {
  fase: Fase;
  snap: Snapshot | null;
  online: boolean;
  sincronizando: boolean;
  ultimaSync: string | null;
  erroSync: string | null;
  fila: OpFila[];
  perfil: PerfilLocal | null;
  sincronizar: () => Promise<void>;
  executar: <T = Record<string, unknown>>(op: Operacao) => Promise<{ resultado?: T; naFila?: boolean }>;
  entrarComSenha: (senha: string) => Promise<void>;
  entrarComDigital: () => Promise<void>;
  desbloquearComDigital: () => Promise<void>;
  desbloquearComSenha: (senha: string) => Promise<void>;
  configurarSenha: (token: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  bloquearAgora: () => void;
  atualizarPerfil: () => Promise<void>;
  descartarDaFila: (id: string) => Promise<void>;
  apagarDadosDoAparelho: () => Promise<void>;
};

const Contexto = createContext<Ctx | null>(null);

export function useFinanc(): Ctx {
  const c = useContext(Contexto);
  if (!c) throw new Error('useFinanc fora do provedor');
  return c;
}

/** o snapshot como o usuário vê: o do servidor mais o que está na fila (sem internet) */
function aplicarFila(base: Snapshot, fila: OpFila[]): Snapshot {
  if (!fila.length) return base;
  let lancs = [...base.lancamentos];
  for (const op of fila) {
    if (op.erro) continue;
    const m = op.caminho.match(/^\/api\/lancamentos(?:\/(-?\d+))?/);
    if (!m) continue;
    const id = m[1] ? Number(m[1]) : null;
    if (op.metodo === 'POST' && op.temp_id) {
      lancs = [...criarTemporarios(base, op), ...lancs];
    } else if (op.metodo === 'PATCH' && id) {
      lancs = lancs.map((l) => (l.id === id ? { ...l, ...(op.corpo as Partial<Lancamento>), pendente: true } : l));
    } else if (op.metodo === 'DELETE' && id) {
      lancs = lancs.filter((l) => l.id !== id);
    }
  }
  lancs.sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
  return { ...base, lancamentos: lancs };
}

function criarTemporarios(base: Snapshot, op: OpFila): Lancamento[] {
  const c = op.corpo as Record<string, never> & {
    tipo: 'saida' | 'entrada'; valor: number; descricao?: string; categoria?: string; metodo?: string;
    cartao_id?: number; conta_id?: number; data?: string; parcelas?: number;
  };
  const metodo = c.metodo ?? (c.tipo === 'entrada' ? 'pix' : c.cartao_id ? 'credito' : base.padrao.metodo);
  const cartaoId = metodo === 'credito' ? c.cartao_id ?? base.padrao.cartao_id : null;
  const cartao = base.cartoes.find((x) => x.id === cartaoId);
  const contaId = metodo === 'credito' ? null
    : metodo === 'vale' ? (base.contas.find((x) => x.id === c.conta_id && x.tipo === 'beneficio') ?? base.contas.find((x) => x.tipo === 'beneficio'))?.id ?? null
    : c.conta_id ?? base.padrao.conta_id;
  const data = c.data ?? hojeSP();
  const n = c.parcelas && c.parcelas > 1 ? c.parcelas : 1;
  const out: Lancamento[] = [];
  for (let i = 1; i <= n; i++) {
    const di = somarMesesData(data, i - 1);
    out.push({
      id: (op.temp_id ?? -1) - (i - 1),
      data: di,
      competencia: cartao ? competenciaCredito(di, cartao) : di.slice(0, 7),
      descricao: c.descricao || (c.tipo === 'entrada' ? 'Entrada' : 'Gasto'),
      categoria: c.categoria || 'Outros',
      valor: n > 1 ? Math.round((c.valor / n) * 100) / 100 : c.valor,
      tipo: c.tipo,
      metodo,
      cartao_id: cartaoId,
      conta_id: contaId,
      origem: n > 1 ? 'parcela' : 'avulso',
      parcelamento_id: null,
      parcela_num: n > 1 ? i : null,
      parcela_total: n > 1 ? n : null,
      recorrente_id: null,
      observacao: null,
      criado_em: op.criado_em,
      pendente: true,
    });
  }
  return out;
}

export function ProvedorFinanc({ children }: { children: ReactNode }) {
  const [fase, setFase] = useState<Fase>({ tipo: 'iniciando' });
  const [base, setBase] = useState<Snapshot | null>(null);
  const [fila, setFila] = useState<OpFila[]>([]);
  const [perfil, setPerfil] = useState<PerfilLocal | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimaSync, setUltimaSync] = useState<string | null>(null);
  const [erroSync, setErroSync] = useState<string | null>(null);
  const filaRef = useRef<OpFila[]>([]);
  const sincRef = useRef<Promise<void> | null>(null);
  const perfilRef = useRef<PerfilLocal | null>(null);

  const snap = useMemo(() => (base ? aplicarFila(base, fila) : null), [base, fila]);

  const guardarFila = useCallback(async (f: OpFila[]) => {
    filaRef.current = f;
    setFila(f);
    await local.salvarFila(f);
  }, []);

  const guardarPerfil = useCallback(async (p: PerfilLocal) => {
    perfilRef.current = p;
    setPerfil(p);
    await local.salvarPerfil(p);
  }, []);

  const receberSnapshot = useCallback(async (s: Snapshot) => {
    setBase(s);
    setUltimaSync(new Date().toISOString());
    setErroSync(null);
    await local.salvarSnapshot(s);
  }, []);

  const tratarErroSessao = useCallback((e: unknown): boolean => {
    if (e instanceof ErroApi && e.status === 401) {
      setFase({ tipo: 'entrar', configurado: true, digitais: perfilRef.current?.digitais ?? 0 });
      return true;
    }
    if (e instanceof ErroApi && e.status === 423) {
      setFase({ tipo: 'bloqueado', digitais: perfilRef.current?.digitais ?? 0, offline: false });
      return true;
    }
    return false;
  }, []);

  const atualizarPerfil = useCallback(async () => {
    const est = await api<EstadoAuth>('GET', '/api/auth/estado');
    let chaves = perfilRef.current?.chaves ?? [];
    if (est.digitais > 0 && est.sessao && !est.sessao.bloqueada) {
      chaves = await buscarChavesLocais().catch(() => chaves);
    } else if (est.digitais === 0) {
      chaves = [];
    }
    await guardarPerfil({ bloqueio_min: est.sessao?.bloqueio_min ?? null, digitais: est.digitais, chaves });
  }, [guardarPerfil]);

  /** reenvia o que ficou na fila; para no primeiro erro de rede */
  const esvaziarFila = useCallback(async () => {
    let atual = [...filaRef.current];
    for (const op of [...atual]) {
      if (op.erro) continue;
      try {
        await api('' + op.metodo, `${op.caminho}${op.caminho.includes('?') ? '&' : '?'}snapshot=0`, op.corpo, { idem: op.id });
        atual = atual.filter((o) => o.id !== op.id);
        await guardarFila(atual);
      } catch (e) {
        if (e instanceof ErroApi && e.semRede) throw e;
        if (tratarErroSessao(e)) throw e;
        atual = atual.map((o) => (o.id === op.id ? { ...o, erro: (e as Error).message } : o));
        await guardarFila(atual);
      }
    }
  }, [guardarFila, tratarErroSessao]);

  const sincronizar = useCallback(async () => {
    if (sincRef.current) return sincRef.current;
    const p = (async () => {
      setSincronizando(true);
      try {
        if (filaRef.current.some((o) => !o.erro)) await esvaziarFila();
        const s = await api<Snapshot>('GET', '/api/snapshot');
        if (s) await receberSnapshot(s);
        setOnline(true);
      } catch (e) {
        if (e instanceof ErroApi && e.semRede) {
          setOnline(false);
          setErroSync('Sem conexão. Mostrando os dados salvos neste aparelho.');
        } else if (!tratarErroSessao(e)) {
          setErroSync((e as Error).message);
        }
      } finally {
        setSincronizando(false);
        sincRef.current = null;
      }
    })();
    sincRef.current = p;
    return p;
  }, [esvaziarFila, receberSnapshot, tratarErroSessao]);

  const ficarPronto = useCallback(async () => {
    marcarAtividade();
    setFase({ tipo: 'pronto' });
    await sincronizar();
    atualizarPerfil().catch(() => undefined);
  }, [sincronizar, atualizarPerfil]);

  // ---------------------------------------------------------------- início
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [s, f, p] = await Promise.all([local.snapshot(), local.fila(), local.perfil()]);
      if (!vivo) return;
      if (s) setBase(s);
      filaRef.current = f;
      setFila(f);
      perfilRef.current = p ?? null;
      setPerfil(p ?? null);

      const url = new URL(location.href);
      const token = url.pathname === '/configurar' ? url.searchParams.get('token') : null;
      if (token) {
        setFase({ tipo: 'configurar', token });
        return;
      }
      try {
        const est = await api<EstadoAuth>('GET', '/api/auth/estado');
        if (!vivo) return;
        const novoPerfil = { bloqueio_min: est.sessao?.bloqueio_min ?? null, digitais: est.digitais, chaves: p?.chaves ?? [] };
        await guardarPerfil(novoPerfil);
        if (!est.configurado) setFase({ tipo: 'entrar', configurado: false, digitais: 0 });
        else if (!est.sessao) setFase({ tipo: 'entrar', configurado: true, digitais: est.digitais });
        else if (est.sessao.bloqueada) setFase({ tipo: 'bloqueado', digitais: est.digitais, offline: false });
        else await ficarPronto();
      } catch (e) {
        if (!vivo) return;
        // sem internet: abre com os dados salvos (respeitando o bloqueio)
        setOnline(false);
        if (!s) {
          setFase({ tipo: 'entrar', configurado: true, digitais: p?.digitais ?? 0, semRede: true });
        } else if (p?.bloqueio_min && Date.now() - ultimaAtividade() > p.bloqueio_min * 60000) {
          // só bloqueia se passou do prazo de inatividade, igual ao que o servidor faria
          setFase({ tipo: 'bloqueado', digitais: p.digitais, offline: true });
        } else {
          marcarAtividade();
          setFase({ tipo: 'pronto' });
          setErroSync('Sem conexão. Mostrando os dados salvos neste aparelho.');
        }
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- rede e retorno ao app
  useEffect(() => {
    const voltou = () => {
      setOnline(true);
      if (fase.tipo === 'pronto') sincronizar();
    };
    const caiu = () => setOnline(false);
    window.addEventListener('online', voltou);
    window.addEventListener('offline', caiu);
    return () => {
      window.removeEventListener('online', voltou);
      window.removeEventListener('offline', caiu);
    };
  }, [fase.tipo, sincronizar]);

  const bloquearAgora = useCallback(() => {
    setFase({ tipo: 'bloqueado', digitais: perfilRef.current?.digitais ?? 0, offline: !navigator.onLine });
  }, []);

  // bloqueio automático por inatividade (o servidor aplica o mesmo prazo)
  useEffect(() => {
    if (fase.tipo !== 'pronto') return;
    const conferir = () => {
      const min = perfilRef.current?.bloqueio_min;
      if (!min) return;
      if (Date.now() - ultimaAtividade() > min * 60000) bloquearAgora();
    };
    let ultimaMarca = 0;
    const atividade = () => {
      const agora = Date.now();
      if (agora - ultimaMarca > 5000) {
        ultimaMarca = agora;
        marcarAtividade();
      }
    };
    const visivel = () => {
      if (document.visibilityState === 'visible') {
        conferir();
        if (perfilRef.current && fase.tipo === 'pronto') sincronizar();
      }
    };
    conferir();
    const t = window.setInterval(conferir, 15000);
    window.addEventListener('pointerdown', atividade, { passive: true });
    window.addEventListener('keydown', atividade);
    document.addEventListener('visibilitychange', visivel);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('pointerdown', atividade);
      window.removeEventListener('keydown', atividade);
      document.removeEventListener('visibilitychange', visivel);
    };
  }, [fase.tipo, bloquearAgora, sincronizar]);

  // ---------------------------------------------------------------- alterações
  const executar = useCallback(async <T,>(op: Operacao): Promise<{ resultado?: T; naFila?: boolean }> => {
    const tempMatch = op.caminho.match(/^\/api\/lancamentos\/(-\d+)/);
    if (tempMatch) {
      // mexendo num lançamento que ainda nem foi enviado: ajusta a fila
      const tempId = Number(tempMatch[1]);
      // parcelas criadas offline usam ids consecutivos a partir do temp_id da operação
      const alvo = filaRef.current.find((o) => o.temp_id !== undefined && tempId <= o.temp_id && tempId > o.temp_id - 100);
      if (alvo) {
        const nova = op.metodo === 'DELETE'
          ? filaRef.current.filter((o) => o.id !== alvo.id)
          : filaRef.current.map((o) => (o.id === alvo.id ? { ...o, corpo: { ...o.corpo, ...op.corpo }, rotulo: op.rotulo } : o));
        await guardarFila(nova);
        return { naFila: true };
      }
    }
    try {
      const r = await api<RespostaMutacao<T>>(op.metodo, op.caminho, op.corpo, { idem: op.metodo === 'POST' ? novaChave() : undefined });
      if (r.snapshot) await receberSnapshot(r.snapshot);
      setOnline(true);
      return { resultado: r.resultado };
    } catch (e) {
      if (e instanceof ErroApi && e.semRede && op.podeEsperar) {
        setOnline(false);
        const item: OpFila = {
          id: novaChave(),
          criado_em: new Date().toISOString(),
          metodo: op.metodo === 'PUT' ? 'PATCH' : op.metodo,
          caminho: op.caminho,
          corpo: op.corpo,
          rotulo: op.rotulo,
          temp_id: op.metodo === 'POST' ? -Date.now() * 100 : undefined,
        };
        await guardarFila([...filaRef.current, item]);
        return { naFila: true };
      }
      tratarErroSessao(e);
      throw e;
    }
  }, [guardarFila, receberSnapshot, tratarErroSessao]);

  // ---------------------------------------------------------------- entrar, desbloquear, sair
  // depois de entrar, o app começa sempre pelo início
  const irParaInicio = () => {
    history.replaceState(null, '', '/');
    window.dispatchEvent(new Event('financ:rota'));
  };

  const entrarComSenha = useCallback(async (senha: string) => {
    await api('POST', '/api/auth/login', { senha });
    irParaInicio();
    await ficarPronto();
  }, [ficarPronto]);

  const entrarComDigital = useCallback(async () => {
    await usarDigital('entrar');
    irParaInicio();
    await ficarPronto();
  }, [ficarPronto]);

  const desbloquearComDigital = useCallback(async () => {
    if (!navigator.onLine || (fase.tipo === 'bloqueado' && fase.offline)) {
      const ok = await desbloquearSemInternet(perfilRef.current?.chaves ?? []).catch(() => false);
      if (!ok) throw new Error('A digital não foi confirmada.');
      marcarAtividade();
      setFase({ tipo: 'pronto' });
      sincronizar();
      return;
    }
    try {
      await usarDigital('desbloquear');
    } catch (e) {
      if (e instanceof ErroApi && e.semRede) {
        const ok = await desbloquearSemInternet(perfilRef.current?.chaves ?? []).catch(() => false);
        if (!ok) throw new Error('A digital não foi confirmada.');
        marcarAtividade();
        setFase({ tipo: 'pronto' });
        return;
      }
      if (e instanceof ErroApi && e.status === 401 && e.codigo === 'sem_sessao') {
        setFase({ tipo: 'entrar', configurado: true, digitais: perfilRef.current?.digitais ?? 0 });
      }
      throw e;
    }
    await ficarPronto();
  }, [fase, ficarPronto, sincronizar]);

  const desbloquearComSenha = useCallback(async (senha: string) => {
    try {
      await api('POST', '/api/auth/desbloquear', { senha });
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401 && e.codigo === 'sem_sessao') {
        setFase({ tipo: 'entrar', configurado: true, digitais: perfilRef.current?.digitais ?? 0 });
      }
      throw e;
    }
    await ficarPronto();
  }, [ficarPronto]);

  const configurarSenha = useCallback(async (token: string, senha: string) => {
    await api('POST', '/api/auth/setup', { token, senha });
    history.replaceState(null, '', '/');
    await ficarPronto();
  }, [ficarPronto]);

  const sair = useCallback(async () => {
    await api('POST', '/api/auth/sair', {}).catch(() => undefined);
    await local.apagarTudo();
    setBase(null);
    filaRef.current = [];
    setFila([]);
    perfilRef.current = null;
    setPerfil(null);
    const est = await api<EstadoAuth>('GET', '/api/auth/estado').catch(() => null);
    setFase({ tipo: 'entrar', configurado: true, digitais: est?.digitais ?? 0 });
  }, []);

  const descartarDaFila = useCallback(async (id: string) => {
    await guardarFila(filaRef.current.filter((o) => o.id !== id));
  }, [guardarFila]);

  const apagarDadosDoAparelho = useCallback(async () => {
    await local.apagarSnapshot();
    setBase(null);
    await sincronizar();
  }, [sincronizar]);

  const valor: Ctx = {
    fase, snap, online, sincronizando, ultimaSync, erroSync, fila, perfil,
    sincronizar, executar, entrarComSenha, entrarComDigital, desbloquearComDigital, desbloquearComSenha,
    configurarSenha, sair, bloquearAgora, atualizarPerfil, descartarDaFila, apagarDadosDoAparelho,
  };
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
