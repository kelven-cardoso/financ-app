import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Fingerprint, KeyRound, Laptop, Pencil, Smartphone, Trash2, XCircle } from 'lucide-react';
import { api, ErroApi } from '../lib/api';
import { useFinanc } from '../lib/estado';
import { voltar, useFolhas } from '../lib/navegacao';
import { cadastrarDigital, descreverNavegador, digitalDisponivel, nomeDoAparelho } from '../lib/digital';
import { dataHora } from '../lib/formato';
import { Confirmar, CorpoFolha, RodapeFolha, useTorrada } from '../ui/base';

type Dados = {
  sessao_atual: { bloqueio_min: number | null; metodo: string; digital_vinculada: string | null };
  sessoes: { id: string; criado_em: string; ultimo_uso: string; metodo: string; user_agent: string | null; ip: string | null; bloqueio_min: number | null; atual: boolean; digital: string | null }[];
  digitais: { id: string; nome: string; criado_em: string; ultimo_uso: string | null; tipo_dispositivo: string | null; sincronizada: boolean | null }[];
  eventos: { criado_em: string; tipo: string; ok: boolean; ip: string | null; user_agent: string | null; detalhe: Record<string, unknown> | null }[];
  senha_alterada_em: string | null;
};

const NOMES_EVENTO: Record<string, string> = {
  entrada_senha: 'Entrada com senha',
  entrada_digital: 'Entrada com digital',
  desbloqueio_digital: 'Desbloqueio com digital',
  desbloqueio_senha: 'Desbloqueio com senha',
  senha_criada: 'Senha criada pelo link',
  senha_alterada: 'Senha alterada',
  digital_adicionada: 'Digital ativada',
  digital_removida: 'Digital removida',
  sessao_encerrada: 'Acesso encerrado',
  sessoes_encerradas: 'Outros acessos encerrados',
  bloqueio_alterado: 'Bloqueio automático alterado',
};

const OPCOES_BLOQUEIO: { v: number | null; rotulo: string }[] = [
  { v: null, rotulo: 'Desligado' },
  { v: 1, rotulo: '1 min' },
  { v: 5, rotulo: '5 min' },
  { v: 15, rotulo: '15 min' },
  { v: 60, rotulo: '1 hora' },
];

function FormNomeDigital({ fechar, aoConcluir }: { fechar: () => void; aoConcluir: () => void }) {
  const [nome, setNome] = useState(nomeDoAparelho() || 'Este aparelho');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const torrada = useTorrada();
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      await cadastrarDigital(nome.trim() || 'Aparelho');
      torrada('Digital ativada neste aparelho');
      aoConcluir();
      fechar();
    } catch (err) {
      const n = (err as { name?: string }).name;
      setErro(n === 'NotAllowedError' ? 'O cadastro da digital foi cancelado.' : n === 'InvalidStateError' ? 'Este aparelho já tem uma digital cadastrada aqui.' : (err as Error).message);
      setOcupado(false);
    }
  };
  return (
    <form onSubmit={salvar} style={{ display: 'contents' }}>
      <CorpoFolha>
        {erro && <div className="erro-form" role="alert">{erro}</div>}
        <p className="nota" style={{ marginTop: 0 }}>O aparelho vai pedir sua digital (ou o rosto). Ela nunca sai do aparelho: o Financ guarda só uma chave pública.</p>
        <div className="campo">
          <label htmlFor="nome-digital">Nome deste aparelho</label>
          <input id="nome-digital" className="entrada" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} />
        </div>
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}><Fingerprint aria-hidden="true" /> Ativar digital</button></RodapeFolha>
    </form>
  );
}

function FormRenomear({ fechar, id, atual, aoConcluir }: { fechar: () => void; id: string; atual: string; aoConcluir: () => void }) {
  const [nome, setNome] = useState(atual);
  const [ocupado, setOcupado] = useState(false);
  return (
    <form style={{ display: 'contents' }} onSubmit={async (e) => {
      e.preventDefault();
      setOcupado(true);
      await api('PATCH', `/api/seguranca/digitais/${encodeURIComponent(id)}`, { nome: nome.trim() || atual }).catch(() => undefined);
      aoConcluir();
      fechar();
    }}>
      <CorpoFolha>
        <div className="campo">
          <label htmlFor="ren">Nome</label>
          <input id="ren" className="entrada" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} />
        </div>
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>Salvar</button></RodapeFolha>
    </form>
  );
}

