// Root start script: from a fresh clone, `npm start` brings everything up.
//
// It is deliberately tolerant of the project's evolving state:
//   - installs dependencies (root + workspaces) when node_modules is missing
//   - compiles the TypeScript server when server/dist is missing
//   - builds the web app when web/dist is missing, but only if web/ exists
//   - then runs the compiled server on port 3002
//
// If web/ does not exist yet, the server still starts and serves /api; the
// static + SPA fallback simply has nothing to serve until the frontend lands.

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const serverDir = join(root, "server");
const webDir = join(root, "web");
const rootModules = join(root, "node_modules");

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

// 1. Install dependencies if missing. npm workspaces hoist everything into the
// root node_modules, so its presence is a good proxy for "installed".
if (!existsSync(rootModules)) {
  console.log("Installing dependencies (first run)...");
  run("npm install");
}

// npm 11's allow-scripts policy may skip native-module install scripts during
// `npm install`. better-sqlite3 needs its native binding compiled (no prebuilt
// binary exists for some Node/arch combinations), so rebuild it explicitly if
// the .node file is absent. Idempotent and fast when already built.
const sqliteBinding = join(
  rootModules,
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);
if (!existsSync(sqliteBinding)) {
  console.log("Building native module: better-sqlite3...");
  run("npm rebuild better-sqlite3");
}

// 2. Build the server's TypeScript if the compiled output is missing. The
// server's start script assumes dist/ exists, so this is mandatory before run.
const serverDist = join(serverDir, "dist");
if (!existsSync(serverDist)) {
  console.log("Building server...");
  run("npm -w server run build");
}

// 3. Build the web app if present and not already built. Tolerant of a missing
// web/ workspace (the project starts greenfield-server-only).
if (existsSync(webDir)) {
  const webDist = join(webDir, "dist");
  if (!existsSync(webDist)) {
    console.log("Building web...");
    try {
      run("npm -w web run build");
    } catch {
      console.warn("Web build failed or no build script; continuing. /api still works.");
    }
  }
}

// 4. Start the server (foreground so the process blocks and Ctrl-C works).
console.log("Starting server on http://localhost:3002 ...");
const child = spawn("npm", ["-w", "server", "run", "start"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
