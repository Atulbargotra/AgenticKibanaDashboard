import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    KIBANA_URL: "http://localhost:5601",
    KIBANA_SPACE: "default",
  },
}));

import { spacePath, kibanaRequest } from "./client.js";
import { env } from "../config/env.js";

describe("spacePath", () => {
  it("returns unmodified path for default space", () => {
    expect(spacePath("/api/dashboards")).toBe("/api/dashboards");
  });

  it("prefixes path with /s/<space> for non-default space", () => {
    const mockedEnv = env as Record<string, unknown>;
    mockedEnv.KIBANA_SPACE = "monitoring";
    expect(spacePath("/api/dashboards")).toBe("/s/monitoring/api/dashboards");
    mockedEnv.KIBANA_SPACE = "default";
  });

  it("handles root path", () => {
    const mockedEnv = env as Record<string, unknown>;
    mockedEnv.KIBANA_SPACE = "custom";
    expect(spacePath("/")).toBe("/s/custom/");
    mockedEnv.KIBANA_SPACE = "default";
  });
});

describe("kibanaRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      })
    );

    await expect(
      kibanaRequest("/api/test", { method: "GET" })
    ).rejects.toThrow("HTTP GET http://localhost:5601/api/test failed: 404 Not Found");

    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "abc" }),
      })
    );

    const result = await kibanaRequest<{ id: string }>("/api/test", { method: "GET" });
    expect(result).toEqual({ id: "abc" });

    vi.unstubAllGlobals();
  });

  it("sends correct headers including kbn-xsrf", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    await kibanaRequest("/api/test", { method: "POST", body: { key: "val" } });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:5601/api/test",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "kbn-xsrf": "agentic-kibana-dashboard",
        },
        body: JSON.stringify({ key: "val" }),
      })
    );

    vi.unstubAllGlobals();
  });

  it("omits body when undefined", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    await kibanaRequest("/api/test", { method: "GET" });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:5601/api/test",
      expect.objectContaining({
        body: undefined,
      })
    );

    vi.unstubAllGlobals();
  });
});
