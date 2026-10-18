/**
 * Seed справочников. Идемпотентен: существующие записи не перезаписываются,
 * чтобы не затирать правки администратора. Значения порогов и ПДК — черновик
 * к согласованию с Заказчиком (docs/02-architecture.md §6, зависимость D6).
 */
import { randomUUID } from "node:crypto";
import { AQ_LEVEL_STYLES } from "@meteo/core";
import type { I18nText } from "@meteo/i18n";
import { hashPassword } from "better-auth/crypto";
import { count, eq, sql } from "drizzle-orm";
import { createDb } from "./client";
import { loadRootEnv, requireEnv } from "./env";
import * as s from "./schema";

loadRootEnv();
const db = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const t = (tg: string, ru: string, en: string): I18nText => ({ tg, ru, en });

// ---------------------------------------------------------------------------
// 1. Загрязнители
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
    name: t("Зарраҳои муаллақи PM2.5", "Взвешенные частицы PM2.5", "Particulate matter PM2.5"),
  },
  {
    code: "PM10",
    shortName: "PM10",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 2,
    hazardClass: 3,
    molarMass: null,
    name: t("Зарраҳои муаллақи PM10", "Взвешенные частицы PM10", "Particulate matter PM10"),
  },
  {
    code: "NO2",
    shortName: "NO₂",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 3,
    hazardClass: 3,
    molarMass: 46.0055,
    name: t("Диоксиди нитроген", "Диоксид азота", "Nitrogen dioxide"),
  },
  {
    code: "SO2",
    shortName: "SO₂",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 4,
    hazardClass: 3,
    molarMass: 64.066,
    name: t("Диоксиди сулфур", "Диоксид серы", "Sulphur dioxide"),
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
];

await db.insert(s.pollutants).values(pollutantSeed).onConflictDoNothing();
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
// 2. ПДК (черновик по СанПиН 1.2.3685‑21; единицы — как у загрязнителя)
// ---------------------------------------------------------------------------
const limitSource = "СанПиН 1.2.3685-21 (черновик, к подтверждению Заказчиком)";
const limits: Array<{ code: string; daily: number; maxSingle: number }> = [
  { code: "PM25", daily: 35, maxSingle: 160 },
  { code: "PM10", daily: 60, maxSingle: 300 },
  { code: "NO2", daily: 40, maxSingle: 200 },
  { code: "SO2", daily: 50, maxSingle: 500 },
  { code: "CO", daily: 3, maxSingle: 5 },
  { code: "O3", daily: 30, maxSingle: 160 },
];
await db
  .insert(s.limitValues)
  .values(
    limits.flatMap((l) => [
      { pollutantId: pid(l.code), kind: "daily" as const, value: l.daily, source: limitSource },
      {
        pollutantId: pid(l.code),
        kind: "max_single" as const,
        value: l.maxSingle,
        source: limitSource,
      },
    ]),
  )
  .onConflictDoNothing();

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
      code: "IZA",
      kind: "iza",
      name: t(
        "Индекси ифлосшавии атмосфера (ИЗА)",
        "Индекс загрязнения атмосферы (ИЗА)",
        "Atmospheric pollution index (IZA)",
      ),
      description: t(
        "ИЗА аз рӯи РД 52.04.186‑89: маҷмӯи консентратсияҳои миёнаи моҳона нисбат ба ҲИМ.",
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
await db
  .insert(s.indexBreakpoints)
  .values([...operational, ...who])
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
await db
  .insert(s.healthAdvice)
  .values(
    advice.map((a) => ({
      scaleId: sid("NATIONAL_OPERATIONAL"),
      level: a.level,
      audience: "general" as const,
      title: a.title,
      text: a.text,
    })),
  )
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
};
const existingRules = await db.select({ n: count() }).from(s.qcRules);
if ((existingRules[0]?.n ?? 0) === 0) {
  await db.insert(s.qcRules).values([
    ...Object.entries(ranges).map(([code, [min, max]]) => ({
      pollutantId: pid(code),
      kind: "range" as const,
      params: { min, max },
    })),
    { pollutantId: null, kind: "spike" as const, params: { madMultiplier: 6, windowHours: 24 } },
    { pollutantId: null, kind: "stuck" as const, params: { hours: 12, continuousOnly: true } },
    { pollutantId: null, kind: "mad_outlier" as const, params: { z: 5, windowDays: 30 } },
  ]);
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
