type Environment = Record<string, string | undefined>;

/** Pure validation; never contacts Supabase or prints credential values. */
export function integrationTestEnvironment(env: Environment, applicationEnvironments: Environment[] = []): Record<string, string> {
  if (env.RUN_SUPABASE_INTEGRATION !== "1") return {};
  if (env.SUPABASE_TEST_ALLOW_WRITES !== "1") throw new Error("Integration tests require SUPABASE_TEST_ALLOW_WRITES=1 for an isolated disposable database.");
  const url = env.SUPABASE_TEST_URL;
  const key = env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Integration tests require explicit SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY; application credentials are never a fallback.");
  const target = projectIdentity(url);
  for (const application of [env, ...applicationEnvironments]) {
    for (const appUrl of [application.NEXT_PUBLIC_SUPABASE_URL, application.SUPABASE_URL]) {
      if (appUrl && projectIdentity(appUrl) === target) throw new Error("Integration database must differ from the configured application/production project.");
    }
    if (application.SUPABASE_SERVICE_ROLE_KEY === key) throw new Error("Integration credentials must differ from application/production credentials.");
  }
  return { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key };
}

function projectIdentity(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid Supabase database URL in test isolation configuration."); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error("Supabase project URL must be an HTTP(S) origin without embedded credentials or paths.");
  }
  // HTTPS/HTTP or port changes do not make a hosted project a separate database.
  return url.hostname.endsWith('.supabase.co') ? url.hostname : url.origin;
}
