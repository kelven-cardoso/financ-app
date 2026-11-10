#!/usr/bin/env python3
"""Assina um APK com o APK Signature Scheme v2 (RSA PKCS#1 v1.5 + SHA-256), sem ferramentas externas.
Uso: assinar_v2.py entrada.apk saida.apk keystore.p12 arquivo_da_senha
A conferência oficial (apksigner verify) é feita depois, no GitHub Actions."""
import hashlib, struct, sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import pkcs12

ALGO = 0x0103            # RSASSA-PKCS1-v1_5 com SHA2-256
ID_V2 = 0x7109871A
MAGIC = b"APK Sig Block 42"
CHUNK = 1 << 20

def lp(b: bytes) -> bytes:           # prefixo de tamanho uint32
    return struct.pack("<I", len(b)) + b

def partes(apk: bytes):
    i = apk.rfind(b"PK\x05\x06")
    if i < 0 or i + 22 > len(apk): raise SystemExit("EOCD não encontrado")
    if struct.unpack_from("<H", apk, i + 20)[0] != len(apk) - i - 22: raise SystemExit("EOCD com comentário inesperado")
    cd_size, cd_off = struct.unpack_from("<II", apk, i + 12)
    if cd_off + cd_size != i: raise SystemExit("o diretório central não encosta no EOCD (já assinado ou ZIP64?)")
    if apk[cd_off - 16:cd_off] == MAGIC: raise SystemExit("o APK já tem bloco de assinatura")
    return apk[:cd_off], apk[cd_off:i], apk[i:], cd_off

def digest_conteudo(secoes) -> bytes:
    ds = []
    for s in secoes:
        for o in range(0, len(s), CHUNK):
            c = s[o:o + CHUNK]
            ds.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest())
    return hashlib.sha256(b"\x5a" + struct.pack("<I", len(ds)) + b"".join(ds)).digest()

def assinar(entrada, saida, p12, arq_senha):
    apk = open(entrada, "rb").read()
    senha = open(arq_senha, "rb").read().strip()
    chave, cert, _ = pkcs12.load_key_and_certificates(open(p12, "rb").read(), senha)
    entradas, cd, eocd, cd_off = partes(apk)
    # o EOCD entra no cálculo apontando para o início do bloco de assinatura, que é o cd_off original
    digest = digest_conteudo([entradas, cd, eocd])
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    pub_der = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signed_data = (lp(lp(struct.pack("<I", ALGO) + lp(digest)))      # digests
                   + lp(lp(cert_der))                                # certificados
                   + lp(b""))                                        # atributos adicionais
    assinatura = chave.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    signer = lp(signed_data) + lp(lp(struct.pack("<I", ALGO) + lp(assinatura))) + lp(pub_der)
    valor = lp(lp(signer))
    par = struct.pack("<QI", 4 + len(valor), ID_V2) + valor
    tam = len(par) + 8 + 16
    bloco = struct.pack("<Q", tam) + par + struct.pack("<Q", tam) + MAGIC
    eocd2 = eocd[:16] + struct.pack("<I", cd_off + len(bloco)) + eocd[20:]
    open(saida, "wb").write(entradas + bloco + cd + eocd2)
    fp = hashlib.sha256(cert_der).hexdigest().upper()
    print("assinado:", saida, len(entradas) + len(bloco) + len(cd) + len(eocd2), "bytes; certificado SHA-256", ":".join(fp[i:i + 2] for i in range(0, 64, 2)))

if __name__ == "__main__":
    assinar(*sys.argv[1:5])
