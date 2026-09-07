import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { integrationTestEnvironment } from "./tests/support/integration-environment";

// Inspect app configuration only for isolation checks. Never load its secrets
// into test workers; integration tests must supply dedicated test credentials.
const appEnvironments = [".env", ".env.local", ".env.production", ".env.production.local"]
  .filter(existsSync)
  .map(path => parseEnv(readFileSync(path, "utf8")));
const integrationEnv = integrationTestEnvironment(process.env, appEnvironments);

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { env: integrationEnv },
});
