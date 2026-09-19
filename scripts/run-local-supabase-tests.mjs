import { checkProspectiveStrategyDatasets } from "./check-prospective-strategy-datasets.mjs";
/** Local test stack only. Does not load application env files or deploy anything. */
import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { checkExecutionFinalGuard } from "./check-execution-final-guard.mjs";
import { checkExecutionFillProvenance } from "./check-execution-fill-provenance.mjs";
import { checkExecutionReconciliation } from "./check-execution-reconciliation.mjs";
import { runDataGapRevisitChecks } from "./check-data-gap-revisit.mjs";
import { checkWalletEvidenceWindow } from "./check-wallet-evidence-window.mjs";
import { checkIntelligenceProvenance } from "./check-intelligence-provenance.mjs";
import { checkFrontendPaperSnapshot } from "./check-frontend-paper-snapshot.mjs";
import { checkDemoAccountReconciliation } from "./check-demo-account-reconciliation.mjs";

const [mode, projectDirectory, cliPath, ...extra] = process.argv.slice(2);
if (!["status", "sql", "integration"].includes(mode) || !projectDirectory || !cliPath) {
  throw new Error("Usage: run-local-supabase-tests.mjs status|sql|integration <isolated-project-directory> <supabase-cli|--docker> [pg-package-directory|test-filters...]");
}
const projectId = "market-intelligence-backend-local";
const operatingEnvironment = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|appdata|localappdata|userprofile|pathext|programdata|programfiles|programfiles\(x86\)|number_of_processors|processor_architecture)$/i.test(key)));
function inspectLocal(name, internalPort, externalPort) {
  const run = spawnSync("docker", ["inspect", name], { encoding: "utf8", windowsHide: true, timeout: 15_000, env: operatingEnvironment });
  assert.equal(run.status, 0, "Expected isolated Docker container must exist");
  const info = JSON.parse(run.stdout)[0];
  assert.equal(info.Name, `/${name}`);
  assert.equal(info.State.Running, true);
  assert.equal(info.Config.Labels["com.supabase.cli.project"], projectId);
  assert.equal(resolve(info.Config.Labels["com.supabase.cli.workdir"]), resolve(projectDirectory));
  assert.ok(info.NetworkSettings.Ports[`${internalPort}/tcp`].some(binding => binding.HostPort === String(externalPort)));
  return info;
}
const databaseInfo = inspectLocal(`supabase_db_${projectId}`, 5432, 57422);
let status;
if (cliPath === "--docker") {
  // Recover credentials only from this already-verified disposable stack.
  // They stay in memory and are never logged or read from application env files.
  const gateway = `supabase_kong_${projectId}`;
  const gatewayInfo = inspectLocal(gateway, 8000, 57421);
  const configPath = gatewayInfo.Config.Env.find(value => value.startsWith("KONG_DECLARATIVE_CONFIG="))?.split("=").slice(1).join("=");
  assert.ok(configPath?.startsWith("/"), "Local gateway configuration is required");
  const configRun = spawnSync("docker", ["exec", gateway, "cat", configPath], { encoding: "utf8", windowsHide: true, timeout: 15_000, env: operatingEnvironment });
  assert.equal(configRun.status, 0, "Local gateway configuration must be readable");
  const keys = {};
  for (const token of configRun.stdout.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
      if (["anon", "service_role"].includes(payload.role)) keys[payload.role] = token;
    } catch { /* Ignore values that are not JWTs. */ }
  }
  assert.ok(keys.service_role, "Local gateway must contain a service-role test key");
  const password = databaseInfo.Config.Env.find(value => value.startsWith("POSTGRES_PASSWORD="))?.slice("POSTGRES_PASSWORD=".length);
  assert.ok(password, "Local database password is required");
  status = { API_URL: "http://127.0.0.1:57421", DB_URL: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:57422/postgres`, SERVICE_ROLE_KEY: keys.service_role, ANON_KEY: keys.anon };
} else {
  const config = await readFile(join(resolve(projectDirectory), "supabase/config.toml"), "utf8");
  assert.match(config, /^project_id = "market-intelligence-backend-local"$/m);
  assert.match(config, /^port = 57421$/m);
  assert.match(config, /^port = 57422$/m);
  assert.equal(config.includes("env(MIGRATION_DATABASE_URL)"), false);
  const statusRun = spawnSync(resolve(cliPath), ["status", "--workdir", resolve(projectDirectory), "--output", "json"],
    { encoding: "utf8", windowsHide: true, timeout: 30_000, env: { ...operatingEnvironment, SUPABASE_TELEMETRY_DISABLED: "1" } });
  assert.equal(statusRun.status, 0, "Local Supabase must be healthy before testing");
  status = JSON.parse(statusRun.stdout);
}
const api = new URL(status.API_URL), database = new URL(status.DB_URL);
assert.equal(api.origin, "http://127.0.0.1:57421");
assert.equal(api.pathname, "/");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, "57422");
assert.equal(database.pathname, "/postgres");
assert.equal(database.protocol, "postgresql:");
assert.equal(database.search, "");
assert.ok(typeof status.SERVICE_ROLE_KEY === "string" && status.SERVICE_ROLE_KEY.length > 20);
console.log("Verified isolated Docker Supabase: http://127.0.0.1:57421; no application/provider credentials loaded.");

if (mode === "sql") {
  assert.ok(extra[0], "A temporary pg package directory is required for SQL checks");
  const pg = await import(pathToFileURL(join(resolve(extra[0]), "lib/index.js")).href);
  const client = new pg.default.Client({ connectionString: status.DB_URL, application_name: "market-intelligence-local-sql-checks" });
  await client.connect();
  try {
    assert.equal((await client.query("select count(*)::int n from supabase_migrations.schema_migrations")).rows[0].n, 100);
    await client.query("set search_path=public,extensions; set statement_timeout='30s'");
    const db = { query: (sql, params) => client.query(sql, params), exec: sql => client.query(sql),
      parallel: async (sql, parameterSets) => {
        const connections = parameterSets.map(() => new pg.default.Client({ connectionString: status.DB_URL, application_name: "demo-claim-race" }));
        try {
          await Promise.all(connections.map(async connection => { await connection.connect(); await connection.query("set role service_role; set search_path=public,extensions; set statement_timeout='15s'"); }));
          return await Promise.all(connections.map((connection, index) => connection.query(sql, parameterSets[index])));
        } finally { await Promise.all(connections.map(connection => connection.end())); }
      } };
    await checkDemoAccountReconciliation(db);
    await checkIntelligenceProvenance(db);
    await checkProspectiveStrategyDatasets(db);
    await runDataGapRevisitChecks(db);
    await checkExecutionFinalGuard(db);
    await checkExecutionFillProvenance(db);
    await checkFrontendPaperSnapshot(db);
    await checkWalletEvidenceWindow(db);
    await checkExecutionReconciliation(db);
    console.log("Real PostgreSQL SQL/role/rollback checks passed. Fixtures remain in this disposable local database.");
  } finally { await client.end(); }
} else if (mode === "integration") {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = (await readdir(join(root, "tests")))
    .filter(name => /^supabase-.*\.integration\.test\.ts$/.test(name))
    .filter(name => !extra.length || extra.some(filter => name.includes(filter)))
    .sort((a, b) => Number(a.includes("forecast-scheduler")) - Number(b.includes("forecast-scheduler")) || a.localeCompare(b))
    .map(name => join("tests", name));
  assert.ok(files.length, "No integration test files matched");
  const env = { ...operatingEnvironment, RUN_SUPABASE_INTEGRATION: "1", SUPABASE_TEST_ALLOW_WRITES: "1",
    SUPABASE_TEST_URL: api.origin, SUPABASE_TEST_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY };
  const child = spawn(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", ...files, "--no-file-parallelism", "--reporter=verbose"],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const secrets = [status.SERVICE_ROLE_KEY, status.ANON_KEY, status.SECRET_KEY].filter(Boolean);
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", line => {
      for (const secret of secrets) line = line.replaceAll(secret, "[LOCAL_TEST_KEY]");
      console.log(line);
    });
  }
  process.exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => resolve(code ?? 1)); });
}
