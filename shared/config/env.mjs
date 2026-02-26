export function requireEnv(name, env = process.env) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function optionalEnv(name, fallback = "", env = process.env) {
  const value = env[name];
  return value == null || value === "" ? fallback : value;
}

export function loadRuntimeConfig(env = process.env) {
  return {
    dataTable: requireEnv("DATA_TABLE", env),
    wsMgmtEndpoint: optionalEnv("WS_MGMT_ENDPOINT", "", env),
    adminSecret: optionalEnv("ADMIN_SECRET", "", env),
    alexaClientId: optionalEnv("ALEXA_CLIENT_ID", "", env),
    alexaClientSecret: optionalEnv("ALEXA_CLIENT_SECRET", "", env),
    testAlexaToken: optionalEnv("TEST_ALEXA_TOKEN", "", env)
  };
}

