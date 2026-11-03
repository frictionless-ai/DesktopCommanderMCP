import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Processes } from './processes.mjs';

async function finish(read) {
  let output = '';
  for (let i = 0; i < 200; i++) {
    const result = await read();
    output += result.output;
    if (result.done) return { ...result, output };
    await delay(20);
  }
  throw new Error('Process did not finish in test deadline');
}

test('host shell semantics, cwd, stdin, exit codes, and harmless sudo fixture', async t => {
  const p = new Processes();
  const dir = await mkdtemp(join(tmpdir(), 'dc-terminal-'));
  t.after(async () => { p.close(); await rm(dir, { recursive: true, force: true }); });
  // A local fixture named sudo proves there is no name filter without elevating privileges.
  await writeFile(join(dir, 'sudo'), '#!/bin/sh\nprintf "fixture:%s" "$1"\n', { mode: 0o700 });
  const { session_id: id } = p.start('./sudo allowed; printf ":"; pwd; cat; exit 7', dir);
  p.input(id, 'stdin-ok', true);
  const result = await finish(() => p.read(id));
  assert.match(result.output, /fixture:allowed/);
  assert.ok(result.output.includes(dir));
  assert.match(result.output, /stdin-ok/);
  assert.equal(result.exit_code, 7);
  assert.equal(p.read(id).output, '');
});

test('invalid cwd and stop are observable; output is bounded', async t => {
  const p = new Processes();
  t.after(() => p.close());
  const bad = p.start('echo unused', '/does-not-exist-dc-test');
  assert.match((await finish(() => p.read(bad.session_id))).error, /ENOENT/);
  const long = p.start('sleep 30');
  p.stop(long.session_id);
  assert.equal((await finish(() => p.read(long.session_id))).signal, 'SIGKILL');
  const noisy = p.start('node -e "process.stdout.write(\'x\'.repeat(400000))"');
  while (!p.get(noisy.session_id).done) await delay(20);
  const output = p.read(noisy.session_id);
  assert.equal(output.output.length, 256 * 1024);
  assert.equal(output.dropped_characters, 400000 - 256 * 1024);
});

test('real MCP stdio handshake, tool discovery, execution and errors', async t => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['server.mjs'], cwd: import.meta.dirname });
  const client = new Client({ name: 'terminal-test', version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 4);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const session = await call('start_process', { command: 'printf protocol-ok' });
  assert.equal((await finish(() => call('read_process_output', { session_id: session.session_id }))).output, 'protocol-ok');
  const bad = await client.callTool({ name: 'stop_process', arguments: { session_id: 'missing' } });
  assert.equal(bad.isError, true);
});
