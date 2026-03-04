'use strict';

const WebSocket = require('ws');
const { nanoid } = require('nanoid');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class OpenClawClient {
  /**
   * @param {{
   *  url: string,
   *  gatewayToken?: string,
   *  agentId: string,
   *  log: any,
   *  reconnectMinMs?: number,
   *  reconnectMaxMs?: number,
   *  requestTimeoutMs?: number,
   * }} opts
   */
  constructor(opts) {
    this.url = opts.url;
    this.gatewayToken = opts.gatewayToken;
    this.agentId = opts.agentId;
    this.log = opts.log;
    this.reconnectMinMs = opts.reconnectMinMs ?? 500;
    this.reconnectMaxMs = opts.reconnectMaxMs ?? 10_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;

    this.ws = null;
    this.connected = false;
    this.connecting = false;

    this._closedByUser = false;
    this._reconnectAttempt = 0;

    this._pending = new Map(); // id -> {resolve,reject,timeout}

    this.sessionId = null;
  }

  async connect() {
    if (this.connected) return;
    if (this.connecting) return;
    this.connecting = true;
    this._closedByUser = false;

    const headers = {};
    if (this.gatewayToken) headers['Authorization'] = `Bearer ${this.gatewayToken}`;

    while (!this.connected && !this._closedByUser) {
      try {
        this.log.info({ url: this.url }, 'openclaw: connecting ws');
        await this._connectOnce(headers);
        this._reconnectAttempt = 0;
        this.connected = true;
        this.connecting = false;

        this.log.info('openclaw: ws connected');
        await this._ensureSession();
        return;
      } catch (err) {
        this.connected = false;
        this.connecting = false;

        const wait = Math.min(
          this.reconnectMaxMs,
          this.reconnectMinMs * Math.pow(2, this._reconnectAttempt++)
        );
        this.log.error({ err, wait }, 'openclaw: connect failed, retrying');
        await sleep(wait);
        this.connecting = true;
      }
    }
  }

  close() {
    this._closedByUser = true;
    try {
      this.ws?.close();
    } catch {}
  }

  async ask(text) {
    if (!this.connected) await this.connect();
    if (!this.sessionId) await this._ensureSession();

    const requestId = nanoid();
    const payload = {
      id: requestId,
      type: 'message.create',
      sessionId: this.sessionId,
      message: {
        role: 'user',
        content: text,
      },
    };

    const completedPromise = this._waitFor(requestId, this.requestTimeoutMs);
    this._send(payload);

    const result = await completedPromise;
    if (typeof result?.content === 'string') return result.content;
    if (typeof result?.text === 'string') return result.text;
    return '';
  }

  _send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('openclaw: ws not open');
    }
    this.ws.send(JSON.stringify(obj));
  }

  _waitFor(id, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`openclaw: timeout waiting for ${id}`));
      }, timeoutMs);

      this._pending.set(id, { resolve, reject, timeout });
    });
  }

  async _ensureSession() {
    if (this.sessionId) return this.sessionId;
    const id = nanoid();
    const p = this._waitFor(id, this.requestTimeoutMs);

    this._send({
      id,
      type: 'session.create',
      agentId: this.agentId,
    });

    const res = await p;
    if (!res?.sessionId) throw new Error('openclaw: session.create no sessionId');
    this.sessionId = res.sessionId;
    this.log.info({ sessionId: this.sessionId, agentId: this.agentId }, 'openclaw: session created');
    return this.sessionId;
  }

  _connectOnce(headers) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, { headers });
      this.ws = ws;

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const onOpen = () => {
        cleanupOpenOnly();
        resolve();
      };

      const onClose = (code, reason) => {
        this.connected = false;
        this.sessionId = null;
        this.log.error({ code, reason: reason?.toString?.() }, 'openclaw: ws closed');
      };

      const onMessage = (buf) => {
        let msg;
        try {
          msg = JSON.parse(buf.toString('utf8'));
        } catch (err) {
          this.log.warn({ err }, 'openclaw: invalid json');
          return;
        }

        if (msg?.type === 'connect.challenge') {
          this.log.info('openclaw: received connect.challenge');
          const reply = {
            id: msg.id ?? nanoid(),
            type: 'connect.challenge.response',
          };
          try {
            this._send(reply);
          } catch (err) {
            this.log.error({ err }, 'openclaw: failed to answer challenge');
          }
          return;
        }

        if (msg?.id && this._pending.has(msg.id)) {
          const p = this._pending.get(msg.id);
          clearTimeout(p.timeout);
          this._pending.delete(msg.id);
          p.resolve(msg);
          return;
        }

        if (msg?.type === 'session.created' && msg?.sessionId && !this.sessionId) {
          this.sessionId = msg.sessionId;
          return;
        }
      };

      const cleanup = () => {
        ws.removeListener('open', onOpen);
        ws.removeListener('error', onError);
        ws.removeListener('close', onClose);
        ws.removeListener('message', onMessage);
      };

      const cleanupOpenOnly = () => {
        ws.removeListener('open', onOpen);
        ws.removeListener('error', onError);
      };

      ws.on('open', onOpen);
      ws.on('error', onError);
      ws.on('close', onClose);
      ws.on('message', onMessage);
    });
  }
}

module.exports = { OpenClawClient };
