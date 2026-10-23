/**
 * Seed справочников. Идемпотентен: существующие записи не перезаписываются,
 * чтобы не затирать правки администратора. Исключение — строки ПДК с источником seed
 * по умолчанию: они приводятся к таблице норм из ежедневных бюллетеней Агентства
 * (docs/02-architecture.md §6.2). Пороги оперативной шкалы — по образцу FMI/HSY (D6).
 */
import { randomUUID } from "node:crypto";
import { AQ_LEVEL_STYLES } from "@meteo/core";
import type { I18nText } from "@meteo/i18n";
import { hashPassword } from "better-auth/crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "./client";
import { loadRootEnv, requireEnv } from "./env";
import * as s from "./schema";

loadRootEnv();
const db = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const t = (tg: string, ru: string, en: string): I18nText => ({ tg, ru, en });

// ---------------------------------------------------------------------------
// 1. Загрязнители. Названия — по терминологии ежедневных бюллетеней Агентства
//    (tg: зарачаҳои 10 мкр., дуоксиди нитроген, фториди гидроген, моддаҳои муаллақ …).
// ---------------------------------------------------------------------------
const pollutantSeed = [
  {
    code: "PM25",
    shortName: "PM2.5",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 1,
    hazardClass: 3,
    molarMass: null,
    name: t("Зарачаҳои 2,5 мкр. (PM2.5)", "Взвешенные частицы PM2.5", "Particulate matter PM2.5"),
  },
  {
    code: "PM10",
    shortName: "PM10",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 2,
    hazardClass: 3,
    molarMass: null,
    name: t("Зарачаҳои 10 мкр. (PM10)", "Взвешенные частицы PM10", "Particulate matter PM10"),
  },
  {
    code: "NO2",
    shortName: "NO₂",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 3,
    hazardClass: 3,
    molarMass: 46.0055,
    name: t("Дуоксиди нитроген", "Диоксид азота", "Nitrogen dioxide"),
  },
  {
    code: "SO2",
    shortName: "SO₂",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 4,
    hazardClass: 3,
    molarMass: 64.066,
    name: t("Дуоксиди сулфур", "Дуоксид серы", "Sulphur dioxide"),
  },
  {
    code: "CO",
    shortName: "CO",
    unit: "mg/m³",
    decimals: 2,
    sortOrder: 5,
    hazardClass: 4,
    molarMass: 28.01,
    name: t("Оксиди карбон", "Оксид углерода", "Carbon monoxide"),
  },
  {
    code: "O3",
    shortName: "O₃",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 6,
    hazardClass: 1,
    molarMass: 47.998,
    name: t("Озон", "Озон", "Ozone"),
  },
  // Вещества автоматической станции Душанбе и постов других городов (бюллетень от 19.10.2026).
  {
    code: "NO",
    shortName: "NO",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 7,
    hazardClass: 3,
    molarMass: 30.006,
    name: t("Оксиди нитроген", "Оксид азота", "Nitric oxide"),
  },
  {
    code: "CH2O",
    shortName: "CH₂O",
    unit: "µg/m³",
    decimals: 2,
    sortOrder: 8,
    hazardClass: 2,
    molarMass: 30.026,
    name: t("Формалдегид", "Формальдегид", "Formaldehyde"),
  },
  {
    code: "C6H5OH",
    shortName: "C₆H₅OH",
    unit: "µg/m³",
    decimals: 2,
    sortOrder: 9,
    hazardClass: 2,
    molarMass: 94.113,
    name: t("Фенол", "Фенол", "Phenol"),
  },
  {
    code: "HF",
    shortName: "HF",
    unit: "µg/m³",
    decimals: 2,
    sortOrder: 10,
    hazardClass: 2,
    molarMass: 20.006,
    name: t("Фториди гидроген", "Фтористый водород", "Hydrogen fluoride"),
  },
  {
    code: "TSP",
    shortName: "TSP",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 11,
    hazardClass: 3,
    molarMass: null,
    name: t(
      "Моддаҳои муаллақ (чанг)",
      "Взвешенные частицы (пыль)",
      "Suspended particulates (dust, TSP)",
    ),
  },
  {
    code: "CO2",
    shortName: "CO₂",
    unit: "ppm",
    decimals: 0,
    sortOrder: 12,
    hazardClass: null,
    molarMass: 44.009,
    name: t("Гази карбонат (CO₂)", "Диоксид углерода", "Carbon dioxide"),
  },
  {
    code: "TVOC",
    shortName: "TVOC",
    unit: "ppb",
    decimals: 1,
    sortOrder: 13,
    hazardClass: null,
    molarMass: null,
    name: t(
      "Пайвастагиҳои органикии зудбухоршаванда (ПОЗ)",
      "Летучие органические соединения (ЛОС)",
      "Total volatile organic compounds (TVOC)",
    ),
  },
];

