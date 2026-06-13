import { createHash } from "node:crypto";

// Hash per i confronti byte-exact nei restore degli adapter.
export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
