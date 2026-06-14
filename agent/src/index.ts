import { env } from "./config/env.js";
import { detectExceptionSpikes } from "./detectors/errorSpikeDetector.js";
import { publishDashboardDraft } from "./kibana/dashboardPublisher.js";
import { planDashboard } from "./planner/dashboardPlanner.js";

const findingLastProcessedAt = new Map<string, number>();

async function runOnce(): Promise<void> {
  console.log(`[cycle] Checking for patterns at ${new Date().toISOString()}`);
  const findings = await detectExceptionSpikes();
  console.log(`[cycle] Findings above threshold: ${findings.length}`);
  if (findings.length === 0) {
    console.log("No dashboard-worthy findings in the current window.");
    return;
  }

  for (const finding of findings) {
    try {
      const now = Date.now();
      const last = findingLastProcessedAt.get(finding.id);
      const cooldownMs = env.FINDING_COOLDOWN_SECONDS * 1000;
      if (last !== undefined && now - last < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (now - last)) / 1000);
        console.log(`Skipping ${finding.id}; cooldown active (${remaining}s remaining).`);
        continue;
      }

      console.log(`Detected: ${finding.title}`);
      const plan = await planDashboard(finding);
      if (!plan.shouldCreate) {
        console.log(`Planner skipped dashboard: ${plan.reason}`);
        findingLastProcessedAt.set(finding.id, now);
        continue;
      }
      await publishDashboardDraft(finding, plan);
      findingLastProcessedAt.set(finding.id, now);
    } catch (error) {
      console.error(
        `[cycle] failed to process finding ${finding.id}; continuing with remaining findings.`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

async function main(): Promise<void> {
  console.log(`Agent started. dryRun=${env.AGENT_DRY_RUN} interval=${env.DETECTION_INTERVAL_SECONDS}s`);
  try {
    await runOnce();
  } catch (error) {
    console.error("[cycle] initial detection cycle failed; will retry on next interval.", error);
  }
  setInterval(() => {
    runOnce().catch((error) => console.error("[cycle] agent cycle failed", error));
  }, env.DETECTION_INTERVAL_SECONDS * 1000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
