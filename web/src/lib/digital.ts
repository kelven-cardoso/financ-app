import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './api';
import type { ChaveLocal } from './local';

export async function digitalDisponivel(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/** entrar ou desbloquear com a digital (conferido pelo servidor) */
export async function usarDigital(fluxo: 'entrar' | 'desbloquear'): Promise<void> {
  const opcoes = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('POST', '/api/auth/digital/opcoes', { fluxo });
  const resposta = await startAuthentication({ optionsJSON: opcoes });
  await api('POST', '/api/auth/digital/verificar', { fluxo, resposta });
}

export async function cadastrarDigital(nome: string): Promise<void> {
  const opcoes = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('POST', '/api/auth/digital/registro/opcoes', {});
  const resposta = await startRegistration({ optionsJSON: opcoes });
  await api('POST', '/api/auth/digital/registro', { resposta, nome });
}

export async function buscarChavesLocais(): Promise<ChaveLocal[]> {
  return api<ChaveLocal[]>('GET', '/api/seguranca/chaves-locais');
}

/** nome sugerido para o aparelho a partir do navegador */
export function nomeDoAparelho(ua = navigator.userAgent): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) {
    const m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
    const modelo = m?.[1]?.trim();
    return modelo && !/^K$/.test(modelo) ? `Android (${modelo})` : 'Celular Android';
  }
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return '';
}

export function descreverNavegador(ua: string | null): string {
  if (!ua) return 'Navegador desconhecido';
  const aparelho = nomeDoAparelho(ua);
  const nav = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  if (!nav && !aparelho) return 'Outro programa';
  if (!aparelho) return nav;
  return nav ? `${nav} no ${aparelho}` : aparelho;
}

// ---------------------------------------------------------------- desbloqueio sem internet
// O servidor não está acessível: o app pede a digital ao aparelho com um desafio local e
// confere a assinatura com a chave pública guardada no cadastro da digital.

const b64url = {
  dec(s: string): Uint8Array {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  },
  enc(u: Uint8Array): string {
    let s = '';
    u.forEach((x) => (s += String.fromCharCode(x)));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
};

function derParaBruto(der: Uint8Array): Uint8Array {
  // ECDSA-Sig-Value ::= SEQUENCE { r INTEGER, s INTEGER }
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const ler = () => {
    if (der[i] !== 0x02) throw new Error('assinatura inválida');
    const n = der[i + 1];
    let v = der.slice(i + 2, i + 2 + n);
    i += 2 + n;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = ler();
  const s = ler();
  const bruto = new Uint8Array(64);
  bruto.set(r, 0);
  bruto.set(s, 32);
  return bruto;
}

function buf(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export async function desbloquearSemInternet(chaves: ChaveLocal[]): Promise<boolean> {
  if (!chaves.length) return false;
  const desafio = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: desafio,
      rpId: location.hostname,
      allowCredentials: chaves.map((c) => ({ type: 'public-key', id: buf(b64url.dec(c.id)) })),
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return false;
  const resp = cred.response as AuthenticatorAssertionResponse;
  const chave = chaves.find((c) => c.id === cred.id);
  if (!chave) return false;

  const cliente = JSON.parse(new TextDecoder().decode(resp.clientDataJSON)) as { type: string; challenge: string; origin: string };
  if (cliente.type !== 'webauthn.get' || cliente.challenge !== b64url.enc(desafio) || cliente.origin !== location.origin) return false;

  const auth = new Uint8Array(resp.authenticatorData);
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.hostname)));
  if (!rpHash.every((v, k) => v === auth[k])) return false;
  const flags = auth[32];
  if (!(flags & 0x01) || !(flags & 0x04)) return false; // presença e verificação do usuário

  const hashCliente = new Uint8Array(await crypto.subtle.digest('SHA-256', resp.clientDataJSON));
  const assinado = new Uint8Array(auth.length + hashCliente.length);
  assinado.set(auth, 0);
  assinado.set(hashCliente, auth.length);
  const spki = buf(Uint8Array.from(atob(chave.spki), (c) => c.charCodeAt(0)));
  const assinatura = new Uint8Array(resp.signature);

  if (chave.alg === -7) {
    const k = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, buf(derParaBruto(assinatura)), buf(assinado));
  }
  if (chave.alg === -257) {
    const k = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, buf(assinatura), buf(assinado));
  }
  if (chave.alg === -8) {
    const k = await crypto.subtle.importKey('spki', spki, { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify('Ed25519', k, buf(assinatura), buf(assinado));
  }
  return false;
}
