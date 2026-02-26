import { createHash, randomBytes, randomUUID } from "node:crypto";

export function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

export function newClientId() {
  return randomUUID();
}

export function newClientSecret() {
  return randomBytes(24).toString("base64url");
}

