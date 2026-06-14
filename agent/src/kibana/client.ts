import { env } from "../config/env.js";
import { fetchJson } from "../utils/httpClient.js";

type KibanaMethod = "GET" | "POST" | "PUT" | "DELETE";

export function spacePath(path: string): string {
  if (env.KIBANA_SPACE === "default") {
    return path;
  }
  return `/s/${env.KIBANA_SPACE}${path}`;
}

export async function kibanaRequest<T>(path: string, init: { method: KibanaMethod; body?: unknown }): Promise<T> {
  return fetchJson<T>(`${env.KIBANA_URL}${spacePath(path)}`, {
    method: init.method,
    headers: { "kbn-xsrf": "agentic-kibana-dashboard" },
    body: init.body,
  });
}
