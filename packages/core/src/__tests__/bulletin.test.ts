import { describe, expect, it } from "vitest";
import {
  type BulletinPollutantDef,
  buildBulletinStats,
  type DayValuesByPollutant,
  dayStats,
  form4aRows,
  formatCases,
  formatConcentration,
  formatLimit,
  formatNumber,
  formatRatio,
  localDayRangeUtc,
  mergeDayValues,
  ratioChange,
  shiftIsoDate,
  summationRatio,
} from "../bulletin";
import { docToText } from "../bulletin-doc";
import { renderDocHtml } from "../bulletin-html";
import { BULLETIN_PHRASES } from "../bulletin-phrases";
import {
  buildCityDocument,
  buildForm4aDocument,
  buildSummaryDocument,
  compareSentences,
  formatDateLong,
  pollutantLabel,
} from "../bulletin-text";

/** Справочник в единицах хранения (µg/m³; CO — mg/m³), ПДК как в бюллетене Агентства от 19.10.2026. */
const P = {
  PM10: {
    id: 2,
    code: "PM10",
    shortName: "PM10",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 2,
    dailyLimit: 60,
    maxSingleLimit: 300,
  },
  PM25: {
    id: 1,
    code: "PM25",
    shortName: "PM2.5",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 1,
    dailyLimit: 35,
    maxSingleLimit: 160,
  },
  SO2: {
    id: 4,
    code: "SO2",
    shortName: "SO₂",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 4,
    dailyLimit: 50,
    maxSingleLimit: 500,
  },
  CO: {
    id: 5,
    code: "CO",
    shortName: "CO",
    unit: "mg/m³",
    decimals: 2,
    sortOrder: 5,
    dailyLimit: 3,
    maxSingleLimit: 5,
  },
  NO2: {
    id: 3,
    code: "NO2",
    shortName: "NO₂",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 3,
    dailyLimit: 40,
    maxSingleLimit: 85,
  },
  O3: {
    id: 6,
    code: "O3",
    shortName: "O₃",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 6,
    dailyLimit: 30,
    maxSingleLimit: 160,
  },
  HF: {
    id: 10,
    code: "HF",
    shortName: "HF",
    unit: "µg/m³",
    decimals: 2,
    sortOrder: 10,
    dailyLimit: 5,
    maxSingleLimit: 20,
  },
  CO2: {
    id: 12,
    code: "CO2",
    shortName: "CO₂",
    unit: "ppm",
    decimals: 0,
    sortOrder: 12,
    dailyLimit: null,
    maxSingleLimit: null,
  },
  XYZ: {
    id: 99,
    code: "XYZ",
    shortName: "XYZ",
    unit: "µg/m³",
    decimals: 1,
    sortOrder: 99,
    dailyLimit: 10,
    maxSingleLimit: 20,
    name: { ru: "Вещество XYZ", tg: "Моддаи XYZ" },
  },
} satisfies Record<string, BulletinPollutantDef>;

const pollutants = [P.PM10, P.PM25, P.SO2, P.CO, P.NO2, P.O3];

/** Сутки станции: 24 часовых значения вокруг среднего mean с пиком peak. */
function hours(mean: number, peak: number): number[] {
  const values = Array.from({ length: 24 }, () => mean);
  values[13] = peak;
  return values;
}

function day(entries: Array<[BulletinPollutantDef, number[]]>): DayValuesByPollutant {
  return new Map(entries.map(([p, single]) => [p.id, { single, daily: [] }]));
}

