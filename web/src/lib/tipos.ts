export type TipoConta = 'pf' | 'pj' | 'outro' | 'beneficio';
export type Metodo = 'credito' | 'debito' | 'pix' | 'dinheiro' | 'boleto' | 'vale';

export type Conta = {
  id: number;
  nome: string;
  apelidos: string[];
  tipo: TipoConta;
  ativo: boolean;
  padrao: boolean;
  cor: string | null;
  instituicao: string | null;
  final: string | null;
  bandeira: string | null;
  ordem: number | null;
  saldo: number | null;
  data: string;
  ultimo_ajuste: { data: string; saldo: number } | null;
};

export type Fatura = {
  cartao: string;
  cartao_id: number;
  competencia: string;
  fechamento: string;
  vencimento: string;
  status: 'aberta' | 'fechada' | 'paga';
  itens: number;
  valor_calculado: number;
  valor_ajustado: number | null;
  valor_fatura: number;
  apos_ajuste: number | null;
  ajustado_em: string | null;
  paga: boolean;
  data_pagamento: string | null;
  limite: number | null;
  limite_usado_total: number;
  limite_disponivel: number | null;
};

export type Cartao = {
  id: number;
  nome: string;
  apelidos: string[];
  limite: number | null;
  dia_fechamento: number;
  dia_vencimento: number;
  ativo: boolean;
  padrao: boolean;
  competencia_por: 'vencimento' | 'fechamento';
  cor: string | null;
  final: string | null;
  bandeira: string | null;
  ordem: number | null;
  competencia_atual: string;
  faturas: Fatura[];
};

export type Lancamento = {
  id: number;
  data: string;
  competencia: string;
  descricao: string;
  categoria: string;
  valor: number;
  tipo: 'saida' | 'entrada';
  metodo: Metodo | string;
  cartao_id: number | null;
  conta_id: number | null;
  origem: 'avulso' | 'parcela' | 'recorrente';
  parcelamento_id: number | null;
  parcela_num: number | null;
  parcela_total: number | null;
  recorrente_id: number | null;
  observacao: string | null;
  criado_em: string;
  pendente?: boolean;
};

export type Movimento = {
  id: number;
  conta_id: number;
  data: string;
  valor: number;
  tipo: 'pagamento_fatura' | 'transferencia' | 'ajuste' | 'outro' | 'caixinha';
  descricao: string | null;
  fatura_id: number | null;
};

export type Item = { id?: number; descricao: string; valor: number; data?: string; dia?: number; tipo?: string; metodo?: string; conta?: string };

export type PainelMes = {
  mes: string;
  status: 'realizado' | 'em_andamento' | 'projetado';
  data_ref: string;
  entradas: number;
  entradas_previstas: number;
  entradas_itens: Item[];
  total_entradas: number;
  faturas: { cartao: string; cartao_id: number; competencia: string; valor: number; status: string; paga: boolean; vencimento: string }[];
  faturas_total: number;
  faturas_em_aberto: number;
  fixas_lancadas: number;
  fixas_previstas: number;
  fixas_previstas_itens: Item[];
  parcelas_conta: number;
  outras_saidas: number;
  total_despesas: number;
  resultado: number;
  saldo_contas: { nome: string; tipo: string; saldo: number | null }[];
  saldo_em_conta: number | null;
  a_pagar: number;
  a_receber: number;
  entradas_futuras: number;
  entradas_futuras_itens: Item[];
  saidas_futuras: number;
  saidas_futuras_itens: Item[];
  saldo_livre: number | null;
  saldo_informado: boolean;
};

export type Fluxo = {
  status: 'em_andamento' | 'realizado' | 'projetado';
  mes: string;
  inicio_em?: string;
  ref?: string;
  inicio?: number | null;
  inicio_informado?: boolean;
  fim?: number | null;
  fim_informado?: boolean;
  movimentos?: number;
  grupos?: Record<string, { valor: number; n: number; itens: Item[] }>;
  nao_registrado?: number | null;
};

