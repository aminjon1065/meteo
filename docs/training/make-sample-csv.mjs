#!/usr/bin/env node
/**
 * Учебный CSV с измерениями за последние 48 часов (docs/training/outline.md, задание «Импорт CSV»).
 *
 *   node docs/training/make-sample-csv.mjs > measurements-sample.csv
 *   node docs/training/make-sample-csv.mjs DU-01 SU-01 > sample.csv     # коды станций из реестра
 *
 * Формат соответствует импорту в админке: столбцы time;station;pollutant;value;unit, время местное
 * (Душанбе, UTC+5), десятичная запятая. В файл намеренно включены один «скачок» (PM2.5 = 480 µg/m³,
 * попадёт в очередь контроля качества) и одно значение вне диапазона (PM10 = 9500 µg/m³, будет
 * сохранено с флагом «недостоверное»).
 */
import { fileURLToPath } from "node:url";

const HOUR = 3_600_000;
const BASE = {
  default: { PM25: 38, PM10: 85, NO2: 34, SO2: 12, CO: 1.1, O3: 48 },
  "SU-01": { PM25: 22, PM10: 55, NO2: 19, SO2: 8, CO: 0.7, O3: 62 },
  "KT-01": { PM25: 61, PM10: 140, NO2: 15, SO2: 20, CO: 0.9, O3: 41 },
};

export function makeSampleCsv({
  stations = ["DU-01"],
  hours = 48,
  minute = 0,
  now = new Date(),
} = {}) {
  const end = new Date(
    Math.floor((now.getTime() - minute * 60_000) / HOUR) * HOUR + minute * 60_000,
  );
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const rows = ["time;station;pollutant;value;unit"];
  for (let h = hours - 1; h >= 0; h--) {
    const t = new Date(end.getTime() - h * HOUR);
    const local = new Date(t.getTime() + 5 * HOUR);
    const stamp = `${local.toISOString().slice(0, 10)} ${local.toISOString().slice(11, 16)}`;
    const hourLocal = local.getUTCHours();
    const diurnal = 1 + 0.35 * Math.cos(((hourLocal - 8) / 24) * 2 * Math.PI);
    for (const station of stations) {
      const base = BASE[station] ?? BASE.default;
      for (const [pollutant, typical] of Object.entries(base)) {
        let value = typical * diurnal * (0.85 + 0.3 * rnd());
        if (pollutant === "O3") {
          value =
            typical *
            (1 + 0.5 * Math.sin(((hourLocal - 14) / 24) * 2 * Math.PI)) *
            (0.9 + 0.2 * rnd());
        }
        if (station === stations[0] && pollutant === "PM25" && h === 6) value = 480;
        if (station === stations[stations.length - 1] && pollutant === "PM10" && h === 30) {
          value = 9500;
        }
        const decimals = pollutant === "CO" ? 2 : 1;
        const unit = pollutant === "CO" ? "mg/m3" : "ug/m3";
        rows.push(
          `${stamp};${station};${pollutant};${value.toFixed(decimals).replace(".", ",")};${unit}`,
        );
      }
    }
  }
  return `${String.fromCharCode(0xfeff)}${rows.join("\n")}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stations = process.argv.slice(2);
  process.stdout.write(makeSampleCsv(stations.length ? { stations } : {}));
}
