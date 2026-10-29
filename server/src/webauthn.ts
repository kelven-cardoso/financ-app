import { createPublicKey } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { decodeCredentialPublicKey } from '@simplewebauthn/server/helpers';
import { cfg } from './config.js';
import { sql } from './db.js';
import { ErroApi } from './http.js';

type Fluxo = 'registro' | 'entrar' | 'desbloquear';
type Desafio = { fluxo: Fluxo; sessaoId: string | null; expira: number };

// instância única: os desafios ficam em memória por 5 minutos
const desafios = new Map<string, Desafio>();
const TTL = 5 * 60 * 1000;

function guardar(challenge: string, d: Omit<Desafio, 'expira'>): void {
  const agora = Date.now();
  for (const [k, v] of desafios) if (v.expira < agora) desafios.delete(k);
  for (const k of desafios.keys()) {
    if (desafios.size < 200) break;
    desafios.delete(k);
  }
  desafios.set(challenge, { ...d, expira: agora + TTL });
}

function consumir(fluxo: Fluxo, sessaoId: string | null) {
  return (challenge: string): boolean => {
    const d = desafios.get(challenge);
    desafios.delete(challenge);
    return !!d && d.expira > Date.now() && d.fluxo === fluxo && (fluxo === 'entrar' || d.sessaoId === sessaoId);
  };
}

type PasskeyRow = { id: string; chave_publica: Uint8Array; contador: number; transports: string[]; nome: string };

export async function opcoesRegistro(sessaoId: string) {
  const [u] = await sql<{ webauthn_user_id: string }[]>`SELECT webauthn_user_id FROM financ_app.usuario WHERE id = 1`;
  const existentes = await sql<{ id: string; transports: string[] }[]>`SELECT id, transports FROM financ_app.passkeys`;
  const opcoes = await generateRegistrationOptions({
    rpName: cfg.rpNome,
    rpID: cfg.rpId,
    userName: 'financ',
    userDisplayName: 'Financ',
    userID: new Uint8Array(Buffer.from(u.webauthn_user_id, 'base64url')),
    attestationType: 'none',
    excludeCredentials: existentes.map((p) => ({ id: p.id, transports: p.transports })),
    // opções mínimas: "required" e as dicas de aparelho fazem o Gerenciador de Credenciais
    // de alguns Android falhar com "unknown error"; o aparelho cria a passkey dele mesmo assim
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    supportedAlgorithmIDs: [-7, -257],
  });
  guardar(opcoes.challenge, { fluxo: 'registro', sessaoId });
  return opcoes;
}

export async function verificarRegistro(sessaoId: string, resposta: RegistrationResponseJSON, nome: string) {
  let v;
  try {
    v = await verifyRegistrationResponse({
      response: resposta,
      expectedChallenge: consumir('registro', sessaoId),
      expectedOrigin: cfg.origem,
      expectedRPID: cfg.rpId,
      requireUserVerification: true,
    });
  } catch (e) {
    throw new ErroApi(400, 'Não foi possível confirmar a digital. Tente de novo.', 'digital_invalida');
  }
  if (!v.verified) throw new ErroApi(400, 'Não foi possível confirmar a digital. Tente de novo.', 'digital_invalida');
  const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
  const rk = resposta.clientExtensionResults?.credProps?.rk;
  await sql`
    INSERT INTO financ_app.passkeys (id, chave_publica, contador, transports, tipo_dispositivo, sincronizada, nome, descobrivel)
    VALUES (${credential.id}, ${Buffer.from(credential.publicKey)}, ${credential.counter}, ${credential.transports ?? []},
            ${credentialDeviceType}, ${credentialBackedUp}, ${nome}, ${typeof rk === 'boolean' ? rk : null})`;
  return credential.id;
}

export async function opcoesAutenticacao(fluxo: 'entrar' | 'desbloquear', sessaoId: string | null, passkeyPreferida: string | null) {
  const todas = await sql<{ id: string; transports: string[]; descobrivel: boolean | null }[]>`
    SELECT id, transports, descobrivel FROM financ_app.passkeys ORDER BY ultimo_uso DESC NULLS LAST`;
  if (todas.length === 0) throw new ErroApi(409, 'Nenhuma digital cadastrada ainda. Entre com a senha e ative em Segurança.', 'sem_digital');
  const lista = passkeyPreferida && todas.some((p) => p.id === passkeyPreferida) ? todas.filter((p) => p.id === passkeyPreferida) : todas;
  const opcoes = await generateAuthenticationOptions({
    rpID: cfg.rpId,
    // para entrar (sem sessão) a lista vai vazia: o aparelho oferece a passkey dele, e os ids não ficam expostos.
    // Se alguma passkey não for descobrível (ou não se sabe), vão todas na lista: uma lista não vazia
    // restringe o aparelho às passkeys dela.
    allowCredentials:
      fluxo === 'entrar' && todas.every((p) => p.descobrivel === true)
        ? []
        : (fluxo === 'entrar' ? todas : lista).map((p) => ({ id: p.id, transports: p.transports })),
    userVerification: 'required',
  });
  guardar(opcoes.challenge, { fluxo, sessaoId });
  return opcoes;
}

export async function verificarAutenticacao(fluxo: 'entrar' | 'desbloquear', sessaoId: string | null, resposta: AuthenticationResponseJSON) {
  const [pk] = await sql<PasskeyRow[]>`SELECT id, chave_publica, contador, transports, nome FROM financ_app.passkeys WHERE id = ${resposta.id}`;
  if (!pk) throw new ErroApi(401, 'Essa digital não está cadastrada neste app.', 'digital_desconhecida');
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: resposta,
      expectedChallenge: consumir(fluxo, sessaoId),
      expectedOrigin: cfg.origem,
      expectedRPID: cfg.rpId,
      requireUserVerification: true,
      credential: {
        id: pk.id,
        publicKey: new Uint8Array(pk.chave_publica),
        counter: Number(pk.contador),
        transports: pk.transports as never,
      },
    });
  } catch (e) {
    throw new ErroApi(401, 'A digital não foi confirmada. Tente de novo.', 'digital_invalida');
  }
  if (!v.verified) throw new ErroApi(401, 'A digital não foi confirmada. Tente de novo.', 'digital_invalida');
  await sql`UPDATE financ_app.passkeys SET contador = ${v.authenticationInfo.newCounter}, ultimo_uso = now() WHERE id = ${pk.id}`;
  return pk;
}

/** Chave pública em SPKI (DER, base64) para o app conferir a digital localmente quando estiver sem internet. */
export function chaveSpki(cose: Uint8Array): { spki: string; alg: number } | null {
  try {
    const m = decodeCredentialPublicKey(new Uint8Array(cose) as Uint8Array<ArrayBuffer>) as unknown as Map<number, number | Uint8Array>;
    const kty = m.get(1);
    const alg = Number(m.get(3));
    const b64 = (v: unknown) => Buffer.from(v as Uint8Array).toString('base64url');
    let jwk: Record<string, string>;
    if (kty === 2) jwk = { kty: 'EC', crv: 'P-256', x: b64(m.get(-2)), y: b64(m.get(-3)) };
    else if (kty === 3) jwk = { kty: 'RSA', n: b64(m.get(-1)), e: b64(m.get(-2)) };
    else if (kty === 1) jwk = { kty: 'OKP', crv: 'Ed25519', x: b64(m.get(-2)) };
    else return null;
    const der = createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' });
    return { spki: Buffer.from(der).toString('base64'), alg };
  } catch {
    return null;
  }
}
