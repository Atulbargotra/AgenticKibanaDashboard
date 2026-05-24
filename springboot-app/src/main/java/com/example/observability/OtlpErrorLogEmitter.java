package com.example.observability;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.logs.Logger;
import io.opentelemetry.api.logs.Severity;
import io.opentelemetry.exporter.otlp.http.logs.OtlpHttpLogRecordExporter;
import io.opentelemetry.sdk.logs.SdkLoggerProvider;
import io.opentelemetry.sdk.logs.export.BatchLogRecordProcessor;
import io.opentelemetry.sdk.resources.Resource;
import java.time.Duration;

final class OtlpErrorLogEmitter {
  private static final String SERVICE_NAME = "checkout-service";
  private static final String ENVIRONMENT = "local";
  private static final String OTLP_LOGS_ENDPOINT = "http://localhost:4318/v1/logs";

  private static final SdkLoggerProvider loggerProvider = SdkLoggerProvider.builder()
      .setResource(Resource.getDefault().toBuilder()
          .put(AttributeKey.stringKey("service.name"), SERVICE_NAME)
          .put(AttributeKey.stringKey("deployment.environment"), ENVIRONMENT)
          .build())
      .addLogRecordProcessor(BatchLogRecordProcessor.builder(
              OtlpHttpLogRecordExporter.builder()
                  .setEndpoint(OTLP_LOGS_ENDPOINT)
                  .build())
          .setScheduleDelay(Duration.ofSeconds(1))
          .build())
      .build();

  private static final Logger logger = loggerProvider.loggerBuilder("checkout-controller-errors").build();

  static {
    Runtime.getRuntime().addShutdownHook(new Thread(loggerProvider::close));
  }

  private OtlpErrorLogEmitter() {
  }

  static void emit(String exceptionClass, String message) {
    logger.logRecordBuilder()
        .setSeverity(Severity.ERROR)
        .setBody(message)
        .setAttribute(AttributeKey.stringKey("service.name"), SERVICE_NAME)
        .setAttribute(AttributeKey.stringKey("deployment.environment"), ENVIRONMENT)
        .setAttribute(AttributeKey.stringKey("exception.class"), exceptionClass)
        .emit();
    loggerProvider.forceFlush();
  }
}
