import { useEffect } from 'react';
import { CreditCard, Home, ListOrdered, Plus, Settings2 } from 'lucide-react';
import { useFinanc } from './lib/estado';
import { ir, ProvedorFolhas, useFolhas, useRota } from './lib/navegacao';
import { MolduraFolha, ProvedorTorradas } from './ui/base';
import { Bloqueado, Configurar, Entrar, Iniciando } from './telas/Acesso';
import { Inicio } from './telas/Inicio';
import { Extrato } from './telas/Extrato';
import { Carteira } from './telas/Carteira';
import { Conferir } from './telas/Conferir';
import { CartaoDetalhe } from './telas/CartaoDetalhe';
import { ContaDetalhe } from './telas/ContaDetalhe';
import { Ajustes } from './telas/Ajustes';
import { Seguranca } from './telas/Seguranca';
import { Fixas } from './telas/Fixas';
import { Orcamentos } from './telas/Orcamentos';
import { Categorias } from './telas/Categorias';
import { Sincronizacao } from './telas/Sincronizacao';
import { FormLancamento } from './formularios/Lancamento';

const ABAS = [
  { caminho: '/', rotulo: 'Início', Icone: Home },
  { caminho: '/extrato', rotulo: 'Extrato', Icone: ListOrdered },
  { caminho: '/carteira', rotulo: 'Carteira', Icone: CreditCard },
  { caminho: '/ajustes', rotulo: 'Ajustes', Icone: Settings2 },
];

function abaAtiva(rota: string): string {
  if (rota === '/') return '/';
  const a = ABAS.find((x) => x.caminho !== '/' && rota.startsWith(x.caminho));
  return a?.caminho ?? '/';
}

function Tela({ rota }: { rota: string }) {
  let m: RegExpMatchArray | null;
  if (rota === '/' || rota === '/configurar') return <Inicio />;
  if (rota === '/extrato') return <Extrato />;
  if (rota === '/carteira' || rota === '/carteira/contas' || rota === '/carteira/caixinhas') return <Carteira />;
  if ((m = rota.match(/^\/carteira\/cartao\/(\d+)$/))) return <CartaoDetalhe id={Number(m[1])} />;
  if ((m = rota.match(/^\/carteira\/cartao\/(\d+)\/conferir$/))) return <Conferir key={m[1]} cartaoId={Number(m[1])} />;
  if ((m = rota.match(/^\/carteira\/conta\/(\d+)$/))) return <ContaDetalhe id={Number(m[1])} />;
  if (rota === '/ajustes') return <Ajustes />;
  if (rota === '/ajustes/seguranca') return <Seguranca />;
  if (rota === '/ajustes/fixas') return <Fixas />;
  if (rota === '/ajustes/orcamentos') return <Orcamentos />;
  if (rota === '/ajustes/categorias') return <Categorias />;
  if (rota === '/ajustes/sincronizacao') return <Sincronizacao />;
  return <Inicio />;
}

function Navegacao() {
  const rota = useRota();
  const ativa = abaAtiva(rota);
  const { abrir } = useFolhas();
  const novo = () => abrir('Novo lançamento', (fechar) => <FormLancamento fechar={fechar} />);

  // atalho do ícone do app: /?novo=1
  useEffect(() => {
    const u = new URL(location.href);
    if (u.searchParams.get('novo') === '1') {
      history.replaceState(history.state, '', '/');
      novo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = (a: (typeof ABAS)[number]) => (
    <a
      key={a.caminho}
      href={a.caminho}
      className="aba"
      aria-current={ativa === a.caminho ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        ir(a.caminho);
      }}
    >
      <a.Icone aria-hidden="true" />
      <span>{a.rotulo}</span>
    </a>
  );

  return (
    <>
      <nav className="trilho" aria-label="Seções">
        <div className="trilho-marca">
          <img src="/icon-192.png" alt="" />
          Financ
        </div>
        <button type="button" className="btn tinta novo" onClick={novo}>
          <Plus aria-hidden="true" /> Novo lançamento
        </button>
        {ABAS.map(item)}
      </nav>
      <nav className="abas" aria-label="Seções">
        <div className="abas-dentro">
          {item(ABAS[0])}
          {item(ABAS[1])}
          <button type="button" className="aba-mais" onClick={novo} aria-label="Novo lançamento">
            <Plus size={26} aria-hidden="true" />
          </button>
          {item(ABAS[2])}
          {item(ABAS[3])}
        </div>
      </nav>
    </>
  );
}

function Shell() {
  const rota = useRota();
  return (
    <div className="app">
      <Navegacao />
      <main className="conteudo">
        <Tela rota={rota} />
      </main>
    </div>
  );
}

export function App() {
  const { fase } = useFinanc();
  let corpo;
  if (fase.tipo === 'iniciando') corpo = <Iniciando />;
  else if (fase.tipo === 'configurar') corpo = <Configurar token={fase.token} />;
  else if (fase.tipo === 'entrar') corpo = <Entrar configurado={fase.configurado} digitais={fase.digitais} semRede={fase.semRede} />;
  else if (fase.tipo === 'bloqueado') corpo = <Bloqueado digitais={fase.digitais} offline={fase.offline} />;
  else corpo = <Shell />;
  return (
    <ProvedorTorradas>
      <ProvedorFolhas Moldura={MolduraFolha}>{corpo}</ProvedorFolhas>
    </ProvedorTorradas>
  );
}
