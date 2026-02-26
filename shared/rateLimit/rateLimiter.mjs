// ─────────────────────────────────────────────────────────────────────────────
// Per-client WebSocket rate limits (messages / minute / action type).
// Raise or lower these to tune per-client throttling behaviour.
//
// HARD_LIMIT_MULTIPLIER: requests above (soft × multiplier) are rejected with
// a 429 response. Set to 2 to allow up to 2× the expected normal rate before
// cutting the client off.
// ─────────────────────────────────────────────────────────────────────────────
export const RATE_LIMITS = {
  state_update:  60,   // device state changes per minute
  device_upsert: 10,   // device registration/metadata updates per minute
  list_devices:   6,   // list queries per minute
  device_delete:  6,   // deletes per minute
  keepalive:      5,   // keepalive pings per minute
  default:       20    // catch-all for any other action
};

export const HARD_LIMIT_MULTIPLIER = 2;

/**
 * Atomically increment a per-client per-action rate counter in DynamoDB.
 * Uses a minute-bucket key with a 2-minute TTL so records self-clean.
 *
 * The condition `attribute_not_exists(#cnt) OR #cnt < :hardLimit` ensures the
 * increment only succeeds if the client is still under the hard limit.  When
 * the condition fails, DynamoDB throws ConditionalCheckFailedException and we
 * return { allowed: false }.
 *
 * On any unexpected DDB error we fail open so legitimate traffic isn't blocked
 * by infrastructure issues.
 *
 * @param {{ clientId: string, action: string, repo: object }} opts
 * @returns {Promise<{ allowed: boolean, softLimit: number, hardLimit: number }>}
 */
export async function checkRateLimit({ clientId, action, repo }) {
  const softLimit = RATE_LIMITS[action] ?? RATE_LIMITS.default;
  const hardLimit = softLimit * HARD_LIMIT_MULTIPLIER;

  const bucket = Math.floor(Date.now() / 60_000); // current minute bucket
  const key = {
    pk: `CLIENT#${clientId}`,
    sk: `RATE#${action}#${bucket}`
  };
  const ttl = Math.floor(Date.now() / 1000) + 120; // 2-min TTL → auto-cleanup

  try {
    await repo.update(
      key,
      "ADD #cnt :one SET #ttl = if_not_exists(#ttl, :ttl)",
      { "#cnt": "cnt", "#ttl": "ttl" },
      { ":one": 1, ":ttl": ttl, ":hardLimit": hardLimit },
      "attribute_not_exists(#cnt) OR #cnt < :hardLimit"
    );
    return { allowed: true, softLimit, hardLimit };
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      console.warn("RATE_LIMIT_EXCEEDED:", { clientId, action, hardLimit });
      return { allowed: false, softLimit, hardLimit };
    }
    console.error("RATE_LIMIT_ERROR:", { clientId, action, error: err?.message });
    return { allowed: true, softLimit, hardLimit }; // fail open
  }
}
