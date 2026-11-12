import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the real gateway.js as a child process against a stand-in HRMS on
 * localhost. Nothing leaves this machine and no real gateway, terminal or HRMS
 * is contacted.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const K40PRO = 'GED7253100014';
const MB360 = 'UEED245000038';
const TOKEN = 'test-gateway-token-0123456789abcdef';

const freePort = () =>
  new Promise((resolve) => {
    const probe = http.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** A stand-in HRMS: records what it receives and answers like the real receiver. */
const startUpstream = async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      const url = new URL(req.url, 'http://upstream.local');
      // A header the gateway must never pass through to a terminal.
      res.setHeader('X-Upstream-Only', 'yes');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      if (url.pathname === '/iclock/cdata' && url.searchParams.get('options') === 'all') {
        res.end(`GET OPTION FROM: ${url.searchParams.get('SN')}\nATTLOGStamp=None\nDelay=30`);
      } else {
        res.end('OK');
      }
    });
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, received, url: `http://127.0.0.1:${port}` };
};

/** Starts gateway.js with the given settings and resolves once it is listening. */
const startGateway = async ({ upstream, omit, allowed = '127.0.0.1', script = path.join(here, 'gateway.js') }) => {
  const port = await freePort();
  const env = {
    ...process.env,
    LISTEN_HOST: '127.0.0.1',
    LISTEN_PORT: String(port),
    UPSTREAM_URL: upstream,
    ALLOW_INSECURE_UPSTREAM: 'true',
    GATEWAY_TOKEN: TOKEN,
    ALLOWED_DEVICE_IPS: allowed,
    UPSTREAM_TIMEOUT_SECONDS: '5',
    LOG_HEARTBEATS: 'false',
  };
  delete env.NO_DATE_HEADER_SERIALS;
  if (omit !== undefined) env.NO_DATE_HEADER_SERIALS = omit;

  const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`gateway did not start: ${lines.join('\n')}`)), 10_000);
    const onData = (data) => {
      lines.push(...String(data).split('\n').filter(Boolean));
      if (lines.some((line) => line.includes('Biometric gateway listening'))) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`gateway exited ${code}: ${lines.join('\n')}`)));
  });
  return { child, lines, url: `http://127.0.0.1:${port}` };
};

const stop = (gateway) =>
  new Promise((resolve) => {
    gateway.child.removeAllListeners('exit');
    gateway.child.once('exit', resolve);
    gateway.child.kill();
  });

