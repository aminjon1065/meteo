import type { Job } from "bullmq";

/**
 * Реестр фоновых задач. Каждая задача идемпотентна: повторный запуск
 * с теми же данными не приводит к дублированию.
 */
export type JobName =
  | "heartbeat"
  | "smartmet-sync"
  | "cap-sync"
  | "silam-sync"
  | "index-compute"
  | "qc-batch"
  | "threshold-eval"
  | "mailer"
  | "station-pull"
  | "eco-bulletin-draft";

export interface JobDefinition<TData = Record<string, never>> {
  name: JobName;
  /** Расписание BullMQ Job Scheduler (cron с часовым поясом или интервал); undefined — только по требованию. */
  schedule?: { pattern: string; tz?: string } | { every: number };
  run: (job: Job<TData>) => Promise<unknown>;
}
