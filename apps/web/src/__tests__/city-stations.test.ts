import { describe, expect, it } from "vitest";
import { CITY_RADIUS_KM, distanceKm, stationsOfCity } from "../lib/city-stations";

// Точки прогноза (seed) и датчики сети WWCS — реальные координаты.
const dushanbe = { lon: 68.787, lat: 38.5598 };
const vahdat = { lon: 69.017, lat: 38.56 };
const hisor = { lon: 68.55, lat: 38.525 };
const cities = [dushanbe, vahdat, hisor];

const fti = { code: "DYU012_ECO", lon: 68.8561, lat: 38.5594 }; // восток Душанбе
const medgorodok = { code: "DYU01_ECO", lon: 68.7837, lat: 38.6002 };
const vahdatSensor = { code: "VAH001_ECO", lon: 69.0211, lat: 38.5642 };
const hisorSensor = { code: "HIS003_ECO", lon: 68.5502, lat: 38.5252 };
const stations = [fti, medgorodok, vahdatSensor, hisorSensor];

const codes = (list: { code: string }[]) => list.map((s) => s.code).sort();

describe("stationsOfCity", () => {
  it("датчик на окраине Душанбе в радиусе Вахдата относится только к Душанбе", () => {
    expect(distanceKm(vahdat, fti)).toBeLessThan(CITY_RADIUS_KM); // ≈ 14 км — без правила попадал бы в Вахдат
    expect(codes(stationsOfCity(vahdat, stations, cities))).toEqual(["VAH001_ECO"]);
    expect(codes(stationsOfCity(dushanbe, stations, cities))).toEqual(["DYU012_ECO", "DYU01_ECO"]);
    expect(codes(stationsOfCity(hisor, stations, cities))).toEqual(["HIS003_ECO"]);
  });

  it("без списка городов — прежнее правило радиуса", () => {
    expect(codes(stationsOfCity(vahdat, stations))).toEqual(["DYU012_ECO", "VAH001_ECO"]);
  });

  it("станции дальше радиуса не относятся ни к одному городу", () => {
    const far = { code: "FAR", lon: 70.3667, lat: 39.0167 };
    expect(stationsOfCity(dushanbe, [far], cities)).toEqual([]);
  });
});
