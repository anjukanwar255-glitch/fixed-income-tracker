/**
 * Applies the generated Drizzle migrations to the local Miniflare D1 database.
 *
 * The hosting platform applies `drizzle/*.sql` itself on deploy, so this exists
 * only so that `npm run dev` has tables to talk to. Written in Node rather than
 * shell because the npm scripts run under cmd.exe on Windows.
 *
 * Statements are idempotent only in the sense that re-running a migration that
 * already applied will fail loudly; recreate the local database by deleting
 * `.wrangler/state/v3/d1` if you need a clean slate.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = fileURLToPath(new URL("./wrangler.local.jsonc", import.meta.url));
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const journal = JSON.parse(
  readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
);

for (const entry of journal.entries) {
  const file = fileURLToPath(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url));
  process.stdout.write(`Applying ${entry.tag}… `);

  // Wrangler's JS entry is run directly rather than through `npx`: Node refuses
  // to spawn a `.cmd` shim without `shell: true`, and going through a shell
  // would then need Windows-safe quoting for every path.
  const result = spawnSync(
    process.execPath,
    [
      wranglerBin,
      "d1", "execute", "DB",
      "--local",
      "--config", config,
      "--persist-to", `${root}.wrangler/state`,
      "--file", file,
    ],
    { cwd: root, encoding: "utf8" },
  );

  if (result.error || result.status !== 0) {
    process.stdout.write("failed\n");
    process.stderr.write(`${result.error?.message ?? ""}${result.stderr ?? ""}${result.stdout ?? ""}\n`);
    process.exit(1);
  }
  process.stdout.write("ok\n");
}

process.stdout.write(`Local D1 is up to date (${journal.entries.length} migrations).\n`);