/** A raw request, so every header the gateway sends is visible exactly as sent. */
const call = (base, pathAndQuery, { method = 'GET', body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(`${base}${pathAndQuery}`, { method, agent: false, headers: body ? { 'Content-Type': 'text/plain' } : {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });

const headerNames = (response) => Object.keys(response.headers).sort();

const ATTLOG = '7\t2026-11-12 08:31:00\t0\t1\t0\t0\t0\t0\t0\t0\n';

describe('gateway with NO_DATE_HEADER_SERIALS=GED7253100014 (the 8082 test copy)', () => {
  let upstream;
  let gateway;

  before(async () => {
    upstream = await startUpstream();
    gateway = await startGateway({ upstream: upstream.url, omit: K40PRO });
  });

  after(async () => {
    await stop(gateway);
    await new Promise((resolve) => upstream.server.close(resolve));
  });

  test('the K40PRO handshake reply has no Date header; its body and status are relayed unchanged', async () => {
    const response = await call(gateway.url, `/iclock/cdata?SN=${K40PRO}&options=all&pushver=2.4.1`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.date, undefined);
    assert.ok(!response.rawHeaders.some((name) => name.toLowerCase() === 'date'), 'not even an empty Date header');
    assert.equal(response.body, `GET OPTION FROM: ${K40PRO}\nATTLOGStamp=None\nDelay=30`);
  });

  test('the MB360 handshake reply keeps its Date header, a real current GMT time', async () => {
    const response = await call(gateway.url, `/iclock/cdata?SN=${MB360}&options=all&pushver=2.4.1`);
    assert.equal(response.status, 200);
    assert.match(response.headers.date, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
    assert.ok(Math.abs(new Date(response.headers.date) - Date.now()) < 5_000, 'the real time, not a shifted one');
    assert.equal(response.body, `GET OPTION FROM: ${MB360}\nATTLOGStamp=None\nDelay=30`);
  });

  test('apart from Date, the two terminals receive exactly the same headers', async () => {
    const k40 = await call(gateway.url, `/iclock/getrequest?SN=${K40PRO}`);
    const mb360 = await call(gateway.url, `/iclock/getrequest?SN=${MB360}`);
    assert.deepEqual(headerNames(k40), headerNames(mb360).filter((name) => name !== 'date'));
    assert.equal(k40.headers['content-type'], mb360.headers['content-type']);
    assert.equal(k40.headers['x-upstream-only'], undefined, 'upstream headers are still not passed through');
    assert.equal(k40.body, 'OK');
  });

  test('every ADMS path for the K40PRO omits Date; the same paths for the MB360 keep it', async () => {
    const paths = [
      ['GET', '/iclock/cdata?SN={SN}&options=all'],
      ['POST', '/iclock/cdata?SN={SN}&table=ATTLOG&Stamp=9999'],
      ['POST', '/iclock/cdata?SN={SN}&table=OPERLOG&Stamp=9999'],
      ['GET', '/iclock/getrequest?SN={SN}'],
      ['POST', '/iclock/getrequest?SN={SN}'],
      ['POST', '/iclock/devicecmd?SN={SN}'],
      ['GET', '/iclock/registry?SN={SN}'],
      ['GET', '/iclock/ping?SN={SN}'],
    ];
    for (const [method, template] of paths) {
      const body = method === 'POST' ? ATTLOG : undefined;
      const k40 = await call(gateway.url, template.replace('{SN}', K40PRO), { method, body });
      const mb360 = await call(gateway.url, template.replace('{SN}', MB360), { method, body });
      assert.equal(k40.status, 200, `${method} ${template}`);
      assert.equal(k40.headers.date, undefined, `K40PRO ${method} ${template}`);
      assert.ok(mb360.headers.date, `MB360 ${method} ${template}`);
    }
  });

  test('punches are forwarded to HRMS byte for byte, with the token and the terminal address', async () => {
    upstream.received.length = 0;
    await call(gateway.url, `/iclock/cdata?SN=${K40PRO}&table=ATTLOG&Stamp=9999`, { method: 'POST', body: ATTLOG });
    const [forwarded] = upstream.received;
    assert.equal(forwarded.method, 'POST');
    assert.equal(forwarded.url, `/iclock/cdata?SN=${K40PRO}&table=ATTLOG&Stamp=9999`);
    assert.equal(forwarded.body, ATTLOG, 'the punch time text is untouched');
    assert.equal(forwarded.headers['x-adms-gateway-token'], TOKEN);
    assert.equal(forwarded.headers['x-adms-device-ip'], '127.0.0.1');
  });

  test('the serial is matched however the terminal writes it, and nothing else matches', async () => {
    assert.equal((await call(gateway.url, `/iclock/getrequest?SN=${K40PRO.toLowerCase()}`)).headers.date, undefined);
    assert.equal((await call(gateway.url, `/iclock/getrequest?sn=${K40PRO}`)).headers.date, undefined);
    assert.ok((await call(gateway.url, `/iclock/getrequest?SN=${K40PRO}X`)).headers.date, 'a longer serial is another terminal');
    assert.ok((await call(gateway.url, '/iclock/getrequest')).headers.date, 'no serial at all');
  });

  test('the startup log names the terminal it applies to, and the forward log marks it', async () => {
    assert.ok(gateway.lines.some((line) => line.includes('"noDateHeaderFor":["GED7253100014"]')));
    await call(gateway.url, `/iclock/cdata?SN=${K40PRO}&table=ATTLOG`, { method: 'POST', body: ATTLOG });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(gateway.lines.some((line) => line.includes('"dateHeader":"omitted"')));
  });
});

describe('gateway with NO_DATE_HEADER_SERIALS unset (production as it runs today)', () => {
  let upstream;
  let gateway;

  before(async () => {
    upstream = await startUpstream();
    gateway = await startGateway({ upstream: upstream.url });
  });

  after(async () => {
    await stop(gateway);
    await new Promise((resolve) => upstream.server.close(resolve));
  });

  test('both terminals keep the Date header, and nothing extra is logged', async () => {
    for (const serial of [K40PRO, MB360]) {
      const response = await call(gateway.url, `/iclock/cdata?SN=${serial}&options=all`);
      assert.equal(response.status, 200);
      assert.ok(response.headers.date, serial);
    }
    assert.ok(!gateway.lines.some((line) => line.includes('noDateHeaderFor') || line.includes('dateHeader')));
  });

  test('an empty value is the same as unset', async () => {
    const blank = await startGateway({ upstream: upstream.url, omit: ' , ' });
    try {
      assert.ok((await call(blank.url, `/iclock/getrequest?SN=${K40PRO}`)).headers.date);
    } finally {
      await stop(blank);
    }
  });
});

/**
 * The committed gateway.js -- what production on 8081 runs today -- answers
 * every terminal exactly as the new file does, unless the new setting is given.
 * Skipped only when git cannot supply the committed version.
 */
const committedGateway = (() => {
  try {
    const source = execFileSync('git', ['show', 'HEAD:biometric-gateway/gateway.js'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-head-'));
    fs.writeFileSync(path.join(dir, 'gateway.js'), source);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    return path.join(dir, 'gateway.js');
  } catch {
    return null;
  }
})();

const OTHER = 'ZXP123284129';

/** Everything a terminal receives, with only the Date value blanked so two replies can be compared. */
const comparable = (response) => ({
  status: response.status,
  body: response.body,
  headers: response.rawHeaders.map((value, index) => (index % 2 === 1 && response.rawHeaders[index - 1].toLowerCase() === 'date' ? '<date>' : value)),
});

const EVERY_PATH = [
  ['GET', '/iclock/cdata?SN={SN}&options=all&pushver=2.4.1'],
  ['POST', '/iclock/cdata?SN={SN}&table=ATTLOG&Stamp=9999'],
  ['POST', '/iclock/cdata?SN={SN}&table=OPERLOG&Stamp=9999'],
  ['GET', '/iclock/getrequest?SN={SN}'],
  ['POST', '/iclock/devicecmd?SN={SN}'],
  ['GET', '/iclock/ping?SN={SN}'],
  ['GET', '/not-iclock?SN={SN}'],
];

describe('8081 (committed gateway) vs 8082 (test copy), side by side', { skip: !committedGateway && 'git cannot supply the committed gateway.js' }, () => {
  let upstream;
  let production;
  let productionNewCode;
  let testCopy;

  before(async () => {
    upstream = await startUpstream();
    production = await startGateway({ upstream: upstream.url, script: committedGateway });
    productionNewCode = await startGateway({ upstream: upstream.url });
    testCopy = await startGateway({ upstream: upstream.url, omit: K40PRO });
  });

  after(async () => {
    await Promise.all([stop(production), stop(productionNewCode), stop(testCopy)]);
    await new Promise((resolve) => upstream.server.close(resolve));
    fs.rmSync(path.dirname(committedGateway), { recursive: true, force: true });
  });

  test('with production settings, the new gateway.js answers every terminal exactly as the committed one', async () => {
    for (const serial of [MB360, K40PRO, OTHER]) {
      for (const [method, template] of EVERY_PATH) {
        const body = method === 'POST' ? ATTLOG : undefined;
        const before = await call(production.url, template.replace('{SN}', serial), { method, body });
        const after = await call(productionNewCode.url, template.replace('{SN}', serial), { method, body });
        assert.deepEqual(comparable(after), comparable(before), `${serial} ${method} ${template}`);
        assert.ok(after.headers.date, `${serial} keeps Date on the production settings`);
      }
    }
  });

  test('on the test copy, the MB360 and any other terminal get exactly what 8081 gives them', async () => {
    for (const serial of [MB360, OTHER]) {
      for (const [method, template] of EVERY_PATH) {
        const body = method === 'POST' ? ATTLOG : undefined;
        const onProduction = await call(production.url, template.replace('{SN}', serial), { method, body });
        const onTest = await call(testCopy.url, template.replace('{SN}', serial), { method, body });
        assert.deepEqual(comparable(onTest), comparable(onProduction), `${serial} ${method} ${template}`);
      }
    }
  });

  test('on the test copy, the K40PRO gets exactly what 8081 gives it, minus the Date header', async () => {
    for (const [method, template] of EVERY_PATH) {
      const body = method === 'POST' ? ATTLOG : undefined;
      const onProduction = comparable(await call(production.url, template.replace('{SN}', K40PRO), { method, body }));
      const onTest = comparable(await call(testCopy.url, template.replace('{SN}', K40PRO), { method, body }));
      const withoutDate = (headers) => headers.filter((value, index, all) => !(value.toLowerCase() === 'date' && index % 2 === 0) && !(index % 2 === 1 && all[index - 1].toLowerCase() === 'date'));
      assert.equal(onTest.status, onProduction.status, `${method} ${template}`);
      assert.equal(onTest.body, onProduction.body, `${method} ${template}`);
      assert.deepEqual(onTest.headers, withoutDate(onProduction.headers), `${method} ${template}`);
      assert.ok(!onTest.headers.some((value, index) => index % 2 === 0 && value.toLowerCase() === 'date'));
    }
  });
});

describe('gateway error replies to the K40PRO', () => {
  test('a refused address (403) and an unreachable HRMS (502) also omit Date for the K40PRO only', async () => {
    const deadPort = await freePort();
    const refusing = await startGateway({ upstream: `http://127.0.0.1:${deadPort}`, omit: K40PRO, allowed: '10.0.0.1' });
    const unreachable = await startGateway({ upstream: `http://127.0.0.1:${deadPort}`, omit: K40PRO });
    try {
      const forbiddenK40 = await call(refusing.url, `/iclock/getrequest?SN=${K40PRO}`);
      const forbiddenMb360 = await call(refusing.url, `/iclock/getrequest?SN=${MB360}`);
      assert.equal(forbiddenK40.status, 403);
      assert.equal(forbiddenK40.headers.date, undefined);
      assert.ok(forbiddenMb360.headers.date);

      const downK40 = await call(unreachable.url, `/iclock/getrequest?SN=${K40PRO}`);
      const downMb360 = await call(unreachable.url, `/iclock/getrequest?SN=${MB360}`);
      assert.equal(downK40.status, 502, 'the terminal still sees the failure and retries');
      assert.equal(downK40.headers.date, undefined);
      assert.ok(downMb360.headers.date);
    } finally {
      await stop(refusing);
      await stop(unreachable);
    }
  });
});