await db.insert(s.pollutants).values(pollutantSeed).onConflictDoNothing();

// Названия из прежнего seed приводим к терминологии Агентства (редактора названий в админке нет,
// поэтому меняем только строки, совпадающие с прежним текстом).
const renamedPollutants: Array<{ code: string; from: I18nText }> = [
  {
    code: "PM25",
    from: t("Зарраҳои муаллақи PM2.5", "Взвешенные частицы PM2.5", "Particulate matter PM2.5"),
  },
  {
    code: "PM10",
    from: t("Зарраҳои муаллақи PM10", "Взвешенные частицы PM10", "Particulate matter PM10"),
  },
  { code: "NO2", from: t("Диоксиди нитроген", "Диоксид азота", "Nitrogen dioxide") },
  { code: "SO2", from: t("Диоксиди сулфур", "Диоксид серы", "Sulphur dioxide") },
];
for (const r of renamedPollutants) {
  const to = pollutantSeed.find((p) => p.code === r.code)?.name;
  if (!to) continue;
  await db
    .update(s.pollutants)
    .set({ name: to })
    .where(and(eq(s.pollutants.code, r.code), eq(s.pollutants.name, r.from)));
}
const pollutantRows = await db
  .select({ id: s.pollutants.id, code: s.pollutants.code })
  .from(s.pollutants);
const pidMap = Object.fromEntries(pollutantRows.map((r) => [r.code, r.id])) as Record<
  string,
  number
>;
const pid = (code: string): number => {
  const id = pidMap[code];
  if (id === undefined) throw new Error(`[seed] неизвестный загрязнитель ${code}`);
  return id;
};

// ---------------------------------------------------------------------------
// 2. ПДК — таблица норм ежедневного бюллетеня Агентства (ПДКс.с. / ПДКм.р., в единице вещества;
//    мг/м³ бюллетеня → µg/m³). CO₂ норматива не имеет; ЛОС (TVOC) — в ppb.
// ---------------------------------------------------------------------------
const limitSource = "ПДК Агентства по гидрометеорологии (бюллетень от 19.10.2026)";
/** Прежний источник seed: такие строки приводятся к таблице Агентства, правки администратора не трогаем. */
const legacyLimitSources = ["СанПиН 1.2.3685-21 (черновик, к подтверждению Заказчиком)"];
const limits: Array<{ code: string; daily: number; maxSingle: number }> = [
  { code: "PM25", daily: 35, maxSingle: 160 },
  { code: "PM10", daily: 60, maxSingle: 300 },
  { code: "NO2", daily: 40, maxSingle: 85 },
  { code: "SO2", daily: 50, maxSingle: 500 },
  { code: "CO", daily: 3, maxSingle: 5 },
  { code: "O3", daily: 30, maxSingle: 160 },
  // В таджикской версии бюллетеня ПДКс.с. NO — 0,07 мг/м³; принято значение русской версии 0,06 (уточнить у Агентства).
  { code: "NO", daily: 60, maxSingle: 400 },
  { code: "CH2O", daily: 3, maxSingle: 35 },
  { code: "C6H5OH", daily: 3, maxSingle: 10 },
  { code: "HF", daily: 5, maxSingle: 20 },
  { code: "TSP", daily: 150, maxSingle: 500 },
  { code: "TVOC", daily: 300, maxSingle: 900 },
];
const limitRows = limits.flatMap((l) => [
  { pollutantId: pid(l.code), kind: "daily" as const, value: l.daily, source: limitSource },
  {
    pollutantId: pid(l.code),
    kind: "max_single" as const,
    value: l.maxSingle,
    source: limitSource,
  },
]);
await db.insert(s.limitValues).values(limitRows).onConflictDoNothing();
// Существующие базы: строки с источником seed по умолчанию приводим к таблице Агентства
// (та же логика в миграции 0007; ПДК, изменённые администратором, имеют source admin:<email>).
for (const row of limitRows) {
  await db
    .update(s.limitValues)
    .set({ value: row.value, source: limitSource })
    .where(
      and(
        eq(s.limitValues.pollutantId, row.pollutantId),
        eq(s.limitValues.kind, row.kind),
        inArray(s.limitValues.source, legacyLimitSources),
      ),
    );
}

