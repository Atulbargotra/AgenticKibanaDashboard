import { request } from "undici";
import { env } from "../config/env.js";

type KibanaMethod = "GET" | "POST" | "PUT" | "DELETE";

function spacePath(path: string): string {
  if (env.KIBANA_SPACE === "default") {
    return path;
  }
  return `/s/${env.KIBANA_SPACE}${path}`;
}

export async function kibanaRequest<T>(path: string, init: { method: KibanaMethod; body?: unknown }): Promise<T> {
  const response = await request(`${env.KIBANA_URL}${spacePath(path)}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      "kbn-xsrf": "agentic-kibana-dashboard"
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });

  if (response.statusCode >= 400) {
    throw new Error(`Kibana API failed: ${response.statusCode} ${await response.body.text()}`);
  }

  return response.body.json() as Promise<T>;
}
