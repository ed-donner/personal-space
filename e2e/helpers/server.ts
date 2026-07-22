import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DB_DIR = path.resolve(import.meta.dirname, '..', 'tmp');

export interface ServerHandle {
  port: number;
  dbPath: string;
  pid: number;
  /** Wait for the server to be ready (health endpoint returns ok). */
  waitForReady(): Promise<void>;
  /** Kill the server process. */
  kill(): Promise<void>;
}

/**
 * Start the Personal Space server on a test port with a fresh database.
 * Returns a handle that can be used to stop the server later.
 */
export async function startServer(dbPath?: string): Promise<ServerHandle> {
  fs.mkdirSync(DB_DIR, { recursive: true });

  const resolvedDb = dbPath ?? path.join(DB_DIR, `test-${Date.now()}.db`);
  const port = 3100 + Math.floor(Math.random() * 900);

  const child = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_PATH: resolvedDb,
      PORT: String(port),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  const handle: ServerHandle = {
    port,
    dbPath: resolvedDb,
    pid: child.pid!,
    async waitForReady() {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://localhost:${port}/api/health`);
          if (res.ok) return;
        } catch {
          // not ready yet
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(`Server on port ${port} did not become ready within 30s`);
    },
    async kill() {
      return new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        };
        child.on('exit', done);
        // Kill the entire process group (detached: true gives us a group)
        try {
          process.kill(-child.pid!, 'SIGTERM');
        } catch {
          // already dead
        }
        // Force kill after 1s if still alive
        setTimeout(() => {
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {
            // already dead
          }
          // Unref so this handle doesn't block the event loop
          child.unref();
          done();
        }, 1000);
      });
    },
  };

  return handle;
}

/** Remove a database file and its WAL/SHM companions. */
export function cleanupDb(dbPath: string): void {
  for (const ext of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + ext);
    } catch {
      // ignore
    }
  }
}
