import { env } from "../config/env.js";
import { elasticsearchSearch } from "./elasticsearch.js";
import { fingerprint, sampleEvents, spikeSeverity } from "../utils/findings.js";
function extractBody(hit) {
    return hit._source?.body ?? hit._source?.Body ?? hit._source?.message ?? "";
}
function parseLogEvent(message, source, timestamp) {
    const exceptionClass = message.match(/exception\.class=([A-Za-z0-9_.$]+)/)?.[1] ??
        message.match(/\b([A-Za-z0-9_$.]*(?:Exception|Error))\b/)?.[1];
    const serviceName = message.match(/\[([A-Za-z0-9_.-]+-service)\]/)?.[1] ?? env.SERVICE_NAME;
    const environment = message.match(/deployment\.environment=([A-Za-z0-9_.-]+)/)?.[1] ??
        env.DEPLOYMENT_ENVIRONMENT;
    const statusCode = Number(message.match(/\s(status=)?(5\d\d)\s?/)?.[2]);
    return {
        timestamp,
        message,
        exceptionClass,
        serviceName,
        environment,
        statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
        source,
    };
}
function extractServiceInfo(events) {
    return {
        serviceName: events[0]?.serviceName ?? env.SERVICE_NAME,
        environment: events[0]?.environment ?? env.DEPLOYMENT_ENVIRONMENT,
    };
}
export async function detectExceptionSpikes() {
    const result = await elasticsearchSearch(env.LOGS_INDEX_PATTERN, {
        size: 500,
        query: {
            bool: {
                filter: [
                    {
                        range: {
                            "@timestamp": { gte: `now-${env.PATTERN_WINDOW_MINUTES}m` },
                        },
                    },
                ],
            },
        },
        sort: [{ "@timestamp": { order: "desc" } }],
    });
    const events = result.hits?.hits.map((hit) => parseLogEvent(extractBody(hit), "elasticsearch", hit._source?.["@timestamp"])) ?? [];
    if (events.length === 0) {
        console.warn(`[detector] no log events found in Elasticsearch index pattern '${env.LOGS_INDEX_PATTERN}' for last ${env.PATTERN_WINDOW_MINUTES} minutes`);
    }
    const exceptionGroups = new Map();
    const http5xxEvents = [];
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
    const findings = [];
    for (const [exceptionClass, group] of exceptionGroups.entries()) {
        if (group.length < env.ERROR_SPIKE_THRESHOLD) {
            continue;
        }
        const { serviceName, environment } = extractServiceInfo(group);
        const key = fingerprint([
            "exception_spike",
            serviceName,
            environment,
            exceptionClass,
        ]);
        findings.push({
            id: `exception-spike:${serviceName}:${environment}:${exceptionClass}`,
            fingerprint: key,
            kind: "exception_spike",
            title: `Exception spike: ${exceptionClass}`,
            serviceName,
            environment,
            severity: spikeSeverity(group.length),
            confidence: 0.86,
            timeRangeMinutes: env.PATTERN_WINDOW_MINUTES,
            source: "elasticsearch",
            matchingQuery: `message: "*${exceptionClass}*"`,
            sampleEvents: sampleEvents(group),
            evidence: {
                exceptionClass,
                count: group.length,
                threshold: env.ERROR_SPIKE_THRESHOLD,
                observedSources: Array.from(new Set(group.map((event) => event.source))),
            },
        });
    }
    if (http5xxEvents.length >= env.ERROR_SPIKE_THRESHOLD) {
        const { serviceName, environment } = extractServiceInfo(http5xxEvents);
        const key = fingerprint(["http_5xx_spike", serviceName, environment]);
        findings.push({
            id: `http-5xx-spike:${serviceName}:${environment}`,
            fingerprint: key,
            kind: "http_5xx_spike",
            title: "HTTP 5xx spike",
            serviceName,
            environment,
            severity: spikeSeverity(http5xxEvents.length),
            confidence: 0.74,
            timeRangeMinutes: env.PATTERN_WINDOW_MINUTES,
            source: "elasticsearch",
            matchingQuery: 'status:500 OR message: " 500 "',
            sampleEvents: sampleEvents(http5xxEvents),
            evidence: {
                count: http5xxEvents.length,
                threshold: env.ERROR_SPIKE_THRESHOLD,
            },
        });
    }
    return findings;
}
