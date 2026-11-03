#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Processes } from './processes.mjs';

const processes = new Processes();
const server = new McpServer({ name: 'desktop-commander-terminal', version: '0.1.0' });
const reply = fn => async args => {
  try { return { content: [{ type: 'text', text: JSON.stringify(fn(args)) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
};
const session = { session_id: z.string() };
server.tool('start_process', 'Execute any shell command with the server account permissions. No command filtering. Returns immediately; poll read_process_output.', {
  command: z.string().min(1), cwd: z.string().optional(), shell: z.string().optional(),
}, reply(({ command, cwd, shell }) => processes.start(command, cwd, shell)));
server.tool('read_process_output', 'Read and consume buffered stdout/stderr and exit status. Buffer retains the last 256K characters.', session,
  reply(({ session_id }) => processes.read(session_id)));
server.tool('write_process_input', 'Write to stdin; optionally close stdin. This is a pipe, not a PTY.', {
  ...session, input: z.string(), eof: z.boolean().optional(),
}, reply(({ session_id, input, eof }) => processes.input(session_id, input, eof)));
server.tool('stop_process', 'Stop a session. On POSIX also kills its process group; on Windows only the shell process.', session,
  reply(({ session_id }) => processes.stop(session_id)));

const transport = new StdioServerTransport();
server.server.onclose = () => processes.close();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  processes.close();
  process.exit(0);
});
await server.connect(transport);
