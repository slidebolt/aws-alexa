export function wsJson(statusCode, payload) {
  return {
    statusCode,
    body: JSON.stringify(payload)
  };
}

export function ok(payload = {}) {
  return wsJson(200, { ok: true, ...payload });
}

export function badRequest(message, extra = {}) {
  return wsJson(400, { ok: false, error: message, ...extra });
}

export function unauthorized(message = "Unauthorized") {
  return wsJson(403, { ok: false, error: message });
}

export function tooManyRequests(message = "Rate limit exceeded") {
  return wsJson(429, { ok: false, error: message });
}

export function internalError(message = "Internal Server Error") {
  return wsJson(500, { ok: false, error: message });
}

