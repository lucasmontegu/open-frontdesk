import type { JobName, JobQueue } from "@ofd/core";
import { PgBoss } from "pg-boss";

export const JOB_NAMES: readonly JobName[] = [
  "mission.plan",
  "mission.execute",
  "mission.contact",
  "conversation.extract_facts",
  "goal.tick",
  "crm.sync",
];

export type JobHandler<T extends object = object> = (
  data: T,
  meta: { id: string; signal: AbortSignal },
) => Promise<void>;

export interface PgBossJobQueueOptions {
  connectionString: string;
  /** pg-boss schema; defaults to "pgboss". Tests use a throwaway one. */
  schema?: string;
  onError?: (err: Error) => void;
}

export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;
  private started = false;

  constructor(opts: PgBossJobQueueOptions) {
    this.boss = new PgBoss({
      connectionString: opts.connectionString,
      schema: opts.schema ?? "pgboss",
    });
    this.boss.on("error", (err) => opts.onError?.(err));
  }

  /** Installs/migrates the pg-boss schema and creates every queue (required before send/work). */
  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    for (const name of JOB_NAMES) await this.boss.createQueue(name);
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true });
    this.started = false;
  }

  async enqueue<T extends object>(
    name: JobName,
    data: T,
    opts?: { startAfterSeconds?: number; singletonKey?: string },
  ): Promise<string> {
    const id = await this.boss.send(name, data, {
      ...(opts?.startAfterSeconds !== undefined ? { startAfter: opts.startAfterSeconds } : {}),
      ...(opts?.singletonKey ? { singletonKey: opts.singletonKey } : {}),
    });
    // pg-boss returns null when a singleton job already exists; return the key so callers still get an id.
    return id ?? `duplicate:${opts?.singletonKey ?? name}`;
  }

  /** Registers a worker. Jobs are handled one at a time; a thrown error fails the job (pg-boss retries). */
  async work<T extends object>(
    name: JobName,
    handler: JobHandler<T>,
    opts?: { pollingIntervalSeconds?: number },
  ): Promise<string> {
    return this.boss.work<T>(
      name,
      { pollingIntervalSeconds: opts?.pollingIntervalSeconds ?? 2 },
      async (jobs) => {
        for (const job of jobs) await handler(job.data, { id: job.id, signal: job.signal });
      },
    );
  }
}
