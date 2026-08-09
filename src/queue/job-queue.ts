export const queueNames = ["workflow-runs", "authoring-jobs", "repair-jobs", "artifact-cleanup", "schedule-expansion"] as const;
export type QueueName = typeof queueNames[number];
export interface QueueJob<T> { id: string; name: QueueName; data: T; signal: AbortSignal }
export interface EnqueueOptions { idempotencyKey: string; startAfter?: Date; retryLimit?: number; expireInSeconds?: number }
export interface QueueHealth { name: QueueName; queued: number; ready: number; active: number; failed: number; deferred: number; total: number }
export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue<T extends object>(name: QueueName, data: T, options: EnqueueOptions): Promise<string>;
  work<T extends object>(name: QueueName, handler: (job: QueueJob<T>) => Promise<void>, concurrency?: number): Promise<void>;
  cancel(name: QueueName, jobId: string): Promise<boolean>;
  health(): Promise<QueueHealth[]>;
}
