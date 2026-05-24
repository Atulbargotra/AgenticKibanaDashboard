import { request } from "undici";
import { env } from "../config/env.js";

export async function elasticsearchSearch<T>(index: string, body: unknown): Promise<T> {
  const response = await request(`${env.ELASTICSEARCH_URL}/${index}/_search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (response.statusCode >= 400) {
    throw new Error(`Elasticsearch search failed: ${response.statusCode} ${await response.body.text()}`);
  }

  return response.body.json() as Promise<T>;
}
