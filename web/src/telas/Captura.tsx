import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { dataHora } from '../lib/formato';
import { voltar, useFolhas } from '../lib/navegacao';
import { Confirmar, useTorrada, Vazio } from '../ui/base';

type Capturada = { id: string; recebido_em: string; quando: string | null; app: string | null; titulo: string | null; texto: string | null; encaminhado: boolean };
type Estado = { pareado: boolean; ultimos_7_dias: number; aguardando_repasse: number; ultimas: Capturada[] };

const APK = 'https://github.com/kelven-cardoso/financ-app/releases/latest/download/financ.apk';
// abre a tela nativa de configuração quando o Financ está instalado pelo APK
const TELA_NATIVA = 'intent://captura#Intent;scheme=financ;package=tech.kelvencardoso.financ;end';

function chavePendente(): string | null {
  try {
    return sessionStorage.getItem('financ.parear');
  } catch {
    return null;
  }
}

export function Captura() {
  const torrada = useTorrada();
  const { abrir } = useFolhas();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState<string | null>(chavePendente);
  const [ocupado, setOcupado] = useState(false);
  const android = /Android/i.test(navigator.userAgent);

  const carregar = useCallback(async () => {
    try {
      setEstado(await api<Estado>('GET', '/api/captura'));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const parear = async () => {
    if (!pendente) return;
    setOcupado(true);
    try {
      await api('POST', '/api/captura/parear', { chave: pendente });
      try {
        sessionStorage.removeItem('financ.parear');
      } catch {
        /* nada a limpar */
      }
      setPendente(null);
      torrada('Aparelho pareado. Volte ao app e toque em Testar a conexão.');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  };

  const desparear = async () => {
    await api('POST', '/api/captura/desparear', {});
    torrada('Pareamento desfeito');
    await carregar();
  };

  return (
    <>
      <header className="topo">
        <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar('/ajustes')}><ArrowLeft size={20} /></button>
        <h1>Captura de notificações</h1>
      </header>
      <p className="nota" style={{ margin: '0 2px 12px' }}>
        O app Android do Financ lê os avisos dos apps de banco (compra aprovada, Pix) e o assistente pergunta no WhatsApp se pode lançar.
        Nada é lançado sem o seu sim. Só segue o que fala de valor; códigos e senhas são ignorados.
      </p>
      {erro && <div className="faixa alerta" role="alert" style={{ marginBottom: 12 }}><CircleAlert aria-hidden="true" /> <span>{erro}</span></div>}

      {pendente && (
        <div className="grupo" style={{ marginBottom: 14 }}>
          <div className="linha sem-icone" style={{ gridTemplateColumns: '1fr' }}>
            <span className="linha-texto">
              <span className="linha-titulo" style={{ display: 'block' }}>Parear este aparelho</span>
              <span className="linha-sub" style={{ display: 'block', whiteSpace: 'normal' }}>
                O app Android pediu para enviar as notificações deste celular.{estado?.pareado ? ' O aparelho pareado antes deixa de valer.' : ''}
              </span>
            </span>
          </div>
          <div style={{ padding: '0 14px 14px' }}>
            <button type="button" className="btn cheio" onClick={parear} disabled={ocupado}>Parear</button>
          </div>
        </div>
      )}

      <div className="grupo">
        <div className="linha sem-icone" style={{ gridTemplateColumns: '1fr auto' }}>
          <span className="linha-texto">
            <span className="linha-titulo" style={{ display: 'block' }}>
              {estado === null ? 'Carregando…' : estado.pareado ? 'Aparelho pareado' : 'Nenhum aparelho pareado'}
            </span>
            <span className="linha-sub" style={{ display: 'block', whiteSpace: 'normal' }}>
              {estado?.pareado
                ? `${estado.ultimos_7_dias} ${estado.ultimos_7_dias === 1 ? 'aviso recebido' : 'avisos recebidos'} em 7 dias${estado.aguardando_repasse ? `, ${estado.aguardando_repasse} aguardando o assistente` : ''}`
                : 'Instale o app Android e toque em Parear com o Financ.'}
            </span>
          </span>
          {estado?.pareado ? <CheckCircle2 color="var(--good)" aria-hidden="true" /> : <Smartphone color="var(--ink-3)" aria-hidden="true" />}
        </div>
      </div>

      {android && (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <a className="btn sec cheio" href={TELA_NATIVA}>Abrir as configurações da captura</a>
          <a className="btn sec cheio" href={APK} rel="noopener">Baixar o app Android (APK)</a>
        </div>
      )}

      <section className="secao">
        <div className="secao-cab"><h2>Últimos avisos</h2></div>
        <div className="grupo">
          {estado && estado.ultimas.length === 0 && <Vazio titulo="Nada capturado ainda" texto="Depois de uma compra ou Pix, o aviso do banco aparece aqui." />}
          {estado?.ultimas.map((c) => (
            <div className="linha sem-icone" key={c.id} style={{ gridTemplateColumns: '1fr' }}>
              <span className="linha-texto">
                <span className="linha-titulo" style={{ display: 'block' }}>{c.titulo || c.app || 'Aviso'}</span>
                <span className="linha-sub" style={{ display: 'block', whiteSpace: 'normal' }}>{c.texto}</span>
                <span className="linha-sub" style={{ display: 'block' }}>
                  {dataHora(c.quando ?? c.recebido_em)}{c.app ? ` · ${c.app}` : ''}{c.encaminhado ? '' : ' · aguardando o assistente'}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {estado?.pareado && (
        <button type="button" className="btn perigo cheio" style={{ marginTop: 16 }} onClick={() => abrir('Desfazer o pareamento', (f) => (
          <Confirmar fechar={f} perigo rotuloAcao="Desfazer" texto="O aparelho pareado deixa de enviar notificações até ser pareado de novo." acao={desparear} />
        ))}>
          Desfazer o pareamento
        </button>
      )}
    </>
  );
}
