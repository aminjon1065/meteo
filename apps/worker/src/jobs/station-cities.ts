import { ensureStationCities } from "@meteo/db";
import { db } from "../db";
import { logger } from "../logger";
import type { JobDefinition } from "./types";

/**
 * Города для станций: станция дальше CITY_RADIUS_KM от всех городов списка получает свой город
 * (точку прогноза в месте станции). Подстраховка для станций, заведённых не через админку
 * (импорт, правка в базе); прогноз для нового города подтянет ближайший smartmet-sync.
 */
export const stationCities: JobDefinition = {
  name: "station-cities",
  schedule: { every: 30 * 60_000 },
  async run() {
    const result = await ensureStationCities(db);
    if (result.created.length > 0) {
      logger.info(
        { created: result.created.map((c) => `${c.slug} (станция ${c.stationId})`) },
        "station cities created",
      );
    }
    return result;
  },
};
