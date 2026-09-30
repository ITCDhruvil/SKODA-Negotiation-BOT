// Fails when lib/api-types.ts differs from what ../backend/openapi.json generates.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const cli = join(require.resolve("openapi-typescript/package.json"), "..", "bin", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "api-types-"));
const out = join(dir, "api-types.ts");
try {
  const run = spawnSync(process.execPath, [cli, "../backend/openapi.json", "-o", out], { stdio: "inherit" });
  if (run.status !== 0) process.exit(run.status ?? 1);
  const norm = (f) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  if (norm(out) !== norm("lib/api-types.ts")) {
    console.error("lib/api-types.ts is out of date with backend/openapi.json. Run: npm run gen:types");
    process.exit(1);
  }
  console.log("lib/api-types.ts is up to date.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
