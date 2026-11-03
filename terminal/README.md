# Desktop Commander Terminal

This fork adds a small, independent terminal-only MCP server. Install this directory,
not the root package, to avoid the desktop UI, document processing, telemetry,
onboarding, remote relay, and full upstream dependency set. The upstream server
remains available separately. The original MIT license in `../LICENSE` is retained.

Requires Node.js 22.12 or later:

```sh
git clone https://github.com/bodencrouch/DesktopCommanderMCP.git
cd DesktopCommanderMCP/terminal
npm ci --ignore-scripts
npm test
npm start
```

Configure your MCP client with the absolute path to the server:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "node",
      "args": ["/absolute/path/DesktopCommanderMCP/terminal/server.mjs"]
    }
  }
}
```

Four tools: `start_process`, `read_process_output`, `write_process_input`, and
`stop_process`. Start returns a session ID immediately. Poll for output and completion;
write input with `eof: true` when the command should receive end-of-input. Supply `cwd`
and optionally a shell executable to start. The default shell is Node's platform
default (`/bin/sh` on POSIX, `ComSpec` on Windows). Each command starts a new shell;
environment and directory changes do not persist between sessions.

There is no application command blocklist, directory allowlist, approval prompt,
or sudo decision. Commands run as the account launching the server with its existing
environment and permissions. This is powerful access: a connected client can change
or delete anything that account can access. OS permissions and sudo authentication
still apply. The server does not grant root, change sudoers, or modify credentials.
Client-side confirmations remain controlled by your MCP client.

The transport is local stdio: no listening port, unauthenticated HTTP endpoint, or
new remote authentication system. Existing upstream remote authentication code is
untouched. This package does not connect directly to a web-only MCP client; any
remote transport would need a separately authenticated connection.

Processes use pipes, not a PTY. Commands requiring a real terminal (including some
sudo configurations and full-screen programs) may fail; errors are returned as-is.
Do not send passwords through tool arguments. Stop kills the process group on POSIX;
on Windows it stops only the shell, so descendants may survive. Detached descendants
that create their own sessions may also survive on POSIX. No command timeout is
imposed. Output retains the latest 256K characters per session and reports truncation;
reading consumes it. At most 64 sessions are retained, evicting completed sessions
when needed. Stop active sessions explicitly when finished. Server disconnect requests
cleanup of retained process groups.

Validation: `npm test` exercises a real MCP stdio client plus isolated process tests.
The sudo-name check uses a harmless local fixture and never invokes real sudo.
Tests currently target POSIX; Windows behavior has not been validated.

Upstream audit: baseline `c2b87956217b58d170de58a0c951a3569b068ee3`.
The full server's `blockedCommands: []` configuration already disables command-name
filtering, but keeps all desktop dependencies and features. Existing forks inspected
include `delano/DesktopCommanderMCP-with-privacy` and `regismesquita/DevControlMCP`;
their descriptions retain broader terminal/file-editing functionality. This independent
entrypoint keeps the change narrow without weakening those upstream paths.
