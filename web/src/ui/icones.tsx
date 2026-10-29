import {
  Baby, Banknote, Beer, Bike, BookOpen, Briefcase, Bus, Car, CircleDot, Coffee, CreditCard, Dice5, Droplets, Dumbbell, Fuel, Gamepad2,
  Gift, GraduationCap, HeartHandshake, HeartPulse, House, Landmark, Music, PawPrint, Phone, PiggyBank, Pill, Plane, ReceiptText, Repeat,
  RotateCcw, Scissors, Shirt, ShoppingBag, ShoppingBasket, ShoppingCart, Smartphone, Sofa, Sparkles, Star, Stethoscope, Ticket,
  TrendingUp, Trophy, Tv, Users, UtensilsCrossed, Wallet, Wifi, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import { normalizar } from '../lib/financas';
import type { Snapshot } from '../lib/tipos';

/** ícones que dá para escolher para uma categoria (a chave fica salva no banco) */
export const ICONES: { chave: string; nome: string; Icone: LucideIcon }[] = [
  { chave: 'cesta', nome: 'Cesta', Icone: ShoppingBasket },
  { chave: 'carrinho', nome: 'Mercado', Icone: ShoppingCart },
  { chave: 'talheres', nome: 'Refeição', Icone: UtensilsCrossed },
  { chave: 'cafe', nome: 'Café', Icone: Coffee },
  { chave: 'bebida', nome: 'Bebida', Icone: Beer },
  { chave: 'carro', nome: 'Carro', Icone: Car },
  { chave: 'combustivel', nome: 'Combustível', Icone: Fuel },
  { chave: 'onibus', nome: 'Ônibus', Icone: Bus },
  { chave: 'bicicleta', nome: 'Bicicleta', Icone: Bike },
  { chave: 'viagem', nome: 'Viagem', Icone: Plane },
  { chave: 'casa', nome: 'Casa', Icone: House },
  { chave: 'sofa', nome: 'Móveis', Icone: Sofa },
  { chave: 'luz', nome: 'Energia', Icone: Zap },
  { chave: 'agua', nome: 'Água', Icone: Droplets },
  { chave: 'internet', nome: 'Internet', Icone: Wifi },
  { chave: 'telefone', nome: 'Telefone', Icone: Phone },
  { chave: 'ferramenta', nome: 'Manutenção', Icone: Wrench },
  { chave: 'saude', nome: 'Saúde', Icone: HeartPulse },
  { chave: 'remedio', nome: 'Remédio', Icone: Pill },
  { chave: 'medico', nome: 'Médico', Icone: Stethoscope },
  { chave: 'academia', nome: 'Academia', Icone: Dumbbell },
  { chave: 'cuidados', nome: 'Cuidados', Icone: Sparkles },
  { chave: 'beleza', nome: 'Cabelo', Icone: Scissors },
  { chave: 'lazer', nome: 'Ingresso', Icone: Ticket },
  { chave: 'jogos', nome: 'Jogos', Icone: Gamepad2 },
  { chave: 'aposta', nome: 'Aposta', Icone: Dice5 },
  { chave: 'musica', nome: 'Música', Icone: Music },
  { chave: 'tv', nome: 'TV', Icone: Tv },
  { chave: 'assinatura', nome: 'Assinatura', Icone: Repeat },
  { chave: 'educacao', nome: 'Estudos', Icone: GraduationCap },
  { chave: 'livro', nome: 'Livro', Icone: BookOpen },
  { chave: 'roupa', nome: 'Roupa', Icone: Shirt },
  { chave: 'sacola', nome: 'Compras', Icone: ShoppingBag },
  { chave: 'eletronico', nome: 'Eletrônico', Icone: Smartphone },
  { chave: 'presente', nome: 'Presente', Icone: Gift },
  { chave: 'pet', nome: 'Pet', Icone: PawPrint },
  { chave: 'bebe', nome: 'Bebê', Icone: Baby },
  { chave: 'familia', nome: 'Família', Icone: Users },
  { chave: 'doacao', nome: 'Doação', Icone: HeartHandshake },
  { chave: 'investimento', nome: 'Investimento', Icone: TrendingUp },
  { chave: 'cofrinho', nome: 'Cofrinho', Icone: PiggyBank },
  { chave: 'imposto', nome: 'Impostos', Icone: Landmark },
  { chave: 'recibo', nome: 'Conta', Icone: ReceiptText },
  { chave: 'cartao', nome: 'Cartão', Icone: CreditCard },
  { chave: 'salario', nome: 'Dinheiro', Icone: Banknote },
  { chave: 'trabalho', nome: 'Trabalho', Icone: Briefcase },
  { chave: 'reembolso', nome: 'Reembolso', Icone: RotateCcw },
  { chave: 'vale', nome: 'Carteira', Icone: Wallet },
  { chave: 'trofeu', nome: 'Prêmio', Icone: Trophy },
  { chave: 'estrela', nome: 'Estrela', Icone: Star },
  { chave: 'outros', nome: 'Outros', Icone: CircleDot },
];

const POR_CHAVE = new Map(ICONES.map((i) => [i.chave, i.Icone]));

// sem ícone escolhido: um palpite pelo nome da categoria
const PALPITES: [RegExp, string][] = [
  [/restaurante|lanche|almoco|janta|refeic|ifood|delivery|comer/, 'talheres'],
  [/mercado|supermercado/, 'carrinho'],
  [/aliment/, 'cesta'],
  [/cafe|padaria/, 'cafe'],
  [/bar|bebida|cerveja/, 'bebida'],
  [/combust|gasolina|posto/, 'combustivel'],
  [/transporte|uber|carro|onibus|estacionamento/, 'carro'],
  [/viagem|passagem|hotel/, 'viagem'],
  [/moradia|aluguel|condominio/, 'casa'],
  [/energia|luz/, 'luz'],
  [/agua/, 'agua'],
  [/internet/, 'internet'],
  [/celular|telefone/, 'telefone'],
  [/casa|movel|moveis/, 'sofa'],
  [/farmacia|remedio/, 'remedio'],
  [/academia|esporte/, 'academia'],
  [/saude|medic/, 'saude'],
  [/jogo|game/, 'jogos'],
  [/aposta|loteria|mega/, 'aposta'],
  [/lazer|cinema|show|passeio/, 'lazer'],
  [/assinatura|streaming/, 'assinatura'],
  [/educa|curso|faculdade/, 'educacao'],
  [/livro/, 'livro'],
  [/vestu|roupa/, 'roupa'],
  [/eletron/, 'eletronico'],
  [/compra/, 'sacola'],
  [/familia/, 'familia'],
  [/pet|veterin/, 'pet'],
  [/presente/, 'presente'],
  [/cuidado|beleza|cabelo/, 'cuidados'],
  [/imposto|taxa|tarifa/, 'imposto'],
  [/invest|caixinha/, 'investimento'],
  [/reembolso/, 'reembolso'],
  [/salario|renda|pagamento/, 'salario'],
  [/freela|servico|pj|trabalho/, 'trabalho'],
  [/beneficio|vale/, 'vale'],
];

export function palpiteIcone(categoria: string): string {
  const n = normalizar(categoria);
  return PALPITES.find(([r]) => r.test(n))?.[1] ?? 'outros';
}

// chave escolhida por categoria, calculada uma vez por snapshot
const cache = new WeakMap<object, Map<string, string>>();

export function chaveIcone(categoria: string, snap?: Snapshot | null): string {
  if (snap?.categorias) {
    let m = cache.get(snap.categorias);
    if (!m) {
      m = new Map();
      for (const c of snap.categorias) if (c.icone) m.set(normalizar(c.nome), c.icone);
      cache.set(snap.categorias, m);
    }
    const k = m.get(normalizar(categoria));
    if (k && POR_CHAVE.has(k)) return k;
  }
  return palpiteIcone(categoria);
}

export function IconePorChave({ chave }: { chave: string }) {
  const Icone = POR_CHAVE.get(chave) ?? CircleDot;
  return <Icone aria-hidden="true" />;
}

export function IconeCategoria({ categoria, snap }: { categoria: string; snap?: Snapshot | null }) {
  return <IconePorChave chave={chaveIcone(categoria, snap)} />;
}
