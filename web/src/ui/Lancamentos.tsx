import {
  Banknote, Briefcase, Car, CircleDot, Clock3, Fuel, Gift, GraduationCap, HeartPulse, House, Landmark, PawPrint, Plane,
  Repeat, ShoppingBag, ShoppingBasket, ShoppingCart, Ticket, TrendingUp, Users, UtensilsCrossed, Wallet, type LucideIcon,
} from 'lucide-react';
import type { Lancamento, Snapshot } from '../lib/tipos';
import { meioDoLancamento, normalizar } from '../lib/financas';
import { tituloDia } from '../lib/formato';
import { useFolhas } from '../lib/navegacao';
import { Dinheiro } from './base';
import { FormLancamento } from '../formularios/Lancamento';

const ICONES: [RegExp, LucideIcon][] = [
  [/restaurante|lanche|almoco|janta|refeic|ifood|delivery/, UtensilsCrossed],
  [/mercado|supermercado/, ShoppingCart],
  [/aliment/, ShoppingBasket],
  [/combust|gasolina|posto/, Fuel],
  [/transporte|uber|carro|onibus|estacionamento/, Car],
  [/moradia|casa|aluguel|condominio|energia|agua|internet/, House],
  [/saude|farmacia|medic|academia/, HeartPulse],
  [/lazer|cinema|show|jogo|passeio/, Ticket],
  [/compra|roupa|eletron/, ShoppingBag],
  [/assinatura|streaming/, Repeat],
  [/educa|curso|livro/, GraduationCap],
  [/familia/, Users],
  [/viagem|passagem|hotel/, Plane],
  [/pet|veterin/, PawPrint],
  [/presente/, Gift],
  [/imposto|taxa|tarifa/, Landmark],
  [/invest|caixinha/, TrendingUp],
  [/salario|renda|pagamento/, Banknote],
  [/freela|servico|pj/, Briefcase],
  [/beneficio|vale/, Wallet],
];

export function IconeCategoria({ categoria }: { categoria: string }) {
  const n = normalizar(categoria);
  const Icone = ICONES.find(([r]) => r.test(n))?.[1] ?? CircleDot;
  return <Icone aria-hidden="true" />;
}

export function LinhaLancamento({ l, snap, mostrarData }: { l: Lancamento; snap: Snapshot; mostrarData?: boolean }) {
  const { abrir } = useFolhas();
  const meio = meioDoLancamento(l, snap);
  const parcela = l.parcela_num ? ` ${l.parcela_num}/${l.parcela_total}` : '';
  const sub = [l.categoria, meio].filter(Boolean).join(', ') + parcela;
  return (
    <button
      type="button"
      className="linha"
      onClick={() => abrir('Lançamento', (fechar) => <FormLancamento fechar={fechar} lancamento={l} />)}
    >
      <span className="linha-icone" style={l.tipo === 'entrada' ? { background: 'var(--good-soft)', color: 'var(--good)' } : undefined}>
        <IconeCategoria categoria={l.categoria} />
      </span>
      <span className="linha-texto">
        <span className="linha-titulo" style={{ display: 'block' }}>{l.descricao}</span>
        <span className="linha-sub" style={{ display: 'block' }}>
          {l.pendente && <span className="pendente-marca"><Clock3 size={12} aria-hidden="true" /> Aguardando envio, </span>}
          {mostrarData ? `${l.data.slice(8, 10)}/${l.data.slice(5, 7)}, ` : ''}{sub}
        </span>
      </span>
      <span className="linha-valor">
        <Dinheiro valor={l.valor} tipo={l.tipo} sinal={l.tipo === 'entrada'} />
      </span>
    </button>
  );
}

/** lista agrupada por dia, com o total do dia */
export function ListaPorDia({ lancamentos, snap }: { lancamentos: Lancamento[]; snap: Snapshot }) {
  const grupos: { dia: string; itens: Lancamento[] }[] = [];
  for (const l of lancamentos) {
    const g = grupos[grupos.length - 1];
    if (g && g.dia === l.data) g.itens.push(l);
    else grupos.push({ dia: l.data, itens: [l] });
  }
  return (
    <>
      {grupos.map((g) => {
        const saldoDia = g.itens.reduce((s, l) => s + (l.tipo === 'entrada' ? l.valor : -l.valor), 0);
        return (
          <section key={g.dia} aria-label={tituloDia(g.dia, snap.hoje)}>
            <div className="dia-cab">
              <span>{tituloDia(g.dia, snap.hoje)}</span>
              <span className="num"><Dinheiro valor={saldoDia} /></span>
            </div>
            <div className="grupo">
              {g.itens.map((l) => <LinhaLancamento key={l.id} l={l} snap={snap} />)}
            </div>
          </section>
        );
      })}
    </>
  );
}
