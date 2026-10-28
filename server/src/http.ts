import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export class ErroApi extends Error {
  constructor(public status: number, message: string, public codigo?: string) {
    super(message);
  }
}

export function corpo<T extends z.ZodType>(schema: T, req: FastifyRequest): z.infer<T> {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) {
    const primeiro = r.error.issues[0];
    const campo = primeiro?.path?.join('.') || 'dados';
    throw new ErroApi(400, `Dado inválido em ${campo}: ${primeiro?.message ?? 'confira os campos'}`, 'invalido');
  }
  return r.data;
}

export function idParam(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw new ErroApi(400, 'Identificador inválido', 'invalido');
  return id;
}

export function userAgent(req: FastifyRequest): string {
  return String(req.headers['user-agent'] ?? '').slice(0, 300);
}

export function semCache(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
}

// valores de dinheiro: positivos, até 2 casas, limite generoso
export const zValor = z.number().finite().positive().max(10_000_000).transform((v) => Math.round(v * 100) / 100);
export const zValorLivre = z.number().finite().min(-10_000_000).max(10_000_000).transform((v) => Math.round(v * 100) / 100);
export const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
export const zMes = z.string().regex(/^\d{4}-\d{2}$/, 'use AAAA-MM');
export const zTexto = (max = 120) => z.string().trim().min(1).max(max);
export const zCor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'use #RRGGBB');
export const zFinal = z.string().regex(/^\d{4}$/, 'use os 4 últimos dígitos');
