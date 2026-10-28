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

## Desenvolvimento

```bash
npm ci
npm run build        # web + servidor em dist/
node dist/server.mjs # precisa das variáveis acima
```
