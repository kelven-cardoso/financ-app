# ---- build: app (PWA) e servidor num único bundle
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- execução: só o bundle (sem node_modules) e o pdftotext
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
# pdftotext (poppler) lê o PDF da fatura do banco
RUN apk add --no-cache poppler-utils
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "dist/server.mjs"]