function FormSenha({ fechar }: { fechar: () => void }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const torrada = useTorrada();
  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (nova !== conf) return setErro('As duas senhas novas não são iguais.');
    setOcupado(true);
    try {
      await api('POST', '/api/seguranca/senha', { atual, nova });
      torrada('Senha alterada. Os outros aparelhos vão pedir para entrar de novo.');
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
        <div className="campo">
          <label htmlFor="s-atual">Senha atual</label>
          <input id="s-atual" className="entrada" type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} required />
        </div>
        <div className="campo">
          <label htmlFor="s-nova">Nova senha</label>
          <input id="s-nova" className="entrada" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} required minLength={10} />
          <span className="dica">Pelo menos 10 caracteres, misturando letras e números.</span>
        </div>
        <div className="campo">
          <label htmlFor="s-conf">Repita a nova senha</label>
          <input id="s-conf" className="entrada" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} required />
        </div>
      </CorpoFolha>
      <RodapeFolha><button className="btn cheio" disabled={ocupado}>Alterar senha</button></RodapeFolha>
    </form>
  );
}

export function Seguranca() {
  const { atualizarPerfil, online } = useFinanc();
  const { abrir } = useFolhas();
  const torrada = useTorrada();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [suporta, setSuporta] = useState<boolean | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDados(await api<Dados>('GET', '/api/seguranca'));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi && e.semRede ? 'Segurança precisa de internet.' : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    carregar();
    digitalDisponivel().then(setSuporta);
  }, [carregar, online]);

  const depois = async () => {
    await carregar();
    await atualizarPerfil().catch(() => undefined);
  };

  const mudarBloqueio = async (v: number | null) => {
    try {
      await api('PUT', '/api/seguranca/bloqueio', { minutos: v });
      await depois();
      torrada(v ? `O app bloqueia depois de ${v === 60 ? '1 hora' : `${v} min`} sem uso` : 'Bloqueio automático desligado');
    } catch (e) {
      torrada((e as Error).message, true);
    }
  };

  const atual = dados?.sessoes.find((s) => s.atual);

  return (
    <>
      <header className="topo">
        <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar('/ajustes')}><ArrowLeft size={20} /></button>
        <h1>Segurança</h1>
      </header>
      {erro && <div className="faixa alerta">{erro}</div>}
      {!dados && !erro && <p className="nota">Carregando…</p>}
      {dados && (
        <>
          <section aria-label="Digital">
            <div className="secao-cab"><h2>Digital</h2></div>
            {suporta === false && <p className="nota" style={{ margin: '0 2px 10px' }}>Este navegador não oferece digital. No celular, use o app instalado pelo Chrome ou Safari.</p>}
            {suporta && !dados.sessao_atual.digital_vinculada && (
              <div className="grupo" style={{ padding: 16, display: 'grid', gap: 12, marginBottom: 12 }}>
                <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="linha-icone" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}><Fingerprint /></span>
                  <span>Entre e desbloqueie o app com a digital deste aparelho.</span>
                </span>
                <button type="button" className="btn" onClick={() => abrir('Ativar digital', (f) => <FormNomeDigital fechar={f} aoConcluir={depois} />)}>
                  <Fingerprint aria-hidden="true" /> Ativar digital neste aparelho
                </button>
              </div>
            )}
            <div className="grupo">
              {dados.digitais.length === 0 && <p className="nota" style={{ margin: 0, padding: '14px 16px' }}>Nenhuma digital cadastrada ainda.</p>}
              {dados.digitais.map((d) => (
                <div className="linha" key={d.id}>
                  <span className="linha-icone"><Fingerprint /></span>
                  <span className="linha-texto">
                    <span className="linha-titulo" style={{ display: 'block' }}>{d.nome}{dados.sessao_atual.digital_vinculada === d.id ? ' (este aparelho)' : ''}</span>
                    <span className="linha-sub" style={{ display: 'block' }}>{d.ultimo_uso ? `Usada ${dataHora(d.ultimo_uso)}` : `Cadastrada ${dataHora(d.criado_em)}`}</span>
                  </span>
                  <span style={{ display: 'flex' }}>
                    <button type="button" className="icone-btn" aria-label={`Renomear ${d.nome}`} onClick={() => abrir('Renomear digital', (f) => <FormRenomear fechar={f} id={d.id} atual={d.nome} aoConcluir={depois} />)}><Pencil size={17} /></button>
                    <button type="button" className="icone-btn" aria-label={`Remover ${d.nome}`} onClick={() => abrir('Remover digital', (f) => (
                      <Confirmar fechar={f} perigo rotuloAcao="Remover" texto={`${d.nome} não vai mais entrar nem desbloquear com a digital.`}
                        acao={async () => { await api('DELETE', `/api/seguranca/digitais/${encodeURIComponent(d.id)}`); await depois(); }} />
                    ))}><Trash2 size={17} /></button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="secao" aria-label="Bloqueio automático">
            <div className="secao-cab"><h2>Bloqueio automático</h2></div>
            <div className="chips">
              {OPCOES_BLOQUEIO.map((o) => (
                <button key={o.rotulo} type="button" className="chip" aria-pressed={(dados.sessao_atual.bloqueio_min ?? null) === o.v} onClick={() => mudarBloqueio(o.v)}>{o.rotulo}</button>
              ))}
            </div>
            <p className="nota" style={{ margin: '8px 2px 0' }}>Neste aparelho, depois desse tempo sem uso o app pede a digital ou a senha.</p>
          </section>

          <section className="secao" aria-label="Senha">
            <div className="secao-cab"><h2>Senha</h2></div>
            <div className="grupo">
              <button type="button" className="linha" onClick={() => abrir('Alterar senha', (f) => <FormSenha fechar={f} />)}>
                <span className="linha-icone"><KeyRound /></span>
                <span className="linha-texto">
                  <span className="linha-titulo" style={{ display: 'block' }}>Alterar senha</span>
                  <span className="linha-sub" style={{ display: 'block' }}>{dados.senha_alterada_em ? `Última troca ${dataHora(dados.senha_alterada_em)}` : ''}</span>
                </span>
                <span />
              </button>
            </div>
          </section>

          <section className="secao" aria-label="Aparelhos com acesso">
            <div className="secao-cab">
              <h2>Aparelhos com acesso</h2>
              {dados.sessoes.length > 1 && (
                <button type="button" className="link" onClick={() => abrir('Encerrar outros acessos', (f) => (
                  <Confirmar fechar={f} perigo rotuloAcao="Encerrar" texto="Todos os outros aparelhos vão precisar entrar de novo."
                    acao={async () => { await api('POST', '/api/seguranca/sessoes/encerrar-outras', {}); await depois(); }} />
                ))}>Encerrar os outros</button>
              )}
            </div>
            <div className="grupo">
              {[...(atual ? [atual] : []), ...dados.sessoes.filter((s) => !s.atual)].map((s) => {
                const movel = /Android|iPhone|iPad/.test(s.user_agent ?? '');
                return (
                  <div className="linha" key={s.id}>
                    <span className="linha-icone">{movel ? <Smartphone /> : <Laptop />}</span>
                    <span className="linha-texto">
                      <span className="linha-titulo" style={{ display: 'block' }}>{descreverNavegador(s.user_agent)}{s.atual ? ' (este)' : ''}</span>
                      <span className="linha-sub" style={{ display: 'block' }}>
                        {s.metodo === 'digital' ? 'Com digital' : 'Com senha'}, usado {dataHora(s.ultimo_uso)}{s.ip ? `, IP ${s.ip}` : ''}
                      </span>
                    </span>
                    {!s.atual ? (
                      <button type="button" className="btn fantasma peq" onClick={() => abrir('Encerrar acesso', (f) => (
                        <Confirmar fechar={f} perigo rotuloAcao="Encerrar" texto={`${descreverNavegador(s.user_agent)} vai precisar entrar de novo.`}
                          acao={async () => { await api('DELETE', `/api/seguranca/sessoes/${s.id}`); await depois(); }} />
                      ))}>Encerrar</button>
                    ) : <span />}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="secao" aria-label="Atividade recente">
            <div className="secao-cab"><h2>Atividade recente</h2></div>
            <div className="grupo">
              {dados.eventos.slice(0, 20).map((e, i) => (
                <div className="linha" key={i}>
                  <span className={`linha-icone ${e.ok ? 'evento-ok' : 'evento-falha'}`}>{e.ok ? <CheckCircle2 /> : <XCircle />}</span>
                  <span className="linha-texto">
                    <span className="linha-titulo" style={{ display: 'block' }}>{NOMES_EVENTO[e.tipo] ?? e.tipo}{e.ok ? '' : ' (falhou)'}</span>
                    <span className="linha-sub" style={{ display: 'block' }}>{dataHora(e.criado_em)}, {descreverNavegador(e.user_agent)}</span>
                  </span>
                  <span />
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
