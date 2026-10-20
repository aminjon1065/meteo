import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { and, desc, eq, inArray } from "@meteo/db";
import { auditLog, measurements, stationIndex, stationSources, stations } from "@meteo/db/schema";
import { expect, test } from "@playwright/test";
import { closeE2eDb, e2eDb } from "../helpers/db";
import { t } from "../helpers/messages";
import { REPO_ROOT, resolveE2eEnv } from "../setup/env.mjs";
import { E2E } from "../setup/fixtures";

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await closeE2eDb();
});

interface PullResult {
  sourceId: number;
  stationCode: string;
  status: "ok" | "failed" | "skipped";
  files: number;
  accepted: number;
  rejected: number;
  error?: string;
}

/** Прогон источника скриптом worker'а без очереди (как в runbook): file:// разрешён только этой переменной. */
function runPull(sourceId: number): PullResult {
  const e2e = resolveE2eEnv();
  const run = spawnSync("pnpm", ["exec", "tsx", "scripts/pull-source.ts", String(sourceId)], {
    cwd: resolve(REPO_ROOT, "apps/worker"),
    env: {
      ...process.env,
      DATABASE_URL: e2e.databaseUrl,
      REDIS_URL: e2e.redisUrl,
      STATION_PULL_ALLOW_FILE_URLS: "1",
      LOG_LEVEL: "warn",
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  const lines = `${run.stdout}`.trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  if (run.status !== 0 && run.status !== 2)
    throw new Error(`pull-source завершился с кодом ${run.status}: ${run.stderr}\n${run.stdout}`);
  return JSON.parse(last) as PullResult;
}

test("JSON‑источник: прогон на фикстуре file://, данные двух станций, курсор времени, карточка и публичная страница", async ({
  page,
}) => {
  const db = e2eDb();
  const [source] = await db
    .select({ id: stationSources.id, stationId: stationSources.stationId })
    .from(stationSources)
    .where(eq(stationSources.label, E2E.jsonSourceLabel));
  expect(source).toBeTruthy();
  const sourceId = source?.id as number;
  const jsonRows = await db
    .select({ id: stations.id, code: stations.code, slug: stations.slug })
    .from(stations)
    .where(inArray(stations.code, [E2E.jsonStations.a.code, E2E.jsonStations.b.code]));
  expect(jsonRows).toHaveLength(2);
  const ids = jsonRows.map((r) => r.id);

  // 1. Первый прогон: свежие записи + история (два запроса), 2 станции × 2 вещества × 7 отметок.
  const first = runPull(sourceId);
  expect(first.status, first.error).toBe("ok");
  expect(first.files).toBe(2);
  expect(first.accepted).toBe(28);
  expect(first.rejected).toBe(0);

  const rows = await db
    .select({
      stationId: measurements.stationId,
      time: measurements.time,
      source: measurements.source,
    })
    .from(measurements)
    .where(inArray(measurements.stationId, ids));
  expect(rows).toHaveLength(28);
  expect(new Set(rows.map((r) => r.source))).toEqual(new Set([4])); // sensor (pull)
  for (const r of rows) expect(r.time.getUTCMinutes() % 10).toBe(0); // округление к 10 минутам
  const fed = await db
    .select({
      code: stations.code,
      lastIngestSource: stations.lastIngestSource,
      summary: stations.lastIngestSummary,
    })
    .from(stations)
    .where(inArray(stations.id, ids));
  for (const st of fed) {
    expect(st.lastIngestSource).toBe("pull");
    expect(st.summary?.sourceId).toBe(sourceId);
    expect(st.summary?.accepted).toBe(14);
  }
  const [after1] = await db.select().from(stationSources).where(eq(stationSources.id, sourceId));
  expect(after1?.status).toBe("ok");
  expect(after1?.lastDataAt).toBeTruthy();
  expect(after1?.lastSummary?.stations).toBe(2);
  expect(Object.keys(after1?.files ?? {}).sort()).toEqual(
    [E2E.jsonStations.a.code, E2E.jsonStations.b.code].sort(),
  );
  const indexRows = await db
    .select({ stationId: stationIndex.stationId })
    .from(stationIndex)
    .where(inArray(stationIndex.stationId, ids));
  expect(indexRows.length).toBeGreaterThan(0);
  const [audit] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "measurements.pull"), eq(auditLog.entityId, String(sourceId))))
    .orderBy(desc(auditLog.id))
    .limit(1);
  expect(audit?.actorEmail).toBe(`station:${E2E.jsonStations.a.code}`);
  expect((audit?.after as { kind: string }).kind).toBe("json");

  // 2. Повторный прогон: ответ тот же — всё отсечено курсором, история не запрашивается, данных нет.
  const second = runPull(sourceId);
  expect(second.status, second.error).toBe("ok");
  expect(second.files).toBe(1);
  expect(second.accepted).toBe(0);
  const [after2] = await db.select().from(stationSources).where(eq(stationSources.id, sourceId));
  expect(after2?.lastDataAt?.toISOString()).toBe(after1?.lastDataAt?.toISOString());
  expect(after2?.lastSummary?.skipped).toBe(4);
  expect(
    await db.select().from(measurements).where(inArray(measurements.stationId, ids)),
  ).toHaveLength(28);

  // 3. Карточка станции‑якоря: источник «работает», сводка по станциям; пароль/секретов нет.
  await page.goto(`/ru/admin/stations/${source?.stationId}`);
  await expect(page.getByTestId(`source-status-${sourceId}`)).toHaveText(
    t("ru", "stations.sources.status.ok"),
  );
  await expect(page.getByText(E2E.jsonSourceLabel)).toBeVisible();
  await expect(page.getByText("json", { exact: true })).toBeVisible();

  // 4. Публичная страница второй станции (у неё нет своего источника): индекс посчитан и актуален.
  const b = jsonRows.find((r) => r.code === E2E.jsonStations.b.code);
  await page.goto(`/ru/air/stations/${b?.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Датчик B (E2E)");
  await expect(page.getByText(t("ru", "levels.3")).first()).toBeVisible();
});

test("форма источника: тип «JSON API» подставляет шаблон wwcs.tj, сохраняет и валидирует описание полей", async ({
  page,
}) => {
  const db = e2eDb();
  const [stationB] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.code, E2E.jsonStations.b.code));
  await page.goto(`/ru/admin/stations/${stationB?.id}`);
  await page.getByRole("button", { name: t("ru", "stations.sources.add") }).click();
  const form = page.getByTestId("station-source-form");
  await form.locator("#src-kind").selectOption("json");
  await expect(form.locator("#src-mapping")).toHaveValue(/"format": "json"/);
  await expect(form.locator("#src-mapping")).toHaveValue(/wwcs\.tj/);
  await form.locator("#src-label").fill("WWCS (E2E форма)");
  await form.locator("#src-path").fill("https://wwcs.tj/services/airquality/stations");
  await form.locator("#src-stale").fill("60");
  await form.getByRole("button", { name: t("ru", "common.actions.save") }).click();
  await expect(page.getByText(t("ru", "stations.sources.saved")).first()).toBeVisible();

  const [created] = await db
    .select()
    .from(stationSources)
    .where(and(eq(stationSources.stationId, stationB?.id ?? -1), eq(stationSources.kind, "json")));
  expect(created?.path).toBe("https://wwcs.tj/services/airquality/stations");
  expect(created?.host).toBe("");
  expect(created?.staleAfterMin).toBe(60);
  expect(created?.mapping).toMatchObject({ format: "json", stationField: "stationID" });

  // Описание файлов CSV для типа json отклоняется с ошибкой у поля.
  await page
    .getByRole("button", { name: t("ru", "common.actions.edit") })
    .last()
    .click();
  const edit = page.getByTestId("station-source-form");
  await edit
    .locator("#src-mapping")
    .fill('{"layout":"wide","time":{"column":"t"},"pollutants":{"PM25":{"column":"a"}}}');
  await edit.getByRole("button", { name: t("ru", "common.actions.save") }).click();
  await expect(edit.locator("#src-mapping")).toHaveAttribute("aria-invalid", "true");
});
