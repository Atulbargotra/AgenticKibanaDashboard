# Agentic Kibana Dashboard

Local reference implementation for a self-healing observability system:

- A Spring Boot service emits logs, metrics, and traces through OpenTelemetry.
- A local Elastic/Kibana stack stores and visualizes telemetry.
- A TypeScript agent detects interesting production patterns.
- The agent asks an LLM planner, through the Claude Agent SDK configured for OpenRouter, whether a new Kibana view/dashboard is justified.
- A guarded Kibana automation layer creates draft dashboards from approved templates.

Start with the detailed guide in [docs/setup-guide.md](docs/setup-guide.md).
For production-mode behavior, see [docs/production-agent.md](docs/production-agent.md).

## Quick Start

```bash
docker compose up -d

cd springboot-app
mvn spring-boot:run

cd ../agent
npm install
cp .env.example .env
npm run dev
```

Kibana: http://localhost:5601

Elasticsearch: http://localhost:9200

Spring Boot app: http://localhost:8080

## Important Production Rule

Use `openrouter/free` only for local experiments. For production, pin a stable model and require approval before dashboards are promoted into your main Kibana space.
