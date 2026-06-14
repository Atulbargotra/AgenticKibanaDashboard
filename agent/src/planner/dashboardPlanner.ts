import { env } from "../config/env.js";
import { DashboardPlan, PatternFinding } from "../types/domain.js";
import { z } from "zod";

export async function planDashboard(finding: PatternFinding): Promise<DashboardPlan> {
  return planDashboardWithOpenRouter(finding);
}

const panelSchema = z.object({
  title: z.string().min(3),
  purpose: z.string().min(10),
  query: z.string().min(1),
  visualization: z.enum(["metric", "timeseries", "bar", "table"]),
  dataView: z.enum(["logs", "metrics", "traces"]),
  columns: z.array(z.string()).optional(),
  breakdownField: z.string().optional(),
  metric: z.enum(["count", "avg", "p95"]).optional(),
  layout: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).optional()
});

const dashboardPlanSchema = z.object({
  shouldCreate: z.boolean(),
  stableKey: z.string().min(6),
  reason: z.string().min(10),
  dashboardTitle: z.string().min(6),
  template: z.enum(["exception-spike", "latency-regression", "deployment-regression"]),
  tags: z.array(z.string()).min(1),
  filters: z.record(z.string()),
  panels: z.array(panelSchema).min(2).max(8),
  dedupe: z.object({
    strategy: z.literal("upsert"),
    key: z.string().min(6)
  }),
  lifecycle: z.object({
    owner: z.string().min(2),
    ttlDays: z.number().int().positive(),
    reviewRequired: z.boolean()
  })
});

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Planner response did not contain JSON");
}

