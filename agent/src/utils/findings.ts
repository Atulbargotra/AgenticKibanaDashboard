import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { PatternFinding } from "../types/domain.js";

export function fingerprint(parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

export function sampleEvents(
  events: Array<{ timestamp?: string; message: string }>,
  limit = 5,
): Array<{ timestamp?: string; message: string }> {
  return events.slice(0, limit).map((e) => ({
    timestamp: e.timestamp,
    message: e.message,
  }));
}

export function spikeSeverity(count: number): PatternFinding["severity"] {
  return count >= env.ERROR_SPIKE_THRESHOLD * 3 ? "high" : "medium";
}
