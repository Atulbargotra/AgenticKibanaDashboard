#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/springboot-app"
AGENT_JAR="${ROOT_DIR}/opentelemetry-javaagent.jar"

if [ ! -f "${AGENT_JAR}" ]; then
  curl -L -o "${AGENT_JAR}" \
    https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
fi

cd "${APP_DIR}"

MAVEN_OPTS="-javaagent:${AGENT_JAR}" \
OTEL_SERVICE_NAME=checkout-service \
OTEL_RESOURCE_ATTRIBUTES=service.version=local-dev,deployment.environment=local \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
OTEL_TRACES_EXPORTER=otlp \
OTEL_METRICS_EXPORTER=otlp \
OTEL_LOGS_EXPORTER=otlp \
OTEL_INSTRUMENTATION_LOGBACK_APPENDER_ENABLED=true \
OTEL_INSTRUMENTATION_LOGBACK_MDC_ENABLED=true \
mvn spring-boot:run
