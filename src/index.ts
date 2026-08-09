import { buildServer } from "./server.js";
import { AuthService } from "./auth/auth-service.js";
import { PostgresAuthStore } from "./auth/postgres-auth-store.js";
import { PostgresWorkflowStore } from "./workflow/postgres-workflow-store.js";
import { CanonicalWorkflowService } from "./workflow/canonical-workflow-service.js";
import { PostgresCanonicalWorkflowStore } from "./workflow/postgres-canonical-workflow-store.js";
import { WorkflowService } from "./workflow/workflow-service.js";
import { PostgresRunReceiptStore } from "./runner/postgres-run-receipt-store.js";
import { PostgresSupportReportStore } from "./support/postgres-support-report-store.js";
import { assertRuntimeDatabaseRole } from "./database/runtime-role.js";
import { Pool } from "pg";
import { CaptureService } from "./capture/capture-service.js";
import { PostgresCaptureStore } from "./capture/postgres-capture-store.js";
import { CaptureWorkflowCompiler } from "./compiler/capture-workflow-compiler.js";
import { CaptureCompilationService } from "./compiler/capture-compilation-service.js";
import { PostgresRunStore } from "./runner/postgres-run-store.js";
import { RunService } from "./runner/run-service.js";
import { ArtifactService } from "./artifacts/artifact-service.js";
import { FileSystemObjectStore } from "./artifacts/filesystem-object-store.js";
import { PostgresArtifactMetadataStore } from "./artifacts/postgres-artifact-metadata-store.js";
import { AuthoringService } from "./authoring/authoring-service.js";
import { PostgresAuthoringJobStore } from "./authoring/postgres-authoring-job-store.js";
import { TemplateAuthoringProvider } from "./authoring/template-authoring-provider.js";
import { RepairService } from "./repair/repair-service.js";
import { PostgresRepairStore } from "./repair/postgres-repair-store.js";
import { PgBossJobQueue } from "./queue/pg-boss-job-queue.js";
import { DurableWorkers, QueuedRunDispatcher } from "./queue/workers.js";
import { PostgresScheduleStore } from "./scheduling/postgres-schedule-store.js";
import { ScheduleService } from "./scheduling/schedule-service.js";
import { PostgresSessionProfileStore } from "./sessions/postgres-session-profile-store.js";
import { SessionProfileService } from "./sessions/session-profile-service.js";
import { EnvironmentSecretProvider } from "./hosted/secret-provider.js";
import { PlaywrightExecutor } from "./hosted/playwright-executor.js";
import { PostgresWebhookStore } from "./triggers/postgres-webhook-store.js";
import { WebhookService } from "./triggers/webhook-service.js";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;
if (databaseUrl && !sessionSecret) throw new Error("SESSION_SECRET is required when DATABASE_URL is configured.");

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;
if (pool) await assertRuntimeDatabaseRole(pool);
const runReceiptStore = pool && sessionSecret ? new PostgresRunReceiptStore(pool) : undefined;
const canonicalWorkflowService = pool ? new CanonicalWorkflowService(new PostgresCanonicalWorkflowStore(pool)) : undefined;
const captureService = pool ? new CaptureService(new PostgresCaptureStore(pool)) : undefined;
const captureCompilationService = captureService && canonicalWorkflowService ? new CaptureCompilationService(captureService, new CaptureWorkflowCompiler(), canonicalWorkflowService) : undefined;
const jobDatabaseUrl = process.env.JOB_DATABASE_URL;
const jobQueue = jobDatabaseUrl ? new PgBossJobQueue(jobDatabaseUrl, (error) => console.error("Durable queue error", error)) : undefined;
if (jobQueue) await jobQueue.start();
const runStore = pool ? new PostgresRunStore(pool) : undefined;
const runService = runStore ? new RunService(runStore, 45_000, jobQueue ? new QueuedRunDispatcher(jobQueue) : undefined) : undefined;
const scheduleStore = pool ? new PostgresScheduleStore(pool) : undefined;
const scheduleService = scheduleStore ? new ScheduleService(scheduleStore) : undefined;
const sessionProfileStore = pool ? new PostgresSessionProfileStore(pool) : undefined;
const sessionProfileService = sessionProfileStore ? new SessionProfileService(sessionProfileStore) : undefined;
const secretProvider = new EnvironmentSecretProvider();
const webhookService = pool && runService ? new WebhookService(new PostgresWebhookStore(pool), secretProvider, runService) : undefined;
const artifactStoragePath = process.env.ARTIFACT_STORAGE_PATH;
const artifactSigningSecret = process.env.ARTIFACT_SIGNING_SECRET ?? sessionSecret;
const artifactService = pool && artifactStoragePath && artifactSigningSecret ? new ArtifactService(new PostgresArtifactMetadataStore(pool), new FileSystemObjectStore(artifactStoragePath), artifactSigningSecret) : undefined;
const authoringService = pool && canonicalWorkflowService && process.env.TEXT_AUTHORING_ENABLED === "true" ? new AuthoringService(new PostgresAuthoringJobStore(pool), new TemplateAuthoringProvider(), canonicalWorkflowService) : undefined;
const durableWorkers = jobQueue && runService && scheduleService && sessionProfileStore
  ? new DurableWorkers(jobQueue, runService, scheduleService, sessionProfileStore, new PlaywrightExecutor(secretProvider), authoringService, artifactService)
  : undefined;
if (durableWorkers) await durableWorkers.start();
const repairService = pool && process.env.REPAIR_ENABLED === "true" ? new RepairService(new PostgresRepairStore(pool)) : undefined;
const app = await buildServer({
  ...(pool && sessionSecret ? { authService: new AuthService(new PostgresAuthStore(pool), sessionSecret) } : {}),
  ...(pool && runReceiptStore ? { workflowService: new WorkflowService(new PostgresWorkflowStore(pool), runReceiptStore) } : {}),
  ...(canonicalWorkflowService ? { canonicalWorkflowService } : {}),
  ...(captureService ? { captureService } : {}),
  ...(captureCompilationService ? { captureCompilationService } : {}),
  ...(runReceiptStore ? { runReceiptStore } : {}),
  ...(runService ? { runService } : {}),
  ...(artifactService ? { artifactService } : {}),
  ...(authoringService ? { authoringService } : {}),
  ...(repairService ? { repairService } : {}),
  ...(scheduleService ? { scheduleService } : {}),
  ...(sessionProfileService ? { sessionProfileService } : {}),
  ...(jobQueue ? { jobQueue } : {}),
  ...(durableWorkers ? { durableWorkers } : {}),
  ...(webhookService ? { webhookService } : {}),
  ...(pool && sessionSecret ? { supportReportStore: new PostgresSupportReportStore(pool) } : {}),
});
if (jobQueue || pool) app.addHook("onClose", async () => {
  await jobQueue?.stop();
  await pool?.end();
});

void app.listen({ host, port });