export type Caixinha = {
  id: number;
  nome: string;
  apelidos: string[];
  rendimento: string;
  meta: number | null;
  ativo: boolean;
  data: string;
  saldo: number;
  pct_meta: number | null;
  ultimo_saldo_informado: { data: string; saldo: number } | null;
  aportes_mes: number;
  resgates_mes: number;
  rendimento_mes: number;
  rendimento_total: number;
  aportado_total: number;
  resgatado_total: number;
  cor: string | null;
};

export type Recorrente = {
  id: number;
  descricao: string;
  categoria: string;
  valor: number;
  tipo: 'saida' | 'entrada';
  dia_vencimento: number;
  metodo: Metodo | string;
  cartao: string | null;
  conta: string | null;
  cartao_id: number | null;
  conta_id: number | null;
  confirmar: boolean;
  lembrar_antes: boolean;
  inicio: string;
  fim: string | null;
  ativo: boolean;
  lancado_mes: boolean;
};

export type Orcamento = {
  categoria: string;
  categorias: string[];
  mes: string;
  orcamento: number;
  padrao: number | null;
  so_este_mes: boolean;
  gasto: number;
  restante: number;
  pct: number | null;
};

export type Snapshot = {
  hoje: string;
  mes: string;
  gerado_em: string;
  padrao: { cartao_id: number | null; conta_id: number | null; metodo: string };
  contas: Conta[];
  cartoes: Cartao[];
  caixinhas: Caixinha[];
  recorrentes: Recorrente[];
  orcamentos: Orcamento[];
  orcamentos_cadastro: { categoria: string; valor_mes: number; categorias: string[] }[];
  painel: PainelMes[];
  fluxo: Fluxo;
  lancamentos: Lancamento[];
  movimentos: Movimento[];
  saldos_informados: { conta_id: number; data: string; saldo: number }[];
  categorias: { nome: string; tipo: string; n: number; ultimo: string }[];
  importacoes?: { id: number; cartao_id: number; competencia: string; total: number | null; origem: 'email' | 'app'; atualizado_em: string }[];
};

export type EstadoItemBanco = 'faltando' | 'diferente' | 'conferido' | 'lancado' | 'ignorado';

export type ItemBanco = {
  id: number;
  data: string;
  descricao: string;
  descricao_limpa: string;
  valor: number;
  tipo: 'compra' | 'encargo' | 'estorno';
  parcela: string | null;
  final: string | null;
  categoria: string;
  estado: EstadoItemBanco;
  lancamento: null | { id: number; data: string; descricao: string; valor: number; categoria: string; competencia: string; outro_mes: boolean; parcela: string | null };
};

export type Conciliacao = {
  importacao: {
    id: number; cartao_id: number; cartao: string; competencia: string; vencimento: string | null; fechamento: string | null; periodo_ini: string | null;
    total: number | null; saldo_financiado: number; origem: 'email' | 'app'; atualizado_em: string;
    checagem: { ok: boolean; diferenca: number | null; soma_itens: number; esperado: number | null } | null;
  };
  contagem: Record<EstadoItemBanco, number>;
  totais: { banco_total: number | null; banco_itens: number; faltando: number; app_lancado: number; app_fatura: number; so_no_app: number; diferenca: number };
  itens: ItemBanco[];
  so_no_app: { id: number; data: string; descricao: string; valor: number; categoria: string; tipo: string }[];
  aplicado?: number;
  movidos?: number;
  erros?: { item: number; erro: string }[];
};

export type EstadoAuth = {
  configurado: boolean;
  digitais: number;
  sessao: null | { metodo: string; bloqueada: boolean; bloqueio_min: number | null; digital_vinculada: boolean };
  versao: string;
};

export type RespostaMutacao<T = Record<string, unknown>> = { ok: true; resultado: T; snapshot?: Snapshot };
