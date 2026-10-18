import { describe, expect, it } from "vitest";
import { renderEmail } from "../mail/templates";

const payload = {
  kind: "stale",
  stationId: 1,
  stationName: { tg: "Душанбе — марказ", ru: "Душанбе — центр", en: "Dushanbe centre" },
  code: "DU-01",
  channel: "pull",
  since: "2026-10-18T01:00:00Z",
  at: "2026-10-18T05:00:00Z",
  minutes: 180,
  error: "HTTP 503 для https://vendor.example/export.csv",
  stationUrl: "https://portal.meteo.tj/admin/stations/1",
};

describe("renderEmail stationData", () => {
  it("письмо о длительном отсутствии данных на трёх языках", () => {
    for (const locale of ["ru", "en", "tg"] as const) {
      const mail = renderEmail("stationData", locale, payload);
      expect(mail.subject).toContain("180");
      expect(mail.text).toContain("DU-01");
      expect(mail.text).toContain("HTTP 503");
      expect(mail.html).toContain("https://portal.meteo.tj/admin/stations/1");
      expect(mail.html).not.toContain("{station}");
    }
    const ru = renderEmail("stationData", "ru", payload);
    expect(ru.subject).toBe("Нет данных со станции Душанбе — центр дольше 180 мин");
    expect(ru.text).toContain("Канал: забор файлов (SFTP/FTP/HTTP)");
  });
  it("письмо о восстановлении без последней ошибки", () => {
    const mail = renderEmail("stationData", "en", {
      ...payload,
      kind: "recovered",
      channel: "api",
    });
    expect(mail.subject).toBe("Data from station Dushanbe centre is arriving again");
    expect(mail.text).not.toContain("Last source error");
    expect(mail.text).toContain("Dushanbe centre");
  });
});
