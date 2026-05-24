import { env } from "../config/env.js";
import { PatternFinding } from "../types/domain.js";
import { elasticsearchSearch } from "./elasticsearch.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type AggregationResponse = {
  hits?: {
    hits: Array<{
      _source?: {
        body?: string;
        message?: string;
        Body?: string;
        ["@timestamp"]?: string;
      };
    }>;
  };
};

type SearchHit = NonNullable<AggregationResponse["hits"]>["hits"][number];

type ParsedLogEvent = {
  timestamp?: string;
  message: string;
  exceptionClass?: string;
  serviceName?: string;
  environment?: string;
  statusCode?: number;
  source: "elasticsearch" | "local_file_fallback";
};

function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function extractBody(hit: SearchHit): string {
  return hit._source?.body ?? hit._source?.Body ?? hit._source?.message ?? "";
}

function parseLogEvent(message: string, source: ParsedLogEvent["source"], timestamp?: string): ParsedLogEvent {
  const exceptionClass = message.match(/exception\.class=([A-Za-z0-9_.$]+)/)?.[1];
  const serviceName = message.match(/\[([A-Za-z0-9_.-]+-service)\]/)?.[1] ?? env.SERVICE_NAME;
  const environment = message.match(/deployment\.environment=([A-Za-z0-9_.-]+)/)?.[1] ?? env.DEPLOYMENT_ENVIRONMENT;
  const statusCode = Number(message.match(/\s(status=)?(5\d\d)\s?/)?.[2]);
  return {
    timestamp,
    message,
    exceptionClass,
    serviceName,
    environment,
    statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
    source
  };
}

function loadLocalFallbackEvents(): ParsedLogEvent[] {
  if (!env.LOCAL_LOG_FALLBACK_ENABLED || !env.LOCAL_LOG_PATH) {
    return [];
  }

  try {
    const raw = readFileSync(resolve(process.cwd(), env.LOCAL_LOG_PATH), "utf8");
    return raw
      .split("\n")
      .slice(-2000)
      .filter(Boolean)
      .map((line) => parseLogEvent(line, "local_file_fallback"));
  } catch {
    return [];
  }
}

export async function detectExceptionSpikes(): Promise<PatternFinding[]> {
  const result = await elasticsearchSearch<AggregationResponse>(env.LOGS_INDEX_PATTERN, {
    size: 500,
    query: {
      bool: {
        filter: [{ range: { "@timestamp": { gte: `now-${env.PATTERN_WINDOW_MINUTES}m` } } }]
      }
    },
    sort: [{ "@timestamp": { order: "desc" } }]
  });

  const esEvents =
    result.hits?.hits.map((hit) => parseLogEvent(extractBody(hit), "elasticsearch", hit._source?.["@timestamp"])) ?? [];
  const events = [...esEvents, ...loadLocalFallbackEvents()];

  const exceptionGroups = new Map<string, ParsedLogEvent[]>();
  const http5xxEvents: ParsedLogEvent[] = [];

  for (const event of events) {
    if (event.exceptionClass) {
      const bucket = exceptionGroups.get(event.exceptionClass) ?? [];
      bucket.push(event);
      exceptionGroups.set(event.exceptionClass, bucket);
    }
    if (event.statusCode !== undefined && event.statusCode >= 500) {
      http5xxEvents.push(event);
    }
  }

  const findings: PatternFinding[] = [];

  for (const [exceptionClass, group] of exceptionGroups.entries()) {
    if (group.length < env.ERROR_SPIKE_THRESHOLD) {
      continue;
    }
    const sample = group.slice(0, 5).map((event) => ({ timestamp: event.timestamp, message: event.message }));
    const serviceName = group[0]?.serviceName ?? env.SERVICE_NAME;
    const environment = group[0]?.environment ?? env.DEPLOYMENT_ENVIRONMENT;
    const key = fingerprint(["exception_spike", serviceName, environment, exceptionClass]);
    findings.push({
      id: `exception-spike:${serviceName}:${environment}:${exceptionClass}`,
      fingerprint: key,
      kind: "exception_spike",
      title: `Exception spike: ${exceptionClass}`,
      serviceName,
      environment,
      severity: group.length >= env.ERROR_SPIKE_THRESHOLD * 3 ? "high" : "medium",
      confidence: 0.86,
      timeRangeMinutes: env.PATTERN_WINDOW_MINUTES,
      source: group.some((event) => event.source === "elasticsearch") ? "elasticsearch" : "local_file_fallback",
      matchingQuery: `Body: "*exception.class=${exceptionClass}*"`,
      sampleEvents: sample,
      evidence: {
        exceptionClass,
        count: group.length,
        threshold: env.ERROR_SPIKE_THRESHOLD,
        observedSources: Array.from(new Set(group.map((event) => event.source)))
      }
    });
  }

  if (http5xxEvents.length >= env.ERROR_SPIKE_THRESHOLD) {
    const serviceName = http5xxEvents[0]?.serviceName ?? env.SERVICE_NAME;
    const environment = http5xxEvents[0]?.environment ?? env.DEPLOYMENT_ENVIRONMENT;
    const key = fingerprint(["http_5xx_spike", serviceName, environment]);
    findings.push({
      id: `http-5xx-spike:${serviceName}:${environment}`,
      fingerprint: key,
      kind: "http_5xx_spike",
      title: "HTTP 5xx spike",
      serviceName,
      environment,
      severity: http5xxEvents.length >= env.ERROR_SPIKE_THRESHOLD * 3 ? "high" : "medium",
      confidence: 0.74,
      timeRangeMinutes: env.PATTERN_WINDOW_MINUTES,
      source: http5xxEvents.some((event) => event.source === "elasticsearch") ? "elasticsearch" : "local_file_fallback",
      matchingQuery: "status:500 OR Body: \" 500 \"",
      sampleEvents: http5xxEvents.slice(0, 5).map((event) => ({ timestamp: event.timestamp, message: event.message })),
      evidence: {
        count: http5xxEvents.length,
        threshold: env.ERROR_SPIKE_THRESHOLD
      }
    });
  }

  return findings;
}