// ---------------------------------------------------------------------------
// 3. Шкалы индекса
// ---------------------------------------------------------------------------
const levelLabels: Record<number, I18nText> = {
  1: t("Хуб", "Хороший", "Good"),
  2: t("Қаноатбахш", "Удовлетворительный", "Satisfactory"),
  3: t("Миёна", "Умеренный", "Fair"),
  4: t("Бад", "Плохой", "Poor"),
  5: t("Хеле бад", "Очень плохой", "Very poor"),
};
const fiveLevels = [1, 2, 3, 4, 5].map((level) => ({
  level,
  color: AQ_LEVEL_STYLES[level as 1 | 2 | 3 | 4 | 5].color,
  label: levelLabels[level] ?? t("", "", ""),
}));
const ratioBounds: Array<number | null> = [0, 1, 2, 3, 5, null];

await db
  .insert(s.indexScales)
  .values([
    {
      code: "NATIONAL_OPERATIONAL",
      kind: "breakpoints",
      name: t(
        "Индекси амалиётии сифати ҳаво",
        "Оперативный индекс качества воздуха",
        "Operational air quality index",
      ),
      description: t(
        "Панҷ сатҳ аз рӯи консентратсияҳои соатӣ; индекси истгоҳ — бадтарин зериндекс.",
        "Пять уровней по часовым концентрациям; индекс станции — худший из под‑индексов. Пороги по умолчанию — по образцу индекса FMI/HSY.",
        "Five levels from hourly concentrations; station index is the worst sub‑index. Default thresholds follow the FMI/HSY index.",
      ),
      levels: fiveLevels,
      isDefaultPublic: true,
      sortOrder: 1,
    },
    {
      code: "WHO_24H",
      kind: "breakpoints",
      name: t("Шкала аз рӯи тавсияҳои ТУТ", "Шкала по рекомендациям ВОЗ", "WHO guideline scale"),
      description: t(
        "Панҷ сатҳ аз рӯи AQG‑2021 ва ҳадафҳои фосилавии ТУТ (миёнаи шабонарӯзӣ).",
        "Пять уровней на основе AQG‑2021 и промежуточных целей ВОЗ (среднесуточные значения).",
        "Five levels based on WHO AQG‑2021 and interim targets (24‑hour means).",
      ),
      levels: fiveLevels,
      isDefaultPublic: false,
      sortOrder: 2,
    },
    {
      code: "RATIO_TO_LIMIT",
      kind: "ratio_to_limit",
      name: t(
        "Каррати ҲМҒ (методикаи Агентӣ)",
        "Кратность ПДК (методика Агентства)",
        "Ratio to limit values (Agency method)",
      ),
      description: t(
        "Консентратсияи миёнаи шабонарӯзӣ нисбат ба ҲМҒ(м.ш.р) ва якмаротибагии баландтарин нисбат ба ҲМҒ(як); ҷамъи дуоксидҳои нитрогену сулфур (NO₂+SO₂); ҳолатҳои ИБ (≥ 10 ҲМҒ(як)) ва НИБ (≥ 50).",
        "Среднесуточная концентрация к ПДКс.с. и максимальная разовая к ПДКм.р., как в ежедневных бюллетенях Агентства; суммация NO₂+SO₂ (сумма кратностей); случаи ВЗ (≥ 10 ПДКм.р.) и ЭВЗ (≥ 50 ПДКм.р.).",
        "Daily mean concentration against the daily limit and the maximum single value against the single limit, as in the Agency's daily bulletins; NO₂+SO₂ summation (sum of ratios); high (≥ 10 single limits) and extremely high (≥ 50) pollution cases.",
      ),
      // Интервалы кратности: ≤1, 1–2, 2–3, 3–5, >5 (docs/02-architecture.md §6.2).
      levels: fiveLevels.map((l) => ({
        ...l,
        lo: ratioBounds[l.level - 1] as number,
        hi: ratioBounds[l.level] as number | null,
      })),
      isDefaultPublic: false,
      sortOrder: 4,
    },
    {
      // Шкала US AQI (EPA, Technical Assistance Document 2024): шесть категорий 0–50 … 301–500 с цветами
      // EPA — привычная шкала сети PM‑датчиков Агентства; не публичная по умолчанию (переключается в админке).
      code: "US_AQI",
      kind: "breakpoints",
      name: t("Индекси US AQI (EPA)", "Индекс US AQI (EPA)", "US AQI (EPA)"),
      description: t(
        "Шаш категорияи AQI‑и Агентии ҳифзи муҳити зисти ИМА: PM2.5 ва PM10 — миёнаи 24 соат, O3 ва CO — 8 соат, NO2 ва SO2 — 1 соат. Ҳудудҳо — EPA 2024 дар воҳидҳои портал.",
        "Шесть категорий AQI Агентства по охране окружающей среды США: PM2.5 и PM10 — среднее за 24 ч, O3 и CO — 8 ч, NO2 и SO2 — 1 ч. Пороги — EPA 2024 в единицах портала (ppb/ppm переведены при 25 °C).",
        "Six US EPA AQI categories: PM2.5 and PM10 — 24‑hour mean, O3 and CO — 8‑hour, NO2 and SO2 — 1‑hour. Thresholds — EPA 2024 in portal units (ppb/ppm converted at 25 °C).",
      ),
      levels: [
        { level: 1, lo: 0, hi: 50, color: "#00E400", label: t("Хуб", "Хороший", "Good") },
        { level: 2, lo: 51, hi: 100, color: "#FFFF00", label: t("Миёна", "Умеренный", "Moderate") },
        {
          level: 3,
          lo: 101,
          hi: 150,
          color: "#FF7E00",
          label: t(
            "Барои гурӯҳҳои ҳассос зарарнок",
            "Вредно для чувствительных групп",
            "Unhealthy for sensitive groups",
          ),
        },
        {
          level: 4,
          lo: 151,
          hi: 200,
          color: "#FF0000",
          label: t("Зарарнок", "Вредно для здоровья", "Unhealthy"),
        },
        {
          level: 5,
          lo: 201,
          hi: 300,
          color: "#8F3F97",
          label: t("Хеле зарарнок", "Очень вредно для здоровья", "Very unhealthy"),
        },
        {
          level: 6,
          lo: 301,
          hi: 500,
          color: "#7E0023",
          label: t("Хатарнок", "Опасно", "Hazardous"),
        },
      ],
      isDefaultPublic: false,
      sortOrder: 5,
    },
    {
      code: "IZA",
      kind: "iza",
      name: t(
        "Индекси ифлосшавии атмосфера (ИЗА)",
        "Индекс загрязнения атмосферы (ИЗА)",
        "Atmospheric pollution index (IZA)",
      ),
      description: t(
        "ИЗА аз рӯи РД 52.04.186‑89: маҷмӯи консентратсияҳои миёнаи моҳона нисбат ба ҲМҒ(м.ш.р).",
        "Комплексный ИЗА по РД 52.04.186‑89: сумма среднемесячных концентраций, нормированных на ПДКсс, с учётом класса опасности.",
        "Composite IZA per RD 52.04.186‑89: sum of monthly means normalised by daily limit values, weighted by hazard class.",
      ),
      levels: [
        {
          level: 1,
          lo: 0,
          hi: 5,
          color: AQ_LEVEL_STYLES[1].color,
          label: t("Паст", "Низкий", "Low"),
        },
        {
          level: 2,
          lo: 5,
          hi: 7,
          color: AQ_LEVEL_STYLES[2].color,
          label: t("Баланд", "Повышенный", "Elevated"),
        },
        {
          level: 4,
          lo: 7,
          hi: 14,
          color: AQ_LEVEL_STYLES[4].color,
          label: t("Хеле баланд", "Высокий", "High"),
        },
        {
          level: 5,
          lo: 14,
          hi: null,
          color: AQ_LEVEL_STYLES[5].color,
          label: t("Ниҳоят баланд", "Очень высокий", "Very high"),
        },
      ],
      isDefaultPublic: false,
      sortOrder: 3,
    },
  ])
  .onConflictDoNothing();

