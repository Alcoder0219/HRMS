#!/usr/bin/env node
/**
 * HRMS biometric gateway -- runs on an always-on machine in the office.
 *
 *   MB360 (LAN, plain HTTP) ──▶ this gateway ──HTTPS + token──▶ HRMS /iclock
 *
 * A ZKTeco terminal in ADMS mode speaks plain HTTP and carries no credential.
 * Pointing it straight at the internet means trusting its TLS support (often
 * missing or broken on older firmware) and an endpoint that anyone who learns a
 * serial number can write to. The gateway removes both problems: the terminal
 * only ever talks to a machine on its own LAN, and the HRMS only accepts
 * requests that arrive over HTTPS carrying a secret the terminal never holds.
 *
 * What it does, and nothing more:
 *   - accepts connections ONLY from the terminal addresses listed
 *   - forwards ONLY the /iclock/ paths, GET and POST, with a size cap
 *   - adds X-ADMS-Gateway-Token, and strips any forwarded-for or token header
 *     the caller tried to supply
 *   - relays the HRMS's plain-text reply and status code back unchanged, so
 *     the terminal's own retry logic keeps working
 *   - never logs a request body
 *
 * No dependencies: Node 18+ only. Configuration is read from the environment,
 * or from a `gateway.env` file next to this script. Nothing is written to disk.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ config */

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, 'gateway.env');

if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trim().startsWith('#') && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

const config = {
  listenHost: process.env.LISTEN_HOST || '0.0.0.0',
  listenPort: Number(process.env.LISTEN_PORT || 8081),
  upstream: (process.env.UPSTREAM_URL || '').replace(/\/+$/, ''),
  token: process.env.GATEWAY_TOKEN || '',
  allowedDevices: (process.env.ALLOWED_DEVICE_IPS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
  allowInsecureUpstream: process.env.ALLOW_INSECURE_UPSTREAM === 'true',
  maxBodyBytes: Number(process.env.MAX_BODY_KB || 1024) * 1024,
  timeoutMs: Number(process.env.UPSTREAM_TIMEOUT_SECONDS || 25) * 1000,
};

const fail = (message) => {
  console.error(`[gateway] ${message}`);
  process.exit(1);
};

if (!config.upstream) fail('UPSTREAM_URL is required, e.g. https://hrms-backend-xxxx.asia-south1.run.app');
if (!config.upstream.startsWith('https://') && !config.allowInsecureUpstream) {
  fail('UPSTREAM_URL must be https:// -- the token would otherwise cross the internet in clear text');
}
if (config.token.length < 24) fail('GATEWAY_TOKEN must be set to the same long random value as ADMS_GATEWAY_TOKEN on the HRMS');
if (!config.allowedDevices.length) fail('ALLOWED_DEVICE_IPS is required: the LAN address(es) of the terminal(s)');

/* ------------------------------------------------------------------ server */

const log = (message, extra = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), message, ...extra }));

const reply = (res, status, text) => {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(text);
};

const clientAddress = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '');

const server = http.createServer((req, res) => {
  const from = clientAddress(req);
  const url = new URL(req.url, 'http://gateway.local');

  if (!config.allowedDevices.includes(from)) {
    log('Refused: address not allowed', { from, path: url.pathname });
    return reply(res, 403, 'FORBIDDEN');
  }

  if (!url.pathname.startsWith('/iclock/') || !['GET', 'POST'].includes(req.method)) {
    return reply(res, 404, 'Not Found');
  }

  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > config.maxBodyBytes) {
      aborted = true;
      reply(res, 413, 'TOO LARGE');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', async () => {
    if (aborted) return;

    const started = Date.now();
    const target = `${config.upstream}${url.pathname}${url.search}`;

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: {
          // Only what the receiver needs. The caller's own headers -- including
          // any X-Forwarded-For or token it invented -- are not passed on.
          'Content-Type': req.headers['content-type'] || 'text/plain',
          'User-Agent': req.headers['user-agent'] || 'iClock',
          'X-ADMS-Gateway-Token': config.token,
        },
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        signal: AbortSignal.timeout(config.timeoutMs),
        redirect: 'error',
      });

      const text = await upstream.text();
      reply(res, upstream.status, text);

      log('Forwarded', {
        from,
        path: url.pathname,
        table: url.searchParams.get('table') || undefined,
        status: upstream.status,
        bytes: size,
        ms: Date.now() - started,
      });
    } catch (error) {
      // A 502 keeps the punches on the terminal: it retries after ErrorDelay.
      log('Upstream unreachable', { from, path: url.pathname, error: error.message });
      reply(res, 502, 'UPSTREAM UNAVAILABLE');
    }
  });
});

server.listen(config.listenPort, config.listenHost, () => {
  log('Biometric gateway listening', {
    listen: `${config.listenHost}:${config.listenPort}`,
    upstream: config.upstream,
    allowedDevices: config.allowedDevices,
  });
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
