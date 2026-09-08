import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Boots the built production server and checks what a browser actually
 * receives. This replaces a test that imported the Cloudflare Worker bundle
 * directly; there is no bundle to import now, so the server is started the way
 * App Hosting starts it.
 */
const port = 3000 + (process.pid % 1000);
const origin = `http://127.0.0.1:${port}`;
let server;

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`The server exited early with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(origin, { headers: { accept: "text/html" } });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`The server did not start within ${timeoutMs}ms`);
}

before(async () => {
  // Next's CLI entry is run with this Node binary rather than through `npx`.
  // Going via `npx` would mean spawning `npx.cmd` on Windows, which Node
  // refuses without `shell: true`, and `shell: true` with arguments is itself
  // deprecated. `detached` gives the server its own process group so the whole
  // tree can be signalled on teardown.
  const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  server = spawn(process.execPath, [nextCli, "start", "-p", String(port)], {
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  await waitForServer();
});

after(() => {
  if (!server?.pid) return;
  // `next start` spawns children; killing only the parent leaves the port held.
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    process.kill(-server.pid, "SIGTERM");
  }
});

test("renders the production app metadata and install manifest", async () => {
  const response = await fetch(origin, { headers: { accept: "text/html" } });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Fixed Income Tracker<\/title>/i);
  assert.match(html, /<link[^>]+rel=["']manifest["'][^>]+href=["']\/manifest\.webmanifest["']/i);
});

test("serves the security headers the Worker used to add", async () => {
  const response = await fetch(origin, { headers: { accept: "text/html" } });
  const csp = response.headers.get("content-security-policy") ?? "";

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
  // Google sign-in uses a popup, which a strict same-origin policy would block.
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src[^;]*identitytoolkit\.googleapis\.com/);
  assert.match(csp, /connect-src[^;]*api\.razorpay\.com/);
});

test("API responses are never cached", async () => {
  // Unauthenticated, so this is a 401 — the header must be set regardless.
  const response = await fetch(`${origin}/api/investments`);

  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});
