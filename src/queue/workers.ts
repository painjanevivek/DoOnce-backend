import type { AuthenticatedUser } from "../auth/auth-service.js";
import type { AuthoringService } from "../authoring/authoring-service.js";
import type { ArtifactService } from "../artifacts/artifact-service.js";
import type { HostedExecutor } from "../hosted/playwright-executor.js";
import type { SessionProfileStore } from "../sessions/session-profile-service.js";
import type { ScheduleService } from "../scheduling/schedule-service.js";
import type { ExecutionRun, RunDispatcher, RunService } from "../runner/run-service.js";
import type { VideoService } from "../video/video-service.js";
import type { JobQueue } from "./job-queue.js";

interface UserPayload {
  tenantId: string;
  userId: string;
  email: string;
  role: AuthenticatedUser["role"];
}

interface HostedRunPayload extends UserPayload {
  runId: string;
}

interface AuthoringPayload extends UserPayload { jobId: string }
interface VideoAnalysisPayload extends UserPayload { videoImportId: string }

type ScheduleExpansionPayload = UserPayload;

const hostedExecutorVersion = "1.0.0";

export class QueuedRunDispatcher implements RunDispatcher {
  public constructor(private readonly queue: JobQueue) {}

  public dispatch(user: AuthenticatedUser, run: ExecutionRun): Promise<string> {
    return this.queue.enqueue<HostedRunPayload>("workflow-runs", { ...toPayload(user), runId: run.id }, {
      idempotencyKey: `run:${run.id}`,
      retryLimit: 3,
      expireInSeconds: 900,
    });
  }

  public cancel(run: ExecutionRun): Promise<boolean> {
    return run.queueJobId ? this.queue.cancel("workflow-runs", run.queueJobId) : Promise.resolve(false);
  }
}

export class DurableWorkers {
  public constructor(
    private readonly queue: JobQueue,
    private readonly runs: RunService,
    private readonly schedules: ScheduleService,
    private readonly profiles: SessionProfileStore,
    private readonly executor: HostedExecutor,
    private readonly authoring?: AuthoringService,
    private readonly artifacts?: ArtifactService,
    private readonly videos?: VideoService,
  ) {}

  public async start(): Promise<void> {
    await this.queue.work<HostedRunPayload>("workflow-runs", async (job) => this.executeHosted(job.data, job.signal), 2);
    await this.queue.work<ScheduleExpansionPayload>("schedule-expansion", async (job) => this.expandSchedules(job.data), 1);
    if (this.authoring) await this.queue.work<AuthoringPayload>("authoring-jobs", async (job) => {
      await this.authoring?.process(fromPayload(job.data), job.data.jobId);
    }, 2);
    if (this.artifacts) await this.queue.work<UserPayload>("artifact-cleanup", async (job) => this.cleanupArtifacts(job.data), 1);
    if (this.videos) {
      await this.queue.work<VideoAnalysisPayload>("video-analysis", async (job) => {
        await this.videos?.analyze(fromPayload(job.data), job.data.videoImportId);
      }, 1);
      await this.queue.work<UserPayload>("video-cleanup", async (job) => this.cleanupVideos(job.data), 1);
    }
  }

  public enqueueAuthoring(user: AuthenticatedUser, jobId: string): Promise<string> {
    return this.queue.enqueue<AuthoringPayload>("authoring-jobs", { ...toPayload(user), jobId }, { idempotencyKey: `authoring:${jobId}`, retryLimit: 2, expireInSeconds: 300 });
  }

  public registerArtifactCleanup(user: AuthenticatedUser): Promise<string> {
    const startAfter = nextDay();
    return this.queue.enqueue("artifact-cleanup", toPayload(user), { idempotencyKey: `artifact-cleanup:${user.tenantId}:${startAfter.toISOString().slice(0, 10)}`, startAfter, retryLimit: 5, expireInSeconds: 3600 });
  }

  public registerScheduleExpansion(user: AuthenticatedUser): Promise<string> {
    return this.queue.enqueue("schedule-expansion", toPayload(user), {
      idempotencyKey: minuteKey(user.tenantId, nextMinute()),
      startAfter: nextMinute(),
      retryLimit: 5,
      expireInSeconds: 180,
    });
  }

  public enqueueVideoAnalysis(user: AuthenticatedUser, videoImportId: string): Promise<string> {
    return this.queue.enqueue<VideoAnalysisPayload>("video-analysis", { ...toPayload(user), videoImportId }, {
      idempotencyKey: `video-analysis:${videoImportId}`,
      retryLimit: 2,
      expireInSeconds: 600,
    });
  }

  public registerVideoCleanup(user: AuthenticatedUser): Promise<string> {
    const startAfter = nextDay();
    return this.queue.enqueue("video-cleanup", toPayload(user), {
      idempotencyKey: `video-cleanup:${user.tenantId}:${startAfter.toISOString().slice(0, 10)}`,
      startAfter,
      retryLimit: 5,
      expireInSeconds: 3600,
    });
  }

  private async executeHosted(payload: HostedRunPayload, signal: AbortSignal): Promise<void> {
    const user = fromPayload(payload);
    const claimed = await this.runs.claimHosted(user, payload.runId, hostedExecutorVersion);
    if (!claimed) return;
    const profileId = claimed.run.sessionProfileId;
    if (!profileId) throw new Error("The hosted run does not reference a managed browser session.");
    const profile = await this.profiles.findInternal(user, profileId);
    if (!profile?.enabled) throw new Error("The managed browser session is unavailable.");
    const result = await this.executor.execute({ request: claimed.request, workflow: claimed.workflow, secretReference: profile.secretReference }, signal);
    await this.runs.finish(user, claimed.run.id, { leaseToken: claimed.leaseToken, result });
  }

  private async expandSchedules(payload: ScheduleExpansionPayload): Promise<void> {
    const user = fromPayload(payload);
    const startAfter = nextMinute();
    await this.queue.enqueue("schedule-expansion", toPayload(user), {
      idempotencyKey: minuteKey(user.tenantId, startAfter),
      startAfter,
      retryLimit: 5,
      expireInSeconds: 180,
    });
    const firings = await this.schedules.expandDue(user);
    for (const firing of firings) {
      await this.runs.create(user, {
        workflowId: firing.schedule.workflowId,
        inputs: firing.schedule.inputBindings,
        idempotencyKey: firing.idempotencyKey,
        mode: "production",
        triggerKind: "schedule",
        sessionLocation: "managed",
        sessionProfileId: firing.schedule.sessionProfileId,
      });
    }
  }

  private async cleanupArtifacts(payload: UserPayload): Promise<void> {
    const user = fromPayload(payload);
    await this.registerArtifactCleanup(user);
    await this.artifacts?.cleanup(user);
  }

  private async cleanupVideos(payload: UserPayload): Promise<void> {
    const user = fromPayload(payload);
    await this.registerVideoCleanup(user);
    await this.videos?.cleanup(user);
  }
}

function toPayload(user: AuthenticatedUser): UserPayload {
  return { tenantId: user.tenantId, userId: user.userId, email: user.email, role: user.role };
}

function fromPayload(payload: UserPayload): AuthenticatedUser {
  return { tenantId: payload.tenantId, userId: payload.userId, email: payload.email, role: payload.role };
}

function nextMinute(): Date {
  const next = new Date();
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);
  return next;
}

function minuteKey(tenantId: string, value: Date): string {
  return `schedule-expansion:${tenantId}:${value.toISOString().slice(0, 16)}`;
}

function nextDay(): Date {
  const next = new Date();
  next.setUTCHours(3, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
