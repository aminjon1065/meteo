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
    expect(ru.text).toContain("Канал: забор данных (SFTP/FTP/HTTP/JSON API)");
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

describe("renderEmail ecoBulletinDraft", () => {
  const item = {
    bulletinId: 7,
    station: { tg: "Душанбе — марказ", ru: "Душанбе — центр", en: "Dushanbe centre" },
    code: "DU-01",
    hasData: true,
    exceedances: {
      tg: "дуоксиди нитроген (NO2), зарачаҳои 10 мкр. (РМ-10)",
      ru: "диоксида азота (NO2), частиц 10 мкр. (РМ-10)",
    },
    url: {
      tg: "https://portal.meteo.tj/admin/eco-bulletins/7",
      ru: "https://portal.meteo.tj/ru/admin/eco-bulletins/7",
      en: "https://portal.meteo.tj/en/admin/eco-bulletins/7",
    },
  };
  const digest = {
    date: "2026-10-19",
    items: [item, { ...item, bulletinId: 8, code: "KT-01", hasData: false }],
    journalUrl: "https://portal.meteo.tj/ru/admin/eco-bulletins",
  };

  it("письмо‑дайджест о готовых черновиках на трёх языках", () => {
    for (const locale of ["ru", "en", "tg"] as const) {
      const mail = renderEmail("ecoBulletinDraft", locale, digest);
      expect(mail.subject).toContain("2026-10-19");
      expect(mail.subject).toContain("2");
      expect(mail.text).toContain("DU-01");
      expect(mail.text).toContain("KT-01");
      expect(mail.html).toContain("https://portal.meteo.tj/ru/admin/eco-bulletins");
      expect(mail.html).not.toContain("{date}");
    }
    const ru = renderEmail("ecoBulletinDraft", "ru", digest);
    expect(ru.subject).toBe("Черновики экобюллетеня за 2026-10-19 готовы: 2");
    expect(ru.text).toContain("превышения ПДК — диоксида азота (NO2), частиц 10 мкр. (РМ-10)");
    expect(ru.text).toContain("нет валидных измерений за сутки");
    expect(ru.html).toContain("https://portal.meteo.tj/ru/admin/eco-bulletins/7");
    const tg = renderEmail("ecoBulletinDraft", "tg", digest);
    expect(tg.text).toContain("дуоксиди нитроген (NO2)");
  });

  it("без превышений — отдельная фраза", () => {
    const clean = renderEmail("ecoBulletinDraft", "ru", {
      ...digest,
      items: [{ ...item, exceedances: { tg: "", ru: "" } }],
    });
    expect(clean.text).toContain("превышений ПДК нет");
  });
});
