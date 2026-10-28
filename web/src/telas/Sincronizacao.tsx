import { ArrowLeft, CloudOff, RefreshCw, Trash2 } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { voltar, useFolhas } from '../lib/navegacao';
import { dataHora } from '../lib/formato';
import { Confirmar, Vazio } from '../ui/base';

export function Sincronizacao() {
  const { online, sincronizando, sincronizar, ultimaSync, erroSync, fila, descartarDaFila, apagarDadosDoAparelho, snap } = useFinanc();
  const { abrir } = useFolhas();
  return (
    <>
      <header className="topo">
        <button type="button" className="icone-btn" aria-label="Voltar" onClick={() => voltar('/ajustes')}><ArrowLeft size={20} /></button>
        <h1>Sincronização</h1>
      </header>
      <div className="grupo">
        <div className="linha sem-icone" style={{ gridTemplateColumns: '1fr auto' }}>
          <span className="linha-texto">
            <span className="linha-titulo" style={{ display: 'block' }}>{online ? 'Conectado' : 'Sem conexão'}</span>
            <span className="linha-sub" style={{ display: 'block', whiteSpace: 'normal' }}>
              {ultimaSync ? `Última atualização ${dataHora(ultimaSync)}` : snap ? `Dados salvos de ${dataHora(snap.gerado_em)}` : 'Ainda sem dados'}
            </span>
          </span>
          <button type="button" className="btn sec peq" onClick={() => sincronizar()} disabled={sincronizando}>
            <RefreshCw className={sincronizando ? 'girando' : ''} aria-hidden="true" /> Atualizar
          </button>
        </div>
      </div>
      {erroSync && <div className="faixa alerta" style={{ marginTop: 12 }}><CloudOff aria-hidden="true" /> {erroSync}</div>}

      <section className="secao">
        <div className="secao-cab"><h2>Aguardando envio</h2></div>
        <div className="grupo">
          {fila.length === 0 && <Vazio titulo="Nada pendente" texto="Lançamentos feitos sem internet aparecem aqui até serem enviados." />}
          {fila.map((o) => (
            <div className="linha sem-icone" key={o.id} style={{ gridTemplateColumns: '1fr auto' }}>
              <span className="linha-texto">
                <span className="linha-titulo" style={{ display: 'block' }}>{o.rotulo}</span>
                <span className="linha-sub" style={{ display: 'block', whiteSpace: 'normal', color: o.erro ? 'var(--bad)' : undefined }}>
                  {o.erro ? `Não enviado: ${o.erro}` : `Feito ${dataHora(o.criado_em)}`}
                </span>
              </span>
              <button type="button" className="icone-btn" aria-label={`Descartar ${o.rotulo}`} onClick={() => abrir('Descartar', (f) => (
                <Confirmar fechar={f} perigo rotuloAcao="Descartar" texto={`“${o.rotulo}” não será enviado.`} acao={() => descartarDaFila(o.id)} />
              ))}>
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="secao">
        <div className="secao-cab"><h2>Dados neste aparelho</h2></div>
        <p className="nota" style={{ margin: '0 2px 12px' }}>
          O app guarda o último retrato das suas finanças para abrir sem internet. Apagar não mexe em nada no servidor.
        </p>
        <button type="button" className="btn sec cheio" onClick={() => abrir('Apagar dados salvos', (f) => (
          <Confirmar fechar={f} rotuloAcao="Apagar e baixar de novo" texto="O retrato salvo neste aparelho é apagado e baixado de novo do servidor." acao={apagarDadosDoAparelho} />
        ))}>
          Baixar tudo de novo
        </button>
      </section>
    </>
  );
}
