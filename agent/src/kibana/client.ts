import { env } from "../config/env.js";

type KibanaMethod = "GET" | "POST" | "PUT" | "DELETE";

function spacePath(path: string): string {
  if (env.KIBANA_SPACE === "default") {
    return path;
  }
  return `/s/${env.KIBANA_SPACE}${path}`;
}

export async function kibanaRequest<T>(path: string, init: { method: KibanaMethod; body?: unknown }): Promise<T> {
  const response = await fetch(`${env.KIBANA_URL}${spacePath(path)}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      "kbn-xsrf": "agentic-kibana-dashboard"
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });

  if (!response.ok) {
    throw new Error(`Kibana API failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}
