import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register(new URL("./cloudflare-loader.mjs", import.meta.url));

test("renders the production app metadata and install manifest", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>Fixed Income Tracker<\/title>/i);
  assert.match(html, /<link[^>]+rel=["']manifest["'][^>]+href=["']\/manifest\.webmanifest["']/i);
});
