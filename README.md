# Financ (app)

App instalável (PWA) do Financ, o assistente financeiro pessoal. Usa o mesmo banco
PostgreSQL e as mesmas funções SQL do agente do WhatsApp (schema `financ`): o que é
lançado aqui aparece lá, e vice-versa.

- **Servidor**: Node + Fastify (`server/`), num único bundle (`dist/server.mjs`).
- **App**: React + Vite (`web/`), com service worker para abrir sem internet.
- **Acesso**: um único usuário. Senha (scrypt) criada por um link de configuração e
  digital/rosto via passkeys (WebAuthn). Sessão em cookie `HttpOnly`, bloqueio
  automático por inatividade e registro de atividade.
- **Sem internet**: o app guarda o último retrato dos dados (IndexedDB), confere a digital
  localmente e põe os lançamentos novos numa fila com chave de idempotência.

## Variáveis de ambiente

| Variável | Para quê |
| --- | --- |
| `DATABASE_URL` | Postgres com o schema `financ` (Migração 12 aplicada) |
| `APP_ORIGIN` | Endereço público, ex. `https://financ.exemplo.com` |
| `RP_ID` | Domínio das passkeys (padrão: o host de `APP_ORIGIN`) |
| `SETUP_TOKEN` | Token do link `/configurar?token=...` para criar a senha. Trocar o valor gera um novo link (recuperação) |
| `REDIRECT_HOSTS` | Hosts alternativos que redirecionam para `APP_ORIGIN` |
| `PORT` | Porta HTTP (padrão 3000) |

O app cria o próprio schema `financ_app` (login, digitais, sessões, eventos) ao iniciar.
Também aplica, uma vez, as migrações do schema `financ` que vêm com ele (`server/src/sql/`,
versões 1013+ registradas em `financ_app.migracoes`): conferência da fatura do banco (13 e 14) e
previstos, valor da fixa por mês, categorias cadastradas e correção do total informado da fatura (15);
fixa paga ligada ao lançamento, receita fixa sem sobrescrita, propostas que não repetem o que já está lançado
e usuário só de leitura para a consulta livre do agente (16); dados dos resumos automáticos em imagem (17); notificações capturadas pelo app Android (18).

## Desenvolvimento

```bash
npm ci
npm run build        # web + servidor em dist/
node dist/server.mjs # precisa das variáveis acima
```

## App Android (`android/`)

O mesmo app, empacotado como Trusted Web Activity (abre o Financ pelo Chrome, em tela cheia), mais um serviço
nativo que lê as notificações dos apps de banco escolhidos e as envia para `POST /api/captura/notificacao`.

- Só segue o que fala de valor (`R$`); códigos de segurança e senhas são ignorados no aparelho e no servidor.
- Cada aparelho gera a própria chave; o pareamento é feito dentro do app já logado (Ajustes › Captura de notificações).
- O servidor guarda o texto original por 90 dias (`financ.notif_capturas`) e repassa ao fluxo do n8n, que pergunta
  no WhatsApp antes de lançar.
- O APK para instalar fica em `android/dist/financ.apk`. O build é do GitHub Actions (`.github/workflows/android.yml`);
  a chave de assinatura nunca fica no repositório. Sem os segredos `ANDROID_KEYSTORE_B64` e `ANDROID_KEYSTORE_PASSWORD`
  o build sai sem assinatura e é assinado à parte (`android/ferramentas/assinar_v2.py`, APK Signature Scheme v2);
  com eles, sai assinado direto em Releases. Todo APK publicado passa pelo `apksigner verify` oficial
  (`.github/workflows/conferir-apk.yml`).