describe("форматирование чисел", () => {
  it("запятая‑разделитель, лишние нули убираются", () => {
    expect(formatNumber(1.3, 2)).toBe("1,3");
    expect(formatNumber(1.3, 2, 2)).toBe("1,30");
    expect(formatNumber(3, 2)).toBe("3");
    expect(formatNumber(0.1 + 0.2, 2)).toBe("0,3");
  });
  it("кратности: два знака, малые — две значащие цифры", () => {
    expect(formatRatio(1.3166)).toBe("1,32");
    expect(formatRatio(1.3)).toBe("1,3");
    expect(formatRatio(0.038)).toBe("0,04");
    expect(formatRatio(0.006)).toBe("0,006");
    expect(formatRatio(0.0058)).toBe("0,0058");
    expect(formatRatio(null)).toBe("-");
    expect(formatRatio(0)).toBe("0");
  });
  it("концентрации и ПДК в мг/м³", () => {
    expect(formatConcentration(79, P.PM10)).toBe("0,079");
    expect(formatConcentration(20, P.PM25)).toBe("0,020");
    expect(formatConcentration(0.65, P.CO)).toBe("0,65");
    expect(formatConcentration(1.6, { ...P.NO2, decimals: 2 })).toBe("0,0016");
    expect(formatConcentration(0.03, P.HF)).toBe("0,00003");
    expect(formatConcentration(0.16, P.HF)).toBe("0,0002");
    expect(formatConcentration(82.208, P.PM10)).toBe("0,082");
    expect(formatConcentration(156, P.PM10)).toBe("0,156");
    expect(formatConcentration(496, P.CO2)).toBe("496");
    expect(formatLimit(60, P.PM10)).toBe("0,06");
    expect(formatLimit(35, P.PM25)).toBe("0,035");
    expect(formatLimit(85, P.NO2)).toBe("0,085");
    expect(formatLimit(3, P.CO)).toBe("3");
    expect(formatLimit(null, P.CO2)).toBe("-");
  });
  it("число случаев превышения", () => {
    expect(formatCases(0, 0)).toBe("-");
    expect(formatCases(1, 0)).toBe("1");
    expect(formatCases(1, 1)).toBe("1-1");
    expect(formatCases(0, 3)).toBe("0-3");
  });
});

describe("статистика суток", () => {
  it("среднесуточная, максимум, кратности и случаи превышения", () => {
    const st = dayStats(P.NO2, { single: hours(55, 101), daily: [] });
    expect(st.mean).toBeCloseTo(56.9, 1);
    expect(st.max).toBe(101);
    expect(st.ratioDaily).toBeCloseTo(1.42, 2);
    expect(st.ratioSingle).toBeCloseTo(1.19, 2);
    expect(st.casesDaily).toBe(1);
    expect(st.casesSingle).toBe(1);
    expect(st.highPollution).toBe(false);
  });
  it("без разовых значений среднее берётся из суточных записей, максимума нет", () => {
    const st = dayStats(P.PM10, { single: [], daily: [79] });
    expect(st.mean).toBe(79);
    expect(st.max).toBeNull();
    expect(st.ratioSingle).toBeNull();
    expect(st.casesDaily).toBe(1);
  });
  it("ВЗ при ≥ 10 ПДКм.р., ЭВЗ при ≥ 50; ≥ 5 ПДК попадает во вторую колонку", () => {
    const high = dayStats(P.SO2, { single: [10, 5_000, 20], daily: [] });
    expect(high.highPollution).toBe(true);
    expect(high.extremePollution).toBe(false);
    expect(high.casesHighSingle).toBe(1);
    const extreme = dayStats(P.SO2, { single: [25_000], daily: [] });
    expect(extreme.extremePollution).toBe(true);
  });
  it("вещество без нормативов: только концентрации", () => {
    const st = dayStats(P.CO2, { single: [480, 512], daily: [] });
    expect(st.mean).toBe(496);
    expect(st.ratioDaily).toBeNull();
    expect(st.casesDaily).toBe(0);
  });
  it("объёмные единицы (ppb) печатаются без кратностей, даже если норматив задан", () => {
    const tvoc = {
      ...P.CO2,
      id: 13,
      code: "TVOC",
      unit: "ppb",
      dailyLimit: 300,
      maxSingleLimit: 900,
    };
    const st = dayStats(tvoc, { single: [1, 1.5], daily: [] });
    expect(st.ratioDaily).toBeNull();
    expect(st.ratioSingle).toBeNull();
  });
  it("сравнение по напечатанным кратностям: 1,30 и 1,3 — на уровне", () => {
    expect(ratioChange(1.3, 1.304)).toEqual({ kind: "same", from: 1.304, to: 1.3 });
    expect(ratioChange(1.32, 1.2)?.kind).toBe("up");
    expect(ratioChange(0.57, 0.71)?.kind).toBe("down");
    expect(ratioChange(null, 1)).toBeNull();
  });
});

