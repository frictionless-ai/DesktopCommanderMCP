import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Limits bound memory, not which commands the host account may execute.
const OUTPUT_LIMIT = 256 * 1024;
export class Processes {
  sessions = new Map();

  start(command, cwd, shell) {
    if (this.sessions.size >= 64) {
      for (const [id, session] of this.sessions) {
        if (session.done) this.sessions.delete(id);
        if (this.sessions.size < 64) break;
      }
      if (this.sessions.size >= 64) throw new Error('64 active sessions; stop a session first.');
    }
    const child = spawn(command, {
      cwd, shell: shell || true, stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const id = randomUUID();
    const session = { child, output: '', dropped: 0, done: false, exitCode: null, signal: null };
    const append = text => {
      session.output += text;
      if (session.output.length > OUTPUT_LIMIT) {
        session.dropped += session.output.length - OUTPUT_LIMIT;
        session.output = session.output.slice(-OUTPUT_LIMIT);
      }
    };
    child.stdout.setEncoding('utf8').on('data', append);
    child.stderr.setEncoding('utf8').on('data', append);
    child.stdin.on('error', error => append(`\nstdin: ${error.message}\n`));
    child.on('error', error => { session.error = error.message; });
    child.on('close', (code, signal) => {
      session.done = true;
      session.exitCode = code;
      session.signal = signal;
    });
    this.sessions.set(id, session);
    return { session_id: id, pid: child.pid };
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Unknown or expired session');
    return session;
  }

  read(id) {
    const s = this.get(id);
    const result = { session_id: id, output: s.output, dropped_characters: s.dropped,
      done: s.done, exit_code: s.exitCode, signal: s.signal, error: s.error };
    s.output = '';
    s.dropped = 0;
    return result;
  }

  input(id, text, eof = false) {
    const s = this.get(id);
    if (s.done || s.child.stdin.destroyed) throw new Error('Session stdin is closed');
    if (eof) s.child.stdin.end(text);
    else s.child.stdin.write(text);
    return { session_id: id, sent: true };
  }

  stop(id) {
    const s = this.get(id);
    if (s.done) return { session_id: id, stop_requested: false, done: true };
    // Kill the session's process group on POSIX, including children of the shell.
    try {
      if (process.platform !== 'win32' && s.child.pid) process.kill(-s.child.pid, 'SIGKILL');
      else if (!s.done) s.child.kill('SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    return { session_id: id, stop_requested: true };
  }

  close() {
    for (const id of this.sessions.keys()) this.stop(id);
  }
}
