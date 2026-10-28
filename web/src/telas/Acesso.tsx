import { useEffect, useState, type FormEvent } from 'react';
import { Fingerprint, KeyRound, LockKeyhole, WifiOff } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { digitalDisponivel } from '../lib/digital';

function Marca() {
  return (
    <div className="acesso-marca">
      <img src="/icon-192.png" alt="" />
      <strong style={{ fontSize: 20 }}>Financ</strong>
    </div>
  );
}

function mensagemDigital(e: unknown): string {
  const nome = (e as { name?: string })?.name;
  if (nome === 'NotAllowedError' || nome === 'AbortError') return 'A leitura da digital foi cancelada.';
  return (e as Error)?.message || 'Não foi possível usar a digital.';
}

export function Iniciando() {
  return (
    <div className="acesso" aria-busy="true">
      <div className="acesso-caixa" style={{ justifyItems: 'center' }}>
        <img src="/icon-192.png" alt="Financ" width={56} height={56} style={{ borderRadius: 15 }} />
      </div>
    </div>
  );
}

export function Configurar({ token }: { token: string }) {
  const { configurarSenha } = useFinanc();
  const [senha, setSenha] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (senha !== conf) return setErro('As duas senhas não são iguais.');
    setOcupado(true);
    try {
      await configurarSenha(token, senha);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };

  return (
    <div className="acesso">
      <form className="acesso-caixa" onSubmit={enviar}>
        <Marca />
        <div>
          <h1>Crie sua senha</h1>
          <p>Só você usa este app, então não existe cadastro: esta senha entra no computador e no celular. Depois dá para ativar a digital no celular.</p>
        </div>
        {erro && <div className="erro-form" role="alert">{erro}</div>}
        <div className="campo">
          <label htmlFor="nova">Senha</label>
          <input id="nova" className="entrada" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={10} />
          <span className="dica">Pelo menos 10 caracteres, misturando letras e números (ou uma frase longa).</span>
        </div>
        <div className="campo">
          <label htmlFor="conf">Repita a senha</label>
          <input id="conf" className="entrada" type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} required />
        </div>
        <button className="btn cheio" disabled={ocupado || senha.length < 10}>Criar senha e entrar</button>
      </form>
    </div>
  );
}

export function Entrar({ configurado, digitais, semRede }: { configurado: boolean; digitais: number; semRede?: boolean }) {
  const { entrarComSenha, entrarComDigital } = useFinanc();
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [temDigital, setTemDigital] = useState(false);

  useEffect(() => {
    digitalDisponivel().then(setTemDigital);
  }, []);

  if (!configurado) {
    return (
      <div className="acesso">
        <div className="acesso-caixa">
          <Marca />
          <h1>Falta criar a senha</h1>
          <p>Abra o link de configuração que você recebeu para criar a senha de acesso.</p>
        </div>
      </div>
    );
  }

  const comSenha = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await entrarComSenha(senha);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };

  const comDigital = async () => {
    setErro(null);
    setOcupado(true);
    try {
      await entrarComDigital();
    } catch (err) {
      setErro(mensagemDigital(err));
      setOcupado(false);
    }
  };

  return (
    <div className="acesso">
      <form className="acesso-caixa" onSubmit={comSenha}>
        <Marca />
        <h1>Entrar</h1>
        {semRede && (
          <div className="faixa alerta"><WifiOff aria-hidden="true" /> Sem conexão. Para entrar pela primeira vez neste aparelho é preciso internet.</div>
        )}
        {erro && <div className="erro-form" role="alert">{erro}</div>}
        {digitais > 0 && temDigital && (
          <button type="button" className="btn tinta cheio" onClick={comDigital} disabled={ocupado}>
            <Fingerprint aria-hidden="true" /> Entrar com a digital
          </button>
        )}
        <div className="campo" style={{ marginBottom: 0 }}>
          <label htmlFor="senha">Senha</label>
          <input id="senha" className="entrada" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </div>
        <button className={`btn cheio ${digitais > 0 && temDigital ? 'sec' : ''}`} disabled={ocupado || !senha}>
          <KeyRound aria-hidden="true" /> Entrar com a senha
        </button>
      </form>
    </div>
  );
}

export function Bloqueado({ digitais, offline }: { digitais: number; offline: boolean }) {
  const { desbloquearComDigital, desbloquearComSenha, perfil } = useFinanc();
  const [usarSenha, setUsarSenha] = useState(false);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [temDigital, setTemDigital] = useState<boolean | null>(null);
  const podeDigital = digitais > 0 && temDigital && (!offline || (perfil?.chaves.length ?? 0) > 0);

  useEffect(() => {
    digitalDisponivel().then(setTemDigital);
  }, []);

  const digital = async (automatico = false) => {
    setErro(null);
    setOcupado(true);
    try {
      await desbloquearComDigital();
    } catch (err) {
      // na tentativa automática, cancelar não é erro: o botão continua ali
      if (!automatico) setErro(mensagemDigital(err));
      setOcupado(false);
    }
  };

  // pede a digital assim que a tela aparece (como nos apps de banco)
  useEffect(() => {
    if (podeDigital && !usarSenha && document.visibilityState === 'visible') digital(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [podeDigital]);

  const comSenha = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await desbloquearComSenha(senha);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  };

  return (
    <div className="acesso">
      <div className="acesso-caixa">
        <div className="cadeado">
          {podeDigital && !usarSenha ? (
            <button type="button" className="digital-btn" onClick={() => digital()} disabled={ocupado} aria-label="Desbloquear com a digital">
              <Fingerprint aria-hidden="true" />
            </button>
          ) : (
            <span className="digital-btn" aria-hidden="true"><LockKeyhole /></span>
          )}
          <h1>Financ bloqueado</h1>
          <p>{podeDigital && !usarSenha ? 'Toque para desbloquear com a digital.' : offline ? 'Sem conexão: o desbloqueio com senha precisa de internet.' : 'Digite a senha para continuar.'}</p>
        </div>
        {erro && <div className="erro-form" role="alert">{erro}</div>}
        {(usarSenha || !podeDigital) && !offline && (
          <form onSubmit={comSenha} style={{ display: 'grid', gap: 12 }}>
            <div className="campo" style={{ marginBottom: 0 }}>
              <label htmlFor="senha-bloq">Senha</label>
              <input id="senha-bloq" className="entrada" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
            </div>
            <button className="btn cheio" disabled={ocupado || !senha}>Desbloquear</button>
          </form>
        )}
        {podeDigital && (
          <button type="button" className="btn fantasma" onClick={() => setUsarSenha(!usarSenha)}>
            {usarSenha ? 'Usar a digital' : 'Usar a senha'}
          </button>
        )}
      </div>
    </div>
  );
}
