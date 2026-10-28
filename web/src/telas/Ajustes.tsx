import { useState } from 'react';
import { CalendarRange, ChevronRight, CloudCog, Download, Info, LogOut, MoonStar, ShieldCheck, Target } from 'lucide-react';
import { useFinanc } from '../lib/estado';
import { ir, useFolhas } from '../lib/navegacao';
import { preferencia, salvarPreferencia } from '../lib/local';
import { dataHora } from '../lib/formato';
import { useInstalacao } from '../lib/instalar';
import { Confirmar, CorpoFolha, Segmentado } from '../ui/base';

function aplicarTema(t: string) {
  salvarPreferencia('tema', t);
  if (t === 'claro') document.documentElement.dataset.theme = 'light';
  else if (t === 'escuro') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

function Item({ icone, titulo, sub, aoClicar }: { icone: React.ReactNode; titulo: string; sub?: string; aoClicar: () => void }) {
  return (
    <button type="button" className="linha" onClick={aoClicar}>
      <span className="linha-icone">{icone}</span>
      <span className="linha-texto">
        <span className="linha-titulo" style={{ display: 'block' }}>{titulo}</span>
        {sub && <span className="linha-sub" style={{ display: 'block' }}>{sub}</span>}
      </span>
      <ChevronRight size={18} color="var(--ink-3)" aria-hidden="true" />
    </button>
  );
}

export function Ajustes() {
  const { snap, ultimaSync, fila, sair, perfil } = useFinanc();
  const { abrir } = useFolhas();
  const [tema, setTema] = useState(preferencia('tema', 'sistema'));
  const fixas = snap?.recorrentes.filter((r) => r.ativo).length ?? 0;
  const orc = snap?.orcamentos_cadastro.length ?? 0;
  const pend = fila.length;
  const inst = useInstalacao();
  return (
    <>
      <header className="topo"><h1>Ajustes</h1></header>
      {inst.podeInstalar && (
        <div className="faixa">
          <Download aria-hidden="true" />
          <span>Instale o Financ para abrir como app, até sem internet.</span>
          <button type="button" className="btn peq" onClick={() => inst.instalar()}>Instalar</button>
        </div>
      )}
      {inst.dicaIos && (
        <div className="faixa">
          <Download aria-hidden="true" />
          <span>Para instalar no iPhone: botão Compartilhar e depois Adicionar à Tela de Início.</span>
        </div>
      )}
      <div className="grupo">
        <Item icone={<CalendarRange />} titulo="Contas e receitas fixas" sub={`${fixas} ativas`} aoClicar={() => ir('/ajustes/fixas')} />
        <Item icone={<Target />} titulo="Orçamentos" sub={orc ? `${orc} por mês` : 'Nenhum'} aoClicar={() => ir('/ajustes/orcamentos')} />
      </div>
      <section className="secao">
        <div className="grupo">
          <Item icone={<ShieldCheck />} titulo="Segurança" sub={perfil?.digitais ? 'Digital ativa, sessões e senha' : 'Digital, sessões e senha'} aoClicar={() => ir('/ajustes/seguranca')} />
          <Item icone={<CloudCog />} titulo="Sincronização" sub={pend ? `${pend} aguardando envio` : ultimaSync ? `Atualizado ${dataHora(ultimaSync)}` : 'Dados salvos neste aparelho'} aoClicar={() => ir('/ajustes/sincronizacao')} />
        </div>
      </section>
      <section className="secao">
        <div className="secao-cab"><h2><MoonStar size={16} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Aparência</h2></div>
        <Segmentado rotulo="Tema" valor={tema} aoMudar={(t) => { setTema(t); aplicarTema(t); }}
          opcoes={[{ valor: 'sistema', rotulo: 'Automático' }, { valor: 'claro', rotulo: 'Claro' }, { valor: 'escuro', rotulo: 'Escuro' }]} />
      </section>
      <section className="secao">
        <div className="grupo">
          <Item icone={<Info />} titulo="Sobre o Financ" aoClicar={() => abrir('Sobre o Financ', () => (
            <CorpoFolha>
              <p style={{ marginTop: 0 }}>O app e o assistente do WhatsApp usam o mesmo banco de dados e as mesmas regras: o que você lança aqui aparece lá, e vice-versa.</p>
              <p className="nota">Os números de fatura, saldo livre e orçamento vêm das funções SQL do Financ. Sem internet, o app mostra o último retrato salvo e guarda os lançamentos novos para enviar depois.</p>
            </CorpoFolha>
          ))} />
          <button type="button" className="linha" onClick={() => abrir('Sair deste aparelho', (f) => (
            <Confirmar fechar={f} rotuloAcao="Sair" texto="Os dados salvos neste aparelho são apagados. Para voltar, entre com a senha ou a digital." acao={sair} />
          ))}>
            <span className="linha-icone"><LogOut /></span>
            <span className="linha-texto"><span className="linha-titulo" style={{ display: 'block', color: 'var(--bad)' }}>Sair deste aparelho</span></span>
            <span />
          </button>
        </div>
      </section>
    </>
  );
}
