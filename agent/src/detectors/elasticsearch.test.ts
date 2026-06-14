import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    ELASTICSEARCH_URL: "http://localhost:9200",
  },
}));

import { elasticsearchSearch } from "./elasticsearch.js";

describe("elasticsearchSearch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends POST with correct URL, headers, and body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hits: { hits: [] } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const body = { query: { match_all: {} } };
    await elasticsearchSearch("my-index", body);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:9200/my-index/_search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    vi.unstubAllGlobals();
  });

  it("returns parsed JSON on success", async () => {
    const expected = { hits: { hits: [{ _source: { message: "test" } }] } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(expected),
      })
    );

    const result = await elasticsearchSearch("idx", {});
    expect(result).toEqual(expected);

    vi.unstubAllGlobals();
  });

  it("throws on non-ok response with status and body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request body"),
      })
    );

    await expect(elasticsearchSearch("idx", {})).rejects.toThrow(
      "HTTP POST http://localhost:9200/idx/_search failed: 400 Bad Request body"
    );

    vi.unstubAllGlobals();
  });
});
