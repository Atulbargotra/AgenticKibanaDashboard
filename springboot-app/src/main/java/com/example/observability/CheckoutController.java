package com.example.observability;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.util.Map;
import java.util.Random;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class CheckoutController {
  private static final Logger log = LoggerFactory.getLogger(CheckoutController.class);

  private final Random random = new Random();
  private final Counter checkoutFailures;
  private final Timer checkoutLatency;

  CheckoutController(MeterRegistry registry) {
    this.checkoutFailures = Counter.builder("checkout.failures")
        .description("Synthetic checkout failures")
        .tag("service", "checkout-service")
        .register(registry);
    this.checkoutLatency = Timer.builder("checkout.latency")
        .description("Synthetic checkout latency")
        .register(registry);
  }

  @GetMapping("/checkout")
  ResponseEntity<Map<String, Object>> checkout(@RequestParam(defaultValue = "normal") String mode)
      throws InterruptedException {
    long latencyMs = switch (mode) {
      case "slow" -> 900 + random.nextInt(500);
      case "db-timeout" -> 250 + random.nextInt(200);
      case "downstream-service-timeout" -> 700 + random.nextInt(400);
      default -> 50 + random.nextInt(100);
    };

    Thread.sleep(latencyMs);
    checkoutLatency.record(Duration.ofMillis(latencyMs));

    if ("db-timeout".equals(mode)) {
      checkoutFailures.increment();
      log.error("checkout failed due to database timeout endpoint=/checkout exception.class=JdbcSQLTimeoutException service.version=local-dev");
      return ResponseEntity.internalServerError().body(Map.of(
          "status", "failed",
          "error", "JdbcSQLTimeoutException",
          "latencyMs", latencyMs
      ));
    }

    if ("random-error".equals(mode) && random.nextInt(3) == 0) {
      checkoutFailures.increment();
      log.error("checkout failed due to payment dependency endpoint=/checkout exception.class=PaymentGatewayException service.version=local-dev");
      return ResponseEntity.internalServerError().body(Map.of(
          "status", "failed",
          "error", "PaymentGatewayException",
          "latencyMs", latencyMs
      ));
    }

    if ("downstream-service-timeout".equals(mode)) {
      checkoutFailures.increment();
      log.error("checkout failed due to downstream timeout endpoint=/checkout exception.class=DownstreamServiceTimeoutException dependency=inventory-service service.version=local-dev");
      return ResponseEntity.internalServerError().body(Map.of(
          "status", "failed",
          "error", "DownstreamServiceTimeoutException",
          "latencyMs", latencyMs
      ));
    }

    log.info("checkout completed endpoint=/checkout mode={} latencyMs={} service.version=local-dev", mode, latencyMs);
    return ResponseEntity.ok(Map.of("status", "ok", "latencyMs", latencyMs));
  }

  @GetMapping("/load")
  ResponseEntity<Map<String, Object>> generateLoad() throws InterruptedException {
    for (int i = 0; i < 25; i++) {
      checkout(i % 4 == 0 ? "db-timeout" : "normal");
    }
    return ResponseEntity.ok(Map.of("generated", 25));
  }
}