const scales = await db
  .select({ id: s.indexScales.id, code: s.indexScales.code })
  .from(s.indexScales);
const sidMap = Object.fromEntries(scales.map((r) => [r.code, r.id])) as Record<string, number>;
const sid = (code: string): number => {
  const id = sidMap[code];
  if (id === undefined) throw new Error(`[seed] неизвестная шкала ${code}`);
  return id;
};

/** Пороги: массив верхних границ уровней 1–4; уровень 5 — открытый. */
function breakpoints(
  scaleId: number,
  code: string,
  uppers: [number, number, number, number],
  averagingMin: number,
) {
  const bounds = [0, ...uppers, null];
  return [1, 2, 3, 4, 5].map((level) => ({
    scaleId,
    pollutantId: pid(code),
    level,
    lo: bounds[level - 1] as number,
    hi: bounds[level] as number | null,
    averagingMin,
  }));
}

// Оперативная шкала: часовые значения (FMI/HSY), CO — 8‑часовое среднее в mg/m³.
const operational = [
  ...breakpoints(sid("NATIONAL_OPERATIONAL"), "PM25", [10, 25, 50, 75], 60),
  ...breakpoints(sid("NATIONAL_OPERATIONAL"), "PM10", [20, 50, 100, 200], 60),
  ...breakpoints(sid("NATIONAL_OPERATIONAL"), "NO2", [40, 70, 150, 200], 60),
  ...breakpoints(sid("NATIONAL_OPERATIONAL"), "SO2", [20, 80, 250, 350], 60),
  ...breakpoints(sid("NATIONAL_OPERATIONAL"), "O3", [60, 100, 140, 180], 60),
  ...breakpoints(sid("NATIONAL_OPERATIONAL"), "CO", [4, 8, 20, 30], 480),
];
// Шкала ВОЗ: суточные значения (O3 — 8 ч). Интервалы, кроме PM2.5/PM10, — черновик для экспертов.
const who = [
  ...breakpoints(sid("WHO_24H"), "PM25", [15, 25, 37.5, 75], 1440),
  ...breakpoints(sid("WHO_24H"), "PM10", [45, 75, 100, 150], 1440),
  ...breakpoints(sid("WHO_24H"), "NO2", [25, 50, 120, 200], 1440),
  ...breakpoints(sid("WHO_24H"), "SO2", [40, 125, 250, 350], 1440),
  ...breakpoints(sid("WHO_24H"), "O3", [100, 120, 160, 240], 480),
  ...breakpoints(sid("WHO_24H"), "CO", [4, 7, 10, 20], 1440),
];
/** Пороги по нижним границам уровней 1..N (первая — 0); последний уровень открытый. */
function breakpointsFromLows(scaleId: number, code: string, lows: number[], averagingMin: number) {
  return lows.map((lo, i) => ({
    scaleId,
    pollutantId: pid(code),
    level: i + 1,
    lo,
    hi: i < lows.length - 1 ? (lows[i + 1] as number) : null,
    averagingMin,
  }));
}
// US AQI (EPA 2024): PM — µg/m³ за 24 ч; газы переведены из ppb/ppm при 25 °C (24,45 л/моль) и округлены:
// NO2 1 ч 54/101/361/650/1250 ppb, SO2 1 ч 36/76/186/305/605 ppb, O3 8 ч 55/71/86/106/201 ppb,
// CO 8 ч 4,5/9,5/12,5/15,5/30,5 ppm (mg/m³).
const usAqi = [
  ...breakpointsFromLows(sid("US_AQI"), "PM25", [0, 9.1, 35.5, 55.5, 125.5, 225.5], 1440),
  ...breakpointsFromLows(sid("US_AQI"), "PM10", [0, 55, 155, 255, 355, 425], 1440),
  ...breakpointsFromLows(sid("US_AQI"), "O3", [0, 108, 139, 169, 208, 393], 480),
  ...breakpointsFromLows(sid("US_AQI"), "NO2", [0, 102, 190, 679, 1223, 2352], 60),
  ...breakpointsFromLows(sid("US_AQI"), "SO2", [0, 94, 199, 487, 799, 1585], 60),
  ...breakpointsFromLows(sid("US_AQI"), "CO", [0, 5.2, 10.9, 14.3, 17.8, 34.9], 480),
];
await db
  .insert(s.indexBreakpoints)
  .values([...operational, ...who, ...usAqi])
  .onConflictDoNothing();

