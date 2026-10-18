/**
 * Единицы концентрации и конверсия. Хранение в БД — в единице загрязнителя
 * (pollutants.unit: µg/m³, для CO — mg/m³). Входные данные могут приходить в ppb/ppm.
 * Конверсия газов выполняется при 25 °C и 1 атм (молярный объём 24,45 л/моль).
 */
export const CONCENTRATION_UNITS = ["µg/m³", "mg/m³", "ppb", "ppm"] as const;
export type ConcentrationUnit = (typeof CONCENTRATION_UNITS)[number];

export const MOLAR_VOLUME_L = 24.45;

/** Нормализует написание единиц из CSV/форм: ug/m3, мкг/м3, mg/m3 … */
export function normalizeUnit(raw: string): ConcentrationUnit | null {
  const u = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (["µg/m³", "µg/m3", "ug/m3", "ug/m³", "мкг/м3", "мкг/м³", "mcg/m3"].includes(u))
    return "µg/m³";
  if (["mg/m³", "mg/m3", "мг/м3", "мг/м³"].includes(u)) return "mg/m³";
  if (u === "ppb") return "ppb";
  if (u === "ppm") return "ppm";
  return null;
}

export function isConcentrationUnit(value: string): value is ConcentrationUnit {
  return (CONCENTRATION_UNITS as readonly string[]).includes(value);
}

/**
 * Переводит значение между единицами. Для ppb/ppm нужна молярная масса (г/моль);
 * для частиц (PM) объёмные единицы недопустимы — бросает ошибку.
 */
export function convertConcentration(
  value: number,
  from: ConcentrationUnit,
  to: ConcentrationUnit,
  molarMass?: number | null,
): number {
  if (from === to) return value;
  // сначала приводим к µg/m³
  let ugm3: number;
  switch (from) {
    case "µg/m³":
      ugm3 = value;
      break;
    case "mg/m³":
      ugm3 = value * 1000;
      break;
    case "ppb":
      ugm3 = (value * requireMolarMass(molarMass)) / MOLAR_VOLUME_L;
      break;
    case "ppm":
      ugm3 = (value * 1000 * requireMolarMass(molarMass)) / MOLAR_VOLUME_L;
      break;
  }
  switch (to) {
    case "µg/m³":
      return ugm3;
    case "mg/m³":
      return ugm3 / 1000;
    case "ppb":
      return (ugm3 * MOLAR_VOLUME_L) / requireMolarMass(molarMass);
    case "ppm":
      return (ugm3 * MOLAR_VOLUME_L) / requireMolarMass(molarMass) / 1000;
  }
}

function requireMolarMass(m: number | null | undefined): number {
  if (!m || m <= 0) {
    throw new Error("Для перевода ppb/ppm нужна молярная масса вещества");
  }
  return m;
}

/** Округление до числа знаков загрязнителя без артефактов плавающей точки. */
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}
