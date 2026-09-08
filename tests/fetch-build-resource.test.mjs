import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBuildBytes } from '../scripts/fetch-build-resource.mjs';

test('build download retries a connection reset while reading the body', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) return { ok: true, arrayBuffer: async () => { throw new TypeError('ECONNRESET'); } };
    return new Response('verified-source');
  });
  assert.equal((await fetchBuildBytes('https://example.test/source')).toString(), 'verified-source');
  assert.equal(calls, 2);
});

test('permanent missing resource is not retried or accepted as fallback', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return new Response('', { status: 404 }); });
  await assert.rejects(fetchBuildBytes('https://example.test/missing'), /Build resource unavailable/);
  assert.equal(calls, 1);
});

test('transient server failure is bounded to three attempts', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return new Response('', { status: 502 }); });
  await assert.rejects(fetchBuildBytes('https://example.test/unavailable'), /Build resource unavailable/);
  assert.equal(calls, 3);
});
