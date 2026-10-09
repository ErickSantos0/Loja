import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOrigin } from '../lib/request-origin.ts';

function request({
  url = 'http://localhost:5181/api/auth/login',
  origin,
  host,
  forwarded,
} = {}) {
  const headers = new Headers();
  if (origin !== undefined) headers.set('origin', origin);
  if (host !== undefined) headers.set('host', host);
  if (forwarded !== undefined) headers.set('x-forwarded-proto', forwarded);
  return { url, headers };
}

const vercel = { VERCEL: '1' };

test('local Next canonical localhost URL accepts the requested 127.0.0.1 host', () => {
  const local = request({ origin: 'http://127.0.0.1:5181', host: '127.0.0.1:5181' });
  assert.equal(isSameOrigin(local, {}), true);
});

test('local request cannot substitute its canonical URL host for its requested host', () => {
  const local = request({ origin: 'http://localhost:5181', host: '127.0.0.1:5181' });
  assert.equal(isSameOrigin(local, {}), false);
});

test('Vercel TLS uses trusted forwarded protocol and the requested production host', () => {
  const production = request({ origin: 'https://loja.exemplo.com', host: 'loja.exemplo.com', forwarded: 'https' });
  assert.equal(isSameOrigin(production, vercel), true);
});

test('Vercel HTTPS recognizes default and explicit nondefault public ports', () => {
  assert.equal(isSameOrigin(request({ origin: 'https://loja.exemplo.com', host: 'loja.exemplo.com:443', forwarded: 'https' }), vercel), true);
  assert.equal(isSameOrigin(request({ origin: 'https://loja.exemplo.com:8443', host: 'loja.exemplo.com:8443', forwarded: 'https' }), vercel), true);
  assert.equal(isSameOrigin(request({ origin: 'https://loja.exemplo.com:8443', host: 'loja.exemplo.com', forwarded: 'https' }), vercel), false);
});

test('forwarded protocol cannot be spoofed outside Vercel', () => {
  assert.equal(isSameOrigin(request({ origin: 'http://127.0.0.1:5181', host: '127.0.0.1:5181', forwarded: 'https' }), {}), true);
  assert.equal(isSameOrigin(request({ origin: 'https://127.0.0.1:5181', host: '127.0.0.1:5181', forwarded: 'https' }), {}), false);
});

test('missing Host safely falls back to the request URL', () => {
  assert.equal(isSameOrigin(request({ origin: 'http://localhost:5181' }), {}), true);
  assert.equal(isSameOrigin(request({ origin: 'http://127.0.0.1:5181' }), {}), false);
});

test('IPv6 localhost and case-insensitive DNS host headers remain supported', () => {
  assert.equal(isSameOrigin(request({ origin: 'http://[::1]:5181', host: '[::1]:5181' }), {}), true);
  assert.equal(isSameOrigin(request({ origin: 'https://loja.exemplo.com', host: 'LOJA.EXEMPLO.COM', forwarded: 'https' }), vercel), true);
});

test('external origins and lookalike domains are rejected', () => {
  for (const origin of ['https://externo.exemplo.com', 'https://loja.exemplo.com.atacante.invalid', 'https://loja.exemplo.com@atacante.invalid']) {
    assert.equal(isSameOrigin(request({ origin, host: 'loja.exemplo.com', forwarded: 'https' }), vercel), false);
  }
});

test('missing, opaque and malformed Origin headers are rejected', () => {
  for (const origin of [undefined, '', 'null', 'not-an-origin', 'https://loja.exemplo.com/', 'https://loja.exemplo.com/path', 'https://loja.exemplo.com?next=externo', 'https://loja.exemplo.com#fragment', 'https://loja.exemplo.com https://externo.exemplo.com']) {
    assert.equal(isSameOrigin(request({ origin, host: 'loja.exemplo.com', forwarded: 'https' }), vercel), false);
  }
});

test('mismatched HTTP/HTTPS protocols are rejected', () => {
  assert.equal(isSameOrigin(request({ origin: 'http://loja.exemplo.com', host: 'loja.exemplo.com', forwarded: 'https' }), vercel), false);
  assert.equal(isSameOrigin(request({ origin: 'https://loja.exemplo.com', host: 'loja.exemplo.com', forwarded: 'http' }), vercel), false);
  assert.equal(isSameOrigin(request({ origin: 'https://127.0.0.1:5181', host: '127.0.0.1:5181' }), {}), false);
});

test('malicious Host headers cannot supply a scheme, credentials, path or invalid port', () => {
  for (const host of [
    'https://loja.exemplo.com', 'usuario@loja.exemplo.com', 'loja.exemplo.com@atacante.invalid',
    'loja.exemplo.com/path', 'loja.exemplo.com\\path', 'loja.exemplo.com?x=1', 'loja.exemplo.com#fragment',
    'loja.exemplo.com, atacante.invalid', 'loja.exemplo.com:443:8443', 'loja.exemplo.com:99999', '[::1', '[not-ipv6]',
  ]) {
    assert.equal(isSameOrigin(request({ origin: 'https://loja.exemplo.com', host, forwarded: 'https' }), vercel), false, host);
  }
});

test('malformed request URLs and non-HTTP protocols fail closed', () => {
  assert.equal(isSameOrigin(request({ url: 'not-a-url', host: 'localhost', origin: 'http://localhost' }), {}), false);
  assert.equal(isSameOrigin(request({ url: 'file:///api/auth/login', host: 'localhost', origin: 'null' }), {}), false);
  assert.equal(isSameOrigin(request({ url: 'ftp://localhost/api/auth/login', host: 'localhost', origin: 'ftp://localhost' }), {}), false);
});
