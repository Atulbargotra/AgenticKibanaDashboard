# Production Agent Mode

The production agent is split into four stages:

1. **Detector**
   Reads recent telemetry from Elasticsearch and emits generic findings such as `exception_spike` or `http_5xx_spike`.

2. **Planner**
   Sends the finding, evidence, and sample events to OpenRouter using the Chat Completions API. The model must return a strict dashboard plan: title, reason, tags, queries, panel types, layout, lifecycle, and dedupe key.

3. **Compiler**
   Converts the approved plan into Kibana saved objects. The compiler owns Kibana JSON validity. The model does not write raw saved-object JSON.

4. **Publisher**
   Upserts dashboards by stable finding fingerprint. The same exception/service/environment updates or skips the existing dashboard rather than creating duplicates.

## Recommended Production Settings

```env
AGENT_DRY_RUN=false
AGENT_REQUIRE_REVIEW=true
ALLOW_DETERMINISTIC_FALLBACK=false
LOCAL_LOG_FALLBACK_ENABLED=false

OPENROUTER_API_KEY=replace-me
OPENROUTER_MODEL=openrouter/free

SERVICE_NAME=checkout-service
DEPLOYMENT_ENVIRONMENT=prod
LOGS_INDEX_PATTERN=logs-springboot-prod*
LOGS_DATA_VIEW_TITLE=logs-springboot-prod*
METRICS_DATA_VIEW_TITLE=metrics-springboot-prod*
TRACES_DATA_VIEW_TITLE=traces-springboot-prod*

PATTERN_WINDOW_MINUTES=15
ERROR_SPIKE_THRESHOLD=10
FINDING_COOLDOWN_SECONDS=3600
```

Use a pinned production model instead of `openrouter/free` for stable output quality.

## Local Demo Settings

Use local fallback only when the local OpenTelemetry log path is incomplete and you still want to prove dashboard generation:

```env
ALLOW_DETERMINISTIC_FALLBACK=true
LOCAL_LOG_FALLBACK_ENABLED=true
LOCAL_LOG_PATH=../springboot-app/app.out
```

## Duplicate Policy

The dedupe key is the finding fingerprint:

```text
finding kind + service + environment + exception class
```

This means repeated `JdbcSQLTimeoutException` spikes in the same service/environment map to one dashboard.

## Safety Notes

- The AI returns a dashboard plan, not raw Kibana saved-object JSON.
- The compiler validates and creates Kibana-compatible saved searches and visualizations.
- `AGENT_REQUIRE_REVIEW=true` prints the plan and does not publish it.
- `ALLOW_DETERMINISTIC_FALLBACK=false` makes the agent fail closed if the model is unavailable or returns invalid JSON.
