# slack-finops-bridge

Bridge **Slack ↔ OpenClaw** (agent: `finops`).

## Fluxo

Slack (Socket Mode) → Node.js (`@slack/bolt`) → OpenClaw Gateway (WebSocket) → Agent → resposta → Slack.

## Requisitos

- Node.js 18+
- Slack App com **Socket Mode** habilitado
- Tokens:
  - `SLACK_BOT_TOKEN` (xoxb-...)
  - `SLACK_APP_TOKEN` (xapp-...)
- OpenClaw Gateway acessível via WebSocket

## Setup

```bash
npm install
```

### Variáveis de ambiente

- `SLACK_BOT_TOKEN` (obrigatória)
- `SLACK_APP_TOKEN` (obrigatória)
- `OPENCLAW_WS_URL` (default recomendado: `ws://127.0.0.1:18789`)
- `OPENCLAW_AGENT_ID` (default: `finops`)
- `OPENCLAW_GATEWAY_TOKEN` (opcional; se setado envia `Authorization: Bearer ...`)

## Rodar

```bash
node index.js
```

Ou:

```bash
./run.sh
```

## Notas

- `.env` e `node_modules/` são ignorados por padrão.
- O bridge mantém sessão no OpenClaw e faz reconexão automática no WS.