describe("суммация NO2+SO2", () => {
  it("по методике Агентства — к ПДКм.р.: 0,055/0,085 + 0,006/0,5 ≈ 0,66", () => {
    const stats = new Map([
      [P.NO2.id, dayStats(P.NO2, { single: [55], daily: [] })],
      [P.SO2.id, dayStats(P.SO2, { single: [6], daily: [] })],
    ]);
    expect(summationRatio(stats, pollutants)).toBeCloseTo(0.659, 2);
    expect(summationRatio(stats, pollutants, { limitKind: "daily" })).toBeCloseTo(1.495, 2);
  });
  it("нет одного из веществ — суммации нет", () => {
    const stats = new Map([[P.NO2.id, dayStats(P.NO2, { single: [55], daily: [] })]]);
    expect(summationRatio(stats, pollutants)).toBeNull();
  });
});

const today = day([
  [P.PM10, hours(79, 156)],
  [P.PM25, hours(20, 41)],
  [P.SO2, hours(6, 19)],
  [P.CO, hours(0.65, 1.47)],
  [P.NO2, hours(55, 101)],
  [P.O3, hours(38, 93)],
]);
const yesterday = day([
  [P.PM10, hours(72, 140)],
  [P.PM25, hours(25, 50)],
  [P.SO2, hours(2, 10)],
  [P.CO, hours(0.6, 1.2)],
  [P.NO2, hours(50, 90)],
  [P.O3, hours(21, 60)],
]);

describe("buildBulletinStats", () => {
  const stats = buildBulletinStats(pollutants, today, yesterday);
  it("строки отсортированы по порядку справочника, сравнение и суммация заполнены", () => {
    expect(stats.rows.map((r) => r.pollutant.code)).toEqual([
      "PM25",
      "PM10",
      "NO2",
      "SO2",
      "CO",
      "O3",
    ]);
    expect(stats.hasData).toBe(true);
    expect(stats.hasYesterday).toBe(true);
    expect(stats.summation.today).toBeCloseTo(0.68, 2);
    expect(stats.summation.change?.kind).toBe("up");
    const pm25 = stats.rows.find((r) => r.pollutant.code === "PM25");
    expect(pm25?.change?.kind).toBe("down");
  });
  it("группы превышений: NO2 по обеим ПДК, PM10 и O3 — только среднесуточная", () => {
    expect(stats.exceedances.both).toEqual([P.NO2.id]);
    expect(stats.exceedances.dailyOnly).toEqual([P.PM10.id, P.O3.id]);
    expect(stats.exceedances.singleOnly).toEqual([]);
    expect(stats.highPollution).toEqual([]);
  });
  it("форма 4а: максимум печатается только при превышении ПДКм.р.", () => {
    const rows = form4aRows(stats);
    expect(rows.map((r) => r.pollutant.code)).toEqual(["PM10", "NO2", "O3"]);
    expect(rows.find((r) => r.pollutant.code === "NO2")?.singleExceeds).toBe(true);
    expect(rows.find((r) => r.pollutant.code === "PM10")?.singleExceeds).toBe(false);
  });
  it("onlyWithData убирает вещества без данных, hasYesterday без вчерашних данных — false", () => {
    const partial = buildBulletinStats([P.PM10, P.CO2], day([[P.PM10, [50]]]), null, {
      onlyWithData: true,
    });
    expect(partial.rows.map((r) => r.pollutant.code)).toEqual(["PM10"]);
    expect(partial.hasYesterday).toBe(false);
    expect(partial.summation.today).toBeNull();
  });
  it("mergeDayValues объединяет станции одного города", () => {
    const merged = mergeDayValues([
      day([[P.PM10, [10, 20]]]),
      day([
        [P.PM10, [60]],
        [P.NO2, [5]],
      ]),
    ]);
    expect(merged.get(P.PM10.id)?.single).toEqual([10, 20, 60]);
    expect(merged.get(P.NO2.id)?.single).toEqual([5]);
  });
});

