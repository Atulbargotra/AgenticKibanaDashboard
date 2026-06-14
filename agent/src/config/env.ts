import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  ELASTICSEARCH_URL: z.string().url().default("http://localhost:9200"),
  KIBANA_URL: z.string().url().default("http://localhost:5601"),
  KIBANA_SPACE: z.string().default("default"),
  AGENT_DRY_RUN: booleanFromEnv.default(true),
  AGENT_REQUIRE_REVIEW: booleanFromEnv.default(false),
  SERVICE_NAME: z.string().default("checkout-service"),
  DEPLOYMENT_ENVIRONMENT: z.string().default("local"),
  LOGS_INDEX_PATTERN: z.string().default("logs-springboot-local*"),
  LOGS_DATA_VIEW_TITLE: z.string().default("logs-springboot-local*"),
  METRICS_DATA_VIEW_TITLE: z.string().default("metrics-springboot-local*"),
  TRACES_DATA_VIEW_TITLE: z.string().default("traces-springboot-local*"),
  PATTERN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  DETECTION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  ERROR_SPIKE_THRESHOLD: z.coerce.number().int().positive().default(5),
  FINDING_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(600),
  STARTUP_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  STARTUP_RETRY_DELAY_SECONDS: z.coerce.number().int().positive().default(5),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().default("openrouter/free"),
  ALLOW_DETERMINISTIC_FALLBACK: booleanFromEnv.default(false),
  DEBUG_LLM_IO: booleanFromEnv.default(false),
  ANTHROPIC_MODEL: z.string().default("openrouter/free"),
});

export const env = envSchema.parse(process.env);
