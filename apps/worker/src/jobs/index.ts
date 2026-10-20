import { capSync } from "./cap-sync";
import { ecoBulletinDraft } from "./eco-bulletin-draft";
import { heartbeat } from "./heartbeat";
import { indexCompute } from "./index-compute";
import { mailer } from "./mailer";
import { qcBatch } from "./qc-batch";
import { silamSync } from "./silam-sync";
import { smartmetSync } from "./smartmet-sync";
import { stationPull } from "./station-pull";
import { thresholdEval } from "./threshold-eval";
import type { JobDefinition, JobName } from "./types";

export const jobs: ReadonlyArray<JobDefinition<never>> = [
  heartbeat as JobDefinition<never>,
  indexCompute as JobDefinition<never>,
  qcBatch as JobDefinition<never>,
  thresholdEval as JobDefinition<never>,
  mailer as JobDefinition<never>,
  smartmetSync as JobDefinition<never>,
  silamSync as JobDefinition<never>,
  capSync as JobDefinition<never>,
  stationPull as JobDefinition<never>,
  ecoBulletinDraft as JobDefinition<never>,
];

export const jobByName = new Map<JobName, JobDefinition<never>>(jobs.map((j) => [j.name, j]));
