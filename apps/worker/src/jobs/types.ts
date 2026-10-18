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
  | "mailer";

export interface JobDefinition<TData = Record<string, never>> {
  name: JobName;
  /** Расписание BullMQ Job Scheduler (cron или интервал); undefined — только по требованию. */
  schedule?: { pattern: string } | { every: number };
  run: (job: Job<TData>) => Promise<unknown>;
}
