import { describe, it, expect } from "vitest";
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

describe("booleanFromEnv preprocessor", () => {
  it.each([
    ["true", true],
    ["TRUE", true],
    ["True", true],
    ["1", true],
    ["yes", true],
    ["YES", true],
    ["y", true],
    ["Y", true],
    ["on", true],
    ["ON", true],
  ])('parses "%s" as true', (input, expected) => {
    expect(booleanFromEnv.parse(input)).toBe(expected);
  });

  it.each([
    ["false", false],
    ["FALSE", false],
    ["0", false],
    ["no", false],
    ["NO", false],
    ["n", false],
    ["N", false],
    ["off", false],
    ["OFF", false],
  ])('parses "%s" as false', (input, expected) => {
    expect(booleanFromEnv.parse(input)).toBe(expected);
  });

  it("passes through boolean true", () => {
    expect(booleanFromEnv.parse(true)).toBe(true);
  });

  it("passes through boolean false", () => {
    expect(booleanFromEnv.parse(false)).toBe(false);
  });

  it("handles whitespace around truthy strings", () => {
    expect(booleanFromEnv.parse("  true  ")).toBe(true);
    expect(booleanFromEnv.parse(" yes ")).toBe(true);
  });

  it("rejects non-boolean non-matching strings", () => {
    expect(() => booleanFromEnv.parse("maybe")).toThrow();
    expect(() => booleanFromEnv.parse("2")).toThrow();
  });

  it("rejects non-string non-boolean values", () => {
    expect(() => booleanFromEnv.parse(42)).toThrow();
    expect(() => booleanFromEnv.parse(null)).toThrow();
    expect(() => booleanFromEnv.parse(undefined)).toThrow();
  });
});

describe("envSchema defaults", () => {
  it("schema provides sensible defaults", () => {
    const envSchema = z.object({
      ELASTICSEARCH_URL: z.string().url().default("http://localhost:9200"),
      KIBANA_URL: z.string().url().default("http://localhost:5601"),
      KIBANA_SPACE: z.string().default("default"),
      AGENT_DRY_RUN: booleanFromEnv.default(true),
      SERVICE_NAME: z.string().default("checkout-service"),
      PATTERN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
      DETECTION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
      ERROR_SPIKE_THRESHOLD: z.coerce.number().int().positive().default(5),
    });

    const result = envSchema.parse({});
    expect(result.ELASTICSEARCH_URL).toBe("http://localhost:9200");
    expect(result.KIBANA_URL).toBe("http://localhost:5601");
    expect(result.KIBANA_SPACE).toBe("default");
    expect(result.AGENT_DRY_RUN).toBe(true);
    expect(result.SERVICE_NAME).toBe("checkout-service");
    expect(result.PATTERN_WINDOW_MINUTES).toBe(15);
    expect(result.DETECTION_INTERVAL_SECONDS).toBe(60);
    expect(result.ERROR_SPIKE_THRESHOLD).toBe(5);
  });

  it("coerces numeric strings from env vars", () => {
    const schema = z.object({
      PATTERN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
    });
    expect(schema.parse({ PATTERN_WINDOW_MINUTES: "30" }).PATTERN_WINDOW_MINUTES).toBe(30);
  });

  it("rejects invalid URL", () => {
    const schema = z.object({
      ELASTICSEARCH_URL: z.string().url().default("http://localhost:9200"),
    });
    expect(() => schema.parse({ ELASTICSEARCH_URL: "not-a-url" })).toThrow();
  });
});