describe("названия веществ и даты", () => {
  it("падежи ru, одна форма tg, синонимы кодов и фолбэк на справочник", () => {
    expect(pollutantLabel(P.NO2, "ru", "nom")).toBe("Диоксид азота");
    expect(pollutantLabel(P.NO2, "ru", "gen")).toBe("диоксида азота (NO2)");
    expect(pollutantLabel(P.NO2, "ru", "dat")).toBe("диоксиду азота (NO2)");
    expect(pollutantLabel(P.PM10, "tg")).toBe("Зарачаҳои 10 мкр. (РМ-10)");
    expect(pollutantLabel({ ...P.PM25, code: "PM2.5" }, "ru", "gen")).toBe(
      "частиц 2,5 мкр. (РМ-2,5)",
    );
    expect(pollutantLabel(P.CO2, "ru")).toBe("Диоксид углерода (СО2) (ppm)");
    expect(pollutantLabel(P.XYZ, "ru", "gen")).toBe("вещество XYZ (XYZ)");
    expect(pollutantLabel(P.XYZ, "tg")).toBe("Моддаи XYZ (XYZ)");
  });
  it("дата словами и границы местных суток", () => {
    expect(formatDateLong("2026-10-19", "ru")).toBe("19 октября 2026");
    expect(formatDateLong("2026-10-19", "tg")).toBe("19 октябри 2026");
    expect(shiftIsoDate("2026-10-31", 1)).toBe("2026-11-01");
    const range = localDayRangeUtc("2026-10-19");
    expect(range.start.toISOString()).toBe("2026-10-18T19:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-19T19:00:00.000Z");
  });
});

