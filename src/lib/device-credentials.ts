import { createHash, randomBytes } from "node:crypto";

export function createDeviceApiKey() {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}
