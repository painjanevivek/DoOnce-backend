import { PgBoss } from "pg-boss";
import { queueNames, type EnqueueOptions, type JobQueue, type QueueHealth, type QueueJob, type QueueName } from "./job-queue.js";

const deadLetterQueue = "doonce-dead-letter";

type MutationResult = {
  readonly affected?: number;
};

export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;
  private started = false;

  public constructor(connectionString: string, onError: (error: Error) => void = () => undefined) {
    this.boss = new PgBoss({ connectionString, application_name: "doonce-jobs" });
    this.boss.on("error", onError);
  }

  public async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    await this.boss.createQueue(deadLetterQueue, { retryLimit: 0, deleteAfterSeconds: 2_592_000 });
    for (const name of queueNames) {
      await this.boss.createQueue(name, {
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
        retryDelayMax: 300,
        expireInSeconds: name === "workflow-runs" ? 900 : 300,
        retentionSeconds: 1_209_600,
        deleteAfterSeconds: 604_800,
        heartbeatSeconds: 30,
      });
    }
    this.started = true;
  }

  public async stop(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true, timeout: 30_000 });
    this.started = false;
  }

  public async enqueue<T extends object>(name: QueueName, data: T, options: EnqueueOptions): Promise<string> {
    this.assertStarted();
    const id = await this.boss.send(name, structuredClone(data), {
      singletonKey: options.idempotencyKey,
      retryLimit: options.retryLimit ?? 3,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 300,
      expireInSeconds: options.expireInSeconds ?? 300,
      deadLetter: deadLetterQueue,
      ...(options.startAfter ? { startAfter: options.startAfter } : {}),
    });
    if (id) return id;

    const existing = await this.boss.findJobs(name, { key: options.idempotencyKey, queued: true });
    const winner = existing[0]?.id;
    if (!winner) throw new Error("The durable queue rejected the job without returning its id.");
    return winner;
  }

  public async work<T extends object>(name: QueueName, handler: (job: QueueJob<T>) => Promise<void>, concurrency = 1): Promise<void> {
    this.assertStarted();
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
      throw new Error("Queue concurrency must be between 1 and 32.");
    }
    await this.boss.work<T>(name, { localConcurrency: concurrency, batchSize: 1, pollingIntervalSeconds: 2 }, async (jobs) => {
      for (const job of jobs) {
        await handler({ id: job.id, name, data: structuredClone(job.data), signal: job.signal });
      }
    });
  }

  public async cancel(name: QueueName, jobId: string): Promise<boolean> {
    this.assertStarted();
    const result = (await this.boss.cancel(name, jobId)) as MutationResult;
    return (result.affected ?? 0) > 0;
  }

  public async health(): Promise<QueueHealth[]> {
    this.assertStarted();
    const queues = await this.boss.getQueues([...queueNames]);
    return queues.map((queue) => ({
      name: queue.name as QueueName,
      queued: queue.queuedCount,
      ready: queue.readyCount,
      active: queue.activeCount,
      failed: queue.failedCount,
      deferred: queue.deferredCount,
      total: queue.totalCount,
    }));
  }

  private assertStarted(): void {
    if (!this.started) throw new Error("The durable queue has not started.");
  }
}