describe("текст бюллетеня", () => {
  const stats = buildBulletinStats(pollutants, today, yesterday);
  const ctx = { date: "2026-10-19", city: { ru: "Душанбе", tg: "Душанбе" }, gamma: "0,014" };

  it("ru: абзац сравнения воспроизводит формулировки образца", () => {
    const [up, down] = compareSentences(stats, "ru", BULLETIN_PHRASES.ru.city.compare);
    expect(up).toBe(
      "Наблюдалось повышение среднесуточных концентраций частиц 10 мкр. (РМ-10) с 1,25 до 1,37; диоксида азота (NO2) с 1,29 до 1,42; диоксида серы (SO2) с 0,05 до 0,13; оксида углерода (CO) с 0,21 до 0,23; озона (О3) с 0,75 до 1,34 ПДКс.с. и суммарного содержания диоксида азота и серы (NO2+SO2) с 0,61 до 0,68.",
    );
    expect(down).toBe(
      "Понижение среднесуточных концентраций частиц 2,5 мкр. (РМ-2,5) с 0,74 до 0,6 ПДКс.с.",
    );
  });

  it("ru: документ города — шапка, таблица, превышения, гамма‑фон, примечания, подпись", () => {
    const doc = buildCityDocument(stats, ctx, "ru");
    const text = docToText(doc);
    expect(doc.title).toBe("Экологический бюллетень г. Душанбе за 19 октября 2026");
    expect(text).toContain("ЭКОЛОГИЧЕСКИЙ БЮЛЛЕТЕНЬ");
    expect(text).toContain("города Душанбе за 19 октября 2026 г.");
    expect(text).toContain(
      "Примесь | Средняя концентрация (qс.с.) | Максимально разовая концентрация (qм.р.) | Число случаев превышения ПДК",
    );
    expect(text).toContain("Диоксид азота | 0,057 | 0,04 | 1,42 | 0,101 | 0,085 | 1,19 | 1-1 | -");
    expect(text).toContain(
      "Взвешенные частицы РМ-10 | 0,082 | 0,06 | 1,37 | 0,156 | 0,3 | 0,52 | 1 | -",
    );
    expect(text).toContain("∑ NO2 + SO2 | 0,68");
    expect(text).toContain("по оксиду углерода (CO) – 0,23 ПДКс.с., 0,29 ПДКм.р.");
    expect(text).toContain(
      "Случаи превышения среднесуточной и максимально разовой концентрации по диоксиду азота (NO2), среднесуточной концентрации по частицам 10 мкр. (РМ-10), озону (О3) загрязняющих веществ в атмосферном воздухе отмечены из-за метеорологических условий и антропогенных факторов (промышленных и транспортных выбросов, строительных работ). Случаев высокого и экстремально высокого загрязнения воздуха (ВЗ и ЭВЗ) не наблюдалось.",
    );
    expect(text).toContain(
      "Радиационный γ-фон в наблюдаемом пункте составляет 0,014 мР/ч, что не превышает норму.",
    );
    expect(text).toContain("ПДКс.с. – предельно допустимая среднесуточная концентрация;");
    expect(text).toContain("ОИ УМОС");
    expect(text).toContain("20.10.2026 г.");
  });

  it("tg: документ города — таблица с нумерацией, сравнение, примечания «Эзоҳ»", () => {
    const doc = buildCityDocument(stats, { ...ctx, automatic: true }, "tg");
    const text = docToText(doc);
    expect(text).toContain("Шарҳи ҳолати ифлосшавии ҳаво дар шаҳри Душанбе");
    expect(text).toContain("барои санаи 19 октябри 2026");
    expect(text).toContain("дар нуқтаи худкори Агентии обуҳавошиносӣ");
    expect(text).toContain(
      "3 | Дуоксиди нитроген (NO2) | 0,057 | 0,04 | 1,42 | 0,101 | 0,085 | 1,19",
    );
    expect(text).toContain(
      "Баландшавии консентратсияи миёнаи шабонарӯзии зарачаҳои 10 мкр. (РМ-10) аз 1,25 то 1,37;",
    );
    expect(text).toContain(
      "Мувофиқи натиҷаҳо консентратсияи миёнаи шабонарӯзӣ ва якмаротибагии дуоксиди нитроген (NO2), консентратсияи миёнаи шабонарӯзии зарачаҳои 10 мкр. (РМ-10), озон (О3) бо сабабҳои шароити метеорологӣ",
    );
    expect(text).toContain(
      "Нишондоди гамма-афканишот дар нуқтаи мушоҳидавӣ 0,014 мР/с-ро ташкил дода",
    );
    expect(text).toContain("Эзоҳ:");
    expect(text).toContain("ШИ РММЗ");
  });

  it("причины и подпись переопределяются настройками; без гамма‑фона абзац не печатается", () => {
    const doc = buildCityDocument(
      stats,
      {
        ...ctx,
        gamma: null,
        causes: { ru: "из-за штиля" },
        department: { ru: "Отдел мониторинга" },
      },
      "ru",
    );
    const text = docToText(doc);
    expect(text).toContain("отмечены из-за штиля.");
    expect(text).toContain("Отдел мониторинга");
    expect(text).not.toContain("γ-фон");
  });

  it("без превышений и без данных за вчера — соответствующие фразы", () => {
    const clean = buildBulletinStats([P.PM25], day([[P.PM25, hours(10, 12)]]), null);
    const text = docToText(buildCityDocument(clean, ctx, "ru"));
    expect(text).toContain(
      "Данных за предыдущие сутки нет, сравнение с предыдущим днём не проводилось.",
    );
    expect(text).toContain(
      "Случаев превышения ПДК загрязняющих веществ в атмосферном воздухе не наблюдалось.",
    );
  });

  it("сводка по городам (ЗАВ / ИҲА) и форма 4а", () => {
    const khujand = buildBulletinStats(
      [P.SO2, P.NO2],
      day([
        [P.SO2, [9]],
        [P.NO2, [8]],
      ]),
      day([
        [P.SO2, [3]],
        [P.NO2, [5]],
      ]),
      { onlyWithData: true },
    );
    const entries = [
      {
        key: "DU",
        name: { ru: "Душанбе", tg: "Душанбе" },
        label: { ru: "г. Душанбе", tg: "ш. Душанбе" },
        stats,
      },
      {
        key: "KH",
        name: { ru: "Худжанд", tg: "Хуҷанд" },
        label: { ru: "г. Худжанд", tg: "ш. Хуҷанд" },
        stats: khujand,
      },
      {
        key: "KU",
        name: { ru: "Куляб", tg: "Кӯлоб" },
        label: { ru: "г. Куляб", tg: "ш. Кӯлоб" },
        stats: buildBulletinStats([P.PM10], new Map(), null),
      },
    ];
    const ru = docToText(buildSummaryDocument(entries, { date: "2026-10-19" }, "ru"));
    expect(ru).toContain("Загрязнение атмосферного воздуха");
    expect(ru).toContain(
      "19 октября 2026 года уровень загрязнения атмосферного воздуха в городах республики относительно предыдущего дня несколько изменился. Случаев высокого и экстремально высокого загрязнения воздуха не наблюдалось (ВЗ и ЭВЗ).",
    );
    expect(ru).toContain(
      "В воздушном бассейне г. Душанбе наблюдалось повышение среднесуточных концентраций частиц 10 мкр. (РМ-10) с 1,25 до 1,37;",
    );
    expect(ru).toContain("с 0,74 до 0,6 ПДКс.с.\nВ воздушном бассейне г. Худжанд");
    expect(ru).toContain(
      "В воздушном бассейне г. Худжанд наблюдалось повышение среднесуточных концентраций диоксида азота (NO2) с 0,13 до 0,2; диоксида серы (SO2) с 0,06 до 0,18 ПДКс.с. и суммарного содержания диоксида азота и серы (NO2+SO2) с 0,06 до 0,11.",
    );
    expect(ru).toContain("По г. Куляб данные за сутки отсутствуют.");
    expect(ru).toContain("20.10.26");
    const tg = docToText(buildSummaryDocument(entries, { date: "2026-10-19" }, "tg"));
    expect(tg).toContain("Шарҳи сифати ҳавои атмосферӣ дар шаҳри Душанбе ва минтақаҳои саноатӣ.");
    expect(tg).toContain(
      "Дар фазои ш. Хуҷанд баландшавии консентратсияи миёнаи шабонарӯзии дуоксиди нитроген (NO2) аз 0,13 то 0,2; дуоксиди сулфур (SO2) аз 0,06 то 0,18 ҲМҒм.ш.р ва ҷамъи дуоксидҳои нитрогену сулфур (NO2+SO2) аз 0,06 то 0,11 мушоҳида шуд.",
    );
    const form = docToText(buildForm4aDocument(entries, { date: "2026-10-19" }, "tg"));
    expect(form).toContain("Намунаи 4а");
    expect(form).toContain("оиди дараҷаи ифлосшавии ҳаво барои санаи 19 октябри 2026 с.");
    expect(form).toContain("1 | Душанбе | зарачаҳои 10 мкр. (РМ-10) | 0,082 | 1,37 | - | -");
    expect(form).toContain("дуоксиди нитроген (NO2) | 0,057 | 1,42 | 0,101 | 1,19");
    expect(form).toContain("ҲМҒ(м.ш.р) – ҳадди муайяни ғилзати миёнаи шабонарӯзӣ;");
    const emptyForm = docToText(
      buildForm4aDocument([entries[2] as (typeof entries)[number]], { date: "2026-10-19" }, "ru"),
    );
    expect(emptyForm).toContain("Превышений ПДК загрязняющих веществ не зарегистрировано.");
  });

  it("HTML: текст экранируется, объединение ячеек и печатная страница", () => {
    const doc = buildCityDocument(stats, { ...ctx, causes: { ru: "<b>причины</b>" } }, "ru");
    const html = renderDocHtml(doc);
    expect(html).toContain('<div class="eco-doc" lang="ru">');
    expect(html).toContain("&lt;b&gt;причины&lt;/b&gt;");
    expect(html).toContain('rowspan="2"');
    expect(html).toContain('colspan="3"');
    expect(html).not.toContain("<script");
    const page = renderDocHtml(doc, { standalone: true, autoPrint: true });
    expect(page).toContain("<!doctype html>");
    expect(page).toContain("@page{size:A4");
    expect(page).toContain("window.print()");
  });
});