export function summarizePlannerFailure(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`).join("; ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function conciseReason(reason: string): string {
  const normalized = reason.replace(/\s+/g, " ").trim();
  if (normalized.includes("429")) {
    return "AI planner was rate limited by the upstream model provider";
  }
  if (normalized.length > 220) {
    return `${normalized.slice(0, 217)}...`;
  }
  return normalized;
}

async function planDashboardWithOpenRouter(finding: PatternFinding): Promise<DashboardPlan> {
  const apiKey = env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallbackOrSkip(finding, "OpenRouter API key is not configured");
  }

  const systemPrompt = `
You are a senior production observability engineer.
Create a Kibana dashboard plan for a confirmed telemetry finding.

Rules:
- Return only JSON matching the schema.
- Do not create generic dashboards if the finding is low confidence.
- Choose panels based on the evidence and sample events.
- Queries must use Kibana KQL.
- Use logs panels for log evidence, metrics panels only for metric-oriented panels, traces panels for trace investigation.
- Include at least one recent-events table and one trend/count panel.
- Use stableKey and dedupe.key equal to the finding fingerprint.
- Never include secrets or credentials.

Field names available in Elasticsearch (ECS mapping):
- message: the log body text (use this for KQL text searches, NOT "Body")
- service.name: the service name
- log.level: the log level (e.g. ERROR, WARN, INFO)
- @timestamp: the event timestamp
- trace.id: the trace ID
- span.id: the span ID
- For table panels, use columns: ["@timestamp", "message"]
`;

  const userPrompt = JSON.stringify(
    {
      finding,
      availableDataViews: {
        logs: env.LOGS_DATA_VIEW_TITLE,
        metrics: env.METRICS_DATA_VIEW_TITLE,
        traces: env.TRACES_DATA_VIEW_TITLE
      },
      allowedVisualizations: ["metric", "timeseries", "bar", "table"],
      productionPolicy: {
        createDraftOnly: true,
        upsertByFingerprint: true,
        reviewRequired: env.AGENT_REQUIRE_REVIEW
      }
    },
    null,
    2
  );
  if (env.DEBUG_LLM_IO) {
    console.log("[llm][request][system]", systemPrompt);
    console.log("[llm][request][user]", userPrompt);
  }

  try {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:5601",
        "X-Title": "Agentic Kibana Dashboard"
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "dashboard_plan",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "shouldCreate",
                "stableKey",
                "reason",
                "dashboardTitle",
                "template",
                "tags",
                "filters",
                "panels",
                "dedupe",
                "lifecycle"
              ],
              properties: {
                shouldCreate: { type: "boolean" },
                stableKey: { type: "string" },
                reason: { type: "string" },
                dashboardTitle: { type: "string" },
                template: { type: "string", enum: ["exception-spike", "latency-regression", "deployment-regression"] },
                tags: { type: "array", items: { type: "string" } },
                filters: { type: "object", additionalProperties: { type: "string" } },
                panels: {
                  type: "array",
                  minItems: 2,
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["title", "purpose", "query", "visualization", "dataView"],
                    properties: {
                      title: { type: "string" },
                      purpose: { type: "string" },
                      query: { type: "string" },
                      visualization: { type: "string", enum: ["metric", "timeseries", "bar", "table"] },
                      dataView: { type: "string", enum: ["logs", "metrics", "traces"] },
                      columns: { type: "array", items: { type: "string" } },
                      breakdownField: { type: "string" },
                      metric: { type: "string", enum: ["count", "avg", "p95"] },
                      layout: {
                        type: "object",
                        additionalProperties: false,
                        required: ["w", "h"],
                        properties: {
                          w: { type: "number" },
                          h: { type: "number" }
                        }
                      }
                    }
                  }
                },
                dedupe: {
                  type: "object",
                  additionalProperties: false,
                  required: ["strategy", "key"],
                  properties: {
                    strategy: { type: "string", enum: ["upsert"] },
                    key: { type: "string" }
                  }
                },
                lifecycle: {
                  type: "object",
                  additionalProperties: false,
                  required: ["owner", "ttlDays", "reviewRequired"],
                  properties: {
                    owner: { type: "string" },
                    ttlDays: { type: "number" },
                    reviewRequired: { type: "boolean" }
                  }
                }
              }
            }
          }
        }
      })
    });

    const body = (await response.json()) as ChatCompletionResponse & { error?: unknown };
    if (!response.ok) {
      throw new Error(`OpenRouter planner failed: ${response.status} ${JSON.stringify(body.error ?? body)}`);
    }

    const content = body.choices?.[0]?.message?.content;
    if (env.DEBUG_LLM_IO) {
      console.log("[llm][response][raw]", JSON.stringify(body, null, 2));
      console.log("[llm][response][content]", content ?? "");
    }
    if (!content) {
      throw new Error("OpenRouter planner returned no message content");
    }

    return dashboardPlanSchema.parse(extractJson(content));
  } catch (error) {
    return fallbackOrSkip(finding, summarizePlannerFailure(error));
  }
}

export function fallbackOrSkip(finding: PatternFinding, reason: string): DashboardPlan {
  if (!env.ALLOW_DETERMINISTIC_FALLBACK) {
    return {
      shouldCreate: false,
      stableKey: finding.fingerprint,
      reason: `AI planner unavailable; fail-closed production mode. ${conciseReason(reason)}`,
      dashboardTitle: `[AI Draft] ${finding.title}`,
      template: "exception-spike",
      tags: ["ai-generated", "draft", finding.environment, finding.serviceName],
      filters: {},
      panels: [
        {
          title: "Planner unavailable",
          purpose: "Placeholder plan because the production planner failed closed.",
          query: finding.matchingQuery,
          visualization: "table",
          dataView: "logs"
        },
        {
          title: "Recent matching events",
          purpose: "Inspect recent events matching the finding query.",
          query: finding.matchingQuery,
          visualization: "table",
          dataView: "logs"
        }
      ],
      dedupe: { strategy: "upsert", key: finding.fingerprint },
      lifecycle: { owner: "observability", ttlDays: 14, reviewRequired: true }
    };
  }

  const exceptionClass = String(finding.evidence.exceptionClass ?? finding.title);
  return {
    shouldCreate: true,
    stableKey: finding.fingerprint,
    reason: `Deterministic fallback used because planner failed: ${conciseReason(reason)}`,
    dashboardTitle: `[AI Draft] ${finding.title}`,
    template: "exception-spike",
    tags: ["ai-generated", "draft", finding.environment, finding.serviceName, finding.kind],
    filters: {},
    panels: [
      {
        title: "Error Volume Trend",
        purpose: `Track how frequently ${exceptionClass} appears over time.`,
        query: finding.matchingQuery,
        visualization: "timeseries",
        dataView: "logs",
        metric: "count",
        layout: { w: 24, h: 12 }
      },
      {
        title: "Recent Matching Error Events",
        purpose: "Show the exact log lines behind the spike so operators can inspect symptoms quickly.",
        query: finding.matchingQuery,
        visualization: "table",
        dataView: "logs",
        columns: ["@timestamp", "message"],
        layout: { w: 24, h: 12 }
      },
      {
        title: "Related Checkout Logs",
        purpose: "Show surrounding service logs for context near the spike.",
        query: `message: "*${finding.serviceName}*" OR message: "*checkout*"`,
        visualization: "table",
        dataView: "logs",
        columns: ["@timestamp", "message"],
        layout: { w: 48, h: 10 }
      }
    ],
    dedupe: { strategy: "upsert", key: finding.fingerprint },
    lifecycle: { owner: "observability", ttlDays: 14, reviewRequired: env.AGENT_REQUIRE_REVIEW }
  };
}
