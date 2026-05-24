export type PatternFinding = {
  id: string;
  fingerprint: string;
  kind: "exception_spike" | "http_5xx_spike" | "latency_regression" | "deployment_regression";
  title: string;
  serviceName: string;
  environment: string;
  severity: "low" | "medium" | "high";
  confidence: number;
  timeRangeMinutes: number;
  source: "elasticsearch" | "local_file_fallback";
  matchingQuery: string;
  sampleEvents: Array<{
    timestamp?: string;
    message: string;
  }>;
  evidence: Record<string, unknown>;
};

export type DashboardPlan = {
  shouldCreate: boolean;
  stableKey: string;
  reason: string;
  dashboardTitle: string;
  template: "exception-spike" | "latency-regression" | "deployment-regression";
  tags: string[];
  filters: Record<string, string>;
  panels: Array<{
    title: string;
    purpose: string;
    query: string;
    visualization: "metric" | "timeseries" | "bar" | "table";
    dataView: "logs" | "metrics" | "traces";
    columns?: string[];
    breakdownField?: string;
    metric?: "count" | "avg" | "p95";
    layout?: {
      w: number;
      h: number;
    };
  }>;
  dedupe: {
    strategy: "upsert";
    key: string;
  };
  lifecycle: {
    owner: string;
    ttlDays: number;
    reviewRequired: boolean;
  };
};
