import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "../env";

const base = { DATABASE_URL: "postgres://meteo:meteo@localhost:5432/meteo" };

describe("parseWorkerEnv", () => {
  it("пустые значения переменных считаются незаданными (compose передаёт `VAR=`)", () => {
    const env = parseWorkerEnv(
      {
        ...base,
        CAP_FEED_URL: "",
        SMTP_URL: "",
        SILAM_DIR: "",
        PUBLIC_URL: "",
        NEXT_PUBLIC_APP_URL: "https://portal.meteo.tj",
        SMARTMET_URL: "",
        STATION_PULL_MAX_FILE_MB: "",
      },
      "/app",
    );
    expect(env.CAP_FEED_URL).toBeUndefined();
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.SILAM_DIR).toBe("/data/silam");
    expect(env.PUBLIC_URL).toBe("https://portal.meteo.tj");
    expect(env.SMARTMET_URL).toBe("https://opendata.fmi.fi");
    expect(env.SMARTMET_PRODUCER).toBe("ecmwf");
    expect(env.STATION_PULL_MAX_FILE_MB).toBe(20);
  });
  it("некорректный CAP_FEED_URL по-прежнему отклоняется", () => {
    expect(() => parseWorkerEnv({ ...base, CAP_FEED_URL: "ftp://x" })).toThrow(/CAP_FEED_URL/);
  });
});