// ---------------------------------------------------------------------------
// 4. Медицинские рекомендации (черновик, общее население) — на согласование D7
// ---------------------------------------------------------------------------
const advice: Array<{ level: number; title: I18nText; text: I18nText }> = [
  {
    level: 1,
    title: t("Ҳаво тоза аст", "Воздух чистый", "The air is clean"),
    text: t(
      "Ҳама метавонанд бемалол дар беруни бино бошанд ва варзиш кунанд.",
      "Можно свободно находиться на улице и заниматься спортом. Ограничений нет.",
      "Everyone can spend time and exercise outdoors. No restrictions.",
    ),
  },
  {
    level: 2,
    title: t(
      "Сифати ҳаво қаноатбахш",
      "Качество воздуха удовлетворительное",
      "Air quality is satisfactory",
    ),
    text: t(
      "Барои аксарият хатар нест. Одамони ҳассос метавонанд нороҳатии сабук ҳис кунанд.",
      "Для большинства людей риска нет. Особо чувствительные люди могут ощущать лёгкий дискомфорт.",
      "No risk for most people. Unusually sensitive people may notice mild discomfort.",
    ),
  },
  {
    level: 3,
    title: t("Ифлосшавии миёна", "Умеренное загрязнение", "Moderate pollution"),
    text: t(
      "Машқи тӯлонии шадид дар беруни бино маҳдуд кунед. Гурӯҳҳои осебпазир бояд эҳтиёт шаванд.",
      "Сократите длительные интенсивные нагрузки на улице. Уязвимым группам следует быть осторожнее.",
      "Reduce prolonged, intense outdoor exertion. Vulnerable groups should take care.",
    ),
  },
  {
    level: 4,
    title: t("Ҳаво бад аст", "Воздух плохой", "Air quality is poor"),
    text: t(
      "Вақти буданро дар беруни бино кам кунед, тирезаҳоро пӯшед. Гурӯҳҳои осебпазир — дар дохили бино бимонанд.",
      "Сократите время на улице, закройте окна. Уязвимым группам лучше оставаться в помещении; при симптомах обратитесь к врачу.",
      "Limit time outdoors and keep windows closed. Vulnerable groups should stay indoors; seek medical advice if symptoms appear.",
    ),
  },
  {
    level: 5,
    title: t("Ҳаво хеле бад аст", "Воздух очень плохой", "Air quality is very poor"),
    text: t(
      "Аз беруни бино дурӣ ҷӯед, корҳои ҷисмониро қатъ кунед, тозакунандаи ҳаво истифода баред. Ҳангоми нафастангӣ ба ёрии тиббӣ муроҷиат кунед.",
      "Избегайте пребывания на улице, отмените физические нагрузки, используйте очистители воздуха. При затруднённом дыхании обратитесь за медицинской помощью.",
      "Avoid going outdoors, cancel physical activity and use air purifiers. Seek medical help if breathing becomes difficult.",
    ),
  },
];
/** Рекомендации EPA для категорий US AQI (общее население), сокращённый перевод. */
const usAqiAdvice: Array<{ level: number; title: I18nText; text: I18nText }> = [
  {
    level: 1,
    title: t("Хуб", "Хороший", "Good"),
    text: t(
      "Сифати ҳаво қаноатбахш аст, ифлосшавӣ хатар надорад.",
      "Качество воздуха удовлетворительное, загрязнение не представляет риска.",
      "Air quality is satisfactory, and air pollution poses little or no risk.",
    ),
  },
  {
    level: 2,
    title: t("Миёна", "Умеренный", "Moderate"),
    text: t(
      "Сифати ҳаво қобили қабул аст. Одамони ба ифлосшавӣ хеле ҳассос метавонанд аломатҳои сабук ҳис кунанд.",
      "Качество воздуха приемлемое. Особо чувствительные к загрязнению люди могут ощущать лёгкие симптомы.",
      "Air quality is acceptable. Unusually sensitive people may experience mild symptoms.",
    ),
  },
  {
    level: 3,
    title: t(
      "Барои гурӯҳҳои ҳассос зарарнок",
      "Вредно для чувствительных групп",
      "Unhealthy for sensitive groups",
    ),
    text: t(
      "Гурӯҳҳои ҳассос (бемориҳои дил ва шуш, солхӯрдагон, кӯдакон) метавонанд оқибатҳоро ҳис кунанд; дигарон одатан хатар надоранд. Ба гурӯҳҳои ҳассос лозим аст машқи тӯлонӣ ё шадидро дар беруни бино кам кунанд.",
      "Чувствительные группы (заболевания сердца и лёгких, пожилые, дети) могут ощущать последствия; остальным, как правило, ничего не грозит. Чувствительным группам стоит сократить длительные или интенсивные нагрузки на улице.",
      "Members of sensitive groups (heart or lung disease, older adults, children) may experience health effects; the general public is less likely to be affected. Sensitive groups should reduce prolonged or heavy exertion outdoors.",
    ),
  },
  {
    level: 4,
    title: t("Зарарнок", "Вредно для здоровья", "Unhealthy"),
    text: t(
      "Баъзе одамон метавонанд оқибатҳои саломатиро ҳис кунанд; гурӯҳҳои ҳассос — ҷиддитар. Ба ҳама лозим аст машқи тӯлонӣ ва шадидро дар беруни бино кам кунанд, гурӯҳҳои ҳассос — аз онҳо худдорӣ кунанд.",
      "Некоторые люди могут ощущать последствия для здоровья; чувствительные группы — более серьёзные. Всем стоит сократить длительные и интенсивные нагрузки на улице, чувствительным группам — избегать их.",
      "Some members of the general public may experience health effects; sensitive groups may experience more serious effects. Everyone should reduce prolonged or heavy exertion outdoors; sensitive groups should avoid it.",
    ),
  },
  {
    level: 5,
    title: t("Хеле зарарнок", "Очень вредно для здоровья", "Very unhealthy"),
    text: t(
      "Огоҳӣ дар бораи хатар ба саломатӣ: оқибатҳо дар ҳама имконпазиранд. Аз машқи тӯлонӣ ва шадид дар беруни бино худдорӣ кунед; гурӯҳҳои ҳассос — дар дохили бино бимонанд.",
      "Предупреждение о рисках для здоровья: последствия возможны у всех. Избегайте длительных и интенсивных нагрузок на улице; чувствительным группам — оставаться в помещении.",
      "Health alert: the risk of health effects is increased for everyone. Avoid prolonged or heavy exertion outdoors; sensitive groups should stay indoors.",
    ),
  },
  {
    level: 6,
    title: t("Хатарнок", "Опасно", "Hazardous"),
    text: t(
      "Ҳолати изтирорӣ: оқибатҳои саломатӣ дар ҳама эҳтимол доранд. Аз ҳар гуна фаъолияти ҷисмонӣ дар беруни бино худдорӣ кунед ва дар дохили бино бо тирезаҳои пӯшида бимонед.",
      "Чрезвычайная ситуация: последствия для здоровья вероятны у всех. Избегайте любой физической активности на улице и оставайтесь в помещении с закрытыми окнами.",
      "Health emergency: everyone is likely to be affected. Avoid all physical activity outdoors and stay indoors with windows closed.",
    ),
  },
];
await db
  .insert(s.healthAdvice)
  .values([
    ...advice.map((a) => ({
      scaleId: sid("NATIONAL_OPERATIONAL"),
      level: a.level,
      audience: "general" as const,
      title: a.title,
      text: a.text,
    })),
    ...usAqiAdvice.map((a) => ({
      scaleId: sid("US_AQI"),
      level: a.level,
      audience: "general" as const,
      title: a.title,
      text: a.text,
    })),
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------------------
// 5. Регионы (геометрия загружается отдельно, см. infra/data)
// ---------------------------------------------------------------------------
await db
  .insert(s.regions)
  .values([
    { code: "DU", sortOrder: 1, name: t("Шаҳри Душанбе", "Город Душанбе", "Dushanbe city") },
    {
      code: "RRP",
      sortOrder: 2,
      name: t(
        "Ноҳияҳои тобеи ҷумҳурӣ",
        "Районы республиканского подчинения",
        "Districts of Republican Subordination",
      ),
    },
    { code: "SU", sortOrder: 3, name: t("Вилояти Суғд", "Согдийская область", "Sughd region") },
    { code: "KT", sortOrder: 4, name: t("Вилояти Хатлон", "Хатлонская область", "Khatlon region") },
    {
      code: "GB",
      sortOrder: 5,
      name: t(
        "Вилояти Мухтори Кӯҳистони Бадахшон",
        "Горно-Бадахшанская автономная область",
        "Gorno-Badakhshan Autonomous Region",
      ),
    },
  ])
  .onConflictDoNothing();
const regionRows = await db.select({ id: s.regions.id, code: s.regions.code }).from(s.regions);
const rid = Object.fromEntries(regionRows.map((r) => [r.code, r.id])) as Record<string, number>;

// ---------------------------------------------------------------------------
// 6. Точки прогноза (крупные города)
// ---------------------------------------------------------------------------
await db
  .insert(s.forecastLocations)
  .values([
    {
      slug: "dushanbe",
      name: t("Душанбе", "Душанбе", "Dushanbe"),
      geom: { x: 68.787, y: 38.5598 },
      regionId: rid.DU,
      sortOrder: 1,
      featured: true,
    },
    {
      slug: "khujand",
      name: t("Хуҷанд", "Худжанд", "Khujand"),
      geom: { x: 69.6333, y: 40.2833 },
      regionId: rid.SU,
      sortOrder: 2,
      featured: true,
    },
    {
      slug: "bokhtar",
      name: t("Бохтар", "Бохтар", "Bokhtar"),
      geom: { x: 68.7803, y: 37.8364 },
      regionId: rid.KT,
      sortOrder: 3,
      featured: true,
    },
    {
      slug: "kulob",
      name: t("Кӯлоб", "Куляб", "Kulob"),
      geom: { x: 69.7811, y: 37.9142 },
      regionId: rid.KT,
      sortOrder: 4,
      featured: true,
    },
    {
      slug: "khorugh",
      name: t("Хоруғ", "Хорог", "Khorugh"),
      geom: { x: 71.5533, y: 37.4897 },
      regionId: rid.GB,
      sortOrder: 5,
      featured: true,
    },
    {
      slug: "istaravshan",
      name: t("Истаравшан", "Истаравшан", "Istaravshan"),
      geom: { x: 69.0064, y: 39.9139 },
      regionId: rid.SU,
      sortOrder: 6,
      featured: false,
    },
    {
      slug: "tursunzoda",
      name: t("Турсунзода", "Турсунзаде", "Tursunzoda"),
      geom: { x: 68.2311, y: 38.5108 },
      regionId: rid.RRP,
      sortOrder: 7,
      featured: false,
    },
    {
      slug: "rasht",
      name: t("Рашт", "Рашт", "Rasht"),
      geom: { x: 70.3667, y: 39.0167 },
      regionId: rid.RRP,
      sortOrder: 8,
      featured: false,
    },
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------------------
// 7. Правила контроля качества по умолчанию
// ---------------------------------------------------------------------------
const ranges: Record<string, [number, number]> = {
  PM25: [0, 2000],
  PM10: [0, 3000],
  NO2: [0, 2000],
  SO2: [0, 3000],
  CO: [0, 100],
  O3: [0, 1000],
  NO: [0, 2000],
  CH2O: [0, 500],
  C6H5OH: [0, 200],
  HF: [0, 200],
  TSP: [0, 5000],
  CO2: [0, 10000],
  TVOC: [0, 50000],
};
const existingRules = await db.select({ n: count() }).from(s.qcRules);
if ((existingRules[0]?.n ?? 0) === 0) {
  await db.insert(s.qcRules).values([
    { pollutantId: null, kind: "spike" as const, params: { madMultiplier: 6, windowHours: 24 } },
    { pollutantId: null, kind: "stuck" as const, params: { hours: 12, continuousOnly: true } },
    { pollutantId: null, kind: "mad_outlier" as const, params: { z: 5, windowDays: 30 } },
  ]);
}
// Правило диапазона — для каждого вещества, у которого его ещё нет (новые вещества в существующей базе).
const rangeRules = await db
  .select({ pollutantId: s.qcRules.pollutantId })
  .from(s.qcRules)
  .where(eq(s.qcRules.kind, "range"));
const withRange = new Set(rangeRules.map((r) => r.pollutantId));
const missingRanges = Object.entries(ranges).filter(([code]) => !withRange.has(pid(code)));
if (missingRanges.length > 0) {
  await db.insert(s.qcRules).values(
    missingRanges.map(([code, [min, max]]) => ({
      pollutantId: pid(code),
      kind: "range" as const,
      params: { min, max },
    })),
  );
}

// ---------------------------------------------------------------------------
// 8. Настройки сайта
// ---------------------------------------------------------------------------
await db
  .insert(s.settings)
  .values([
    {
      key: "site",
      value: { name: t("Метеопортал", "Метеопортал", "Meteoportal"), defaultCity: "dushanbe" },
    },
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------------------
// Регионы предупреждений CAP: пока Агентство не передало коды SmartMet Alert (D3),
// используем коды и границы областей (geocode valueName любой, value = код области).
// ---------------------------------------------------------------------------
await db.execute(sql`
  insert into warning_regions (code, name, geom)
  select code, name, geom from regions
  on conflict (code) do nothing
`);

// ---------------------------------------------------------------------------
// Рубрики новостей
// ---------------------------------------------------------------------------
await db
  .insert(s.newsCategories)
  .values([
    { slug: "news", name: t("Хабарҳо", "Новости", "News"), sortOrder: 1 },
    { slug: "announcements", name: t("Эълонҳо", "Объявления", "Announcements"), sortOrder: 2 },
    { slug: "bulletins", name: t("Бюллетенҳо", "Бюллетени", "Bulletins"), sortOrder: 3 },
  ])
  .onConflictDoNothing();

// ---------------------------------------------------------------------------
// 9. Первый администратор (только если пользователей ещё нет)
// ---------------------------------------------------------------------------
const usersCount = (await db.select({ n: count() }).from(s.users))[0]?.n ?? 0;
if (usersCount === 0) {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn(
      "[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD не заданы — администратор не создан",
    );
  } else if (password.length < 10) {
    throw new Error("[seed] SEED_ADMIN_PASSWORD должен быть не короче 10 символов");
  } else {
    const userId = randomUUID();
    await db.insert(s.users).values({
      id: userId,
      name: process.env.SEED_ADMIN_NAME ?? "Администратор",
      email: email.toLowerCase(),
      emailVerified: true,
      role: "admin",
      locale: "ru",
    });
    await db.insert(s.accounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword(password),
    });
    await db.insert(s.auditLog).values({
      actorEmail: "seed",
      actorRole: "system",
      action: "user.create",
      entity: "users",
      entityId: userId,
      after: { email: email.toLowerCase(), role: "admin" },
    });
    console.info(`[seed] создан администратор ${email}`);
  }
} else {
  const admins = await db.select({ n: count() }).from(s.users).where(eq(s.users.role, "admin"));
  console.info(
    `[seed] пользователи уже есть (${usersCount}, администраторов: ${admins[0]?.n ?? 0})`,
  );
}

await db.$client.end();
console.info("[seed] готово");
