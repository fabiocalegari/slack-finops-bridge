'use strict';

require('dotenv').config();

const pino = require('pino');
const { App } = require('@slack/bolt');
const { OpenClawClient } = require('./openclaw-client');

const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
});

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SLACK_BOT_TOKEN = must('SLACK_BOT_TOKEN');
const SLACK_APP_TOKEN = must('SLACK_APP_TOKEN');

const OPENCLAW_WS_URL = process.env.OPENCLAW_WS_URL || 'ws://127.0.0.1:18789';
const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID || 'finops';
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

const openclaw = new OpenClawClient({
  url: OPENCLAW_WS_URL,
  gatewayToken: OPENCLAW_GATEWAY_TOKEN || undefined,
  agentId: OPENCLAW_AGENT_ID,
  log,
});

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
});

async function main() {
  log.info(
    {
      openclaw: {
        url: OPENCLAW_WS_URL,
        agentId: OPENCLAW_AGENT_ID,
        auth: Boolean(OPENCLAW_GATEWAY_TOKEN),
      },
    },
    'bridge: starting'
  );

  openclaw.connect().catch((err) => log.error({ err }, 'openclaw: connect loop error'));

  app.message(async ({ message, say }) => {
    try {
      if (!message || message.subtype) return;
      if (message.bot_id) return;

      const text = (message.text || '').trim();
      if (!text) return;

      const channel = message.channel;
      const thread_ts = message.thread_ts || message.ts;

      log.info({ channel, thread_ts }, 'slack: message received');

      const answer = await openclaw.ask(text);
      const out = (answer || '').trim() || '(sem resposta)';

      await say({ text: out, thread_ts });
      log.info({ channel, thread_ts }, 'slack: replied');
    } catch (err) {
      log.error({ err }, 'slack: handler error');
      try {
        const channel = message?.channel;
        const thread_ts = message?.thread_ts || message?.ts;
        if (channel && thread_ts) {
          await say({
            text: 'Erro processando a mensagem (ver logs do bridge).',
            thread_ts,
          });
        }
      } catch {}
    }
  });

  await app.start();
  log.info('bridge: Slack connected (Socket Mode)');
}

main().catch((err) => {
  log.error({ err }, 'bridge: fatal');
  process.exitCode = 1;
});
