import { markdownToText, renderMarkdown } from "@meteo/core";
import { type I18nText, type Locale, pick } from "@meteo/i18n";
import en from "@meteo/i18n/messages/en.json";
import ru from "@meteo/i18n/messages/ru.json";
import tg from "@meteo/i18n/messages/tg.json";

const messages = { tg, ru, en } as const;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function t(locale: Locale, key: string, vars: Record<string, string | number> = {}): string {
  const dict = (messages[locale] ?? messages.tg).email as Record<string, unknown>;
  const raw = key
    .split(".")
    .reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined,
      dict,
    );
  const str = typeof raw === "string" ? raw : key;
  return str.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function layout(locale: Locale, title: string, bodyHtml: string, footerHtml: string): string {
  return `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f6f8fb;font-family:Inter,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #d9e1ec"><tr><td style="padding:28px">
<p style="margin:0 0 6px;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(t(locale, "common.brand"))}</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>
${bodyHtml}
<hr style="border:none;border-top:1px solid #d9e1ec;margin:24px 0">
<p style="margin:0;font-size:12px;color:#475569">${footerHtml}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#0e5ea8;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a></p>`;
}

export function renderEmail(
  template: string,
  localeRaw: string,
  payload: Record<string, unknown>,
): RenderedEmail {
  const locale = (["tg", "ru", "en"].includes(localeRaw) ? localeRaw : "tg") as Locale;
  switch (template) {
    case "confirm": {
      const confirmUrl = String(payload.confirmUrl ?? "");
      const subject = t(locale, "confirm.subject");
      const body = `<p>${escapeHtml(t(locale, "confirm.body"))}</p>${button(confirmUrl, t(locale, "confirm.button"))}<p style="font-size:13px;color:#475569">${escapeHtml(t(locale, "confirm.ignore"))}</p>`;
      const text = `${t(locale, "confirm.body")}\n\n${confirmUrl}\n\n${t(locale, "confirm.ignore")}`;
      return {
        subject,
        html: layout(locale, subject, body, escapeHtml(t(locale, "common.sentBy"))),
        text,
      };
    }
    case "alert": {
      const stationName =
        pick(payload.stationName as I18nText, locale) || String(payload.stationSlug ?? "");
      const pollutant = payload.pollutant as {
        shortName: string;
        unit: string;
        name?: I18nText;
      } | null;
      const value =
        typeof payload.value === "number" ? Math.round(payload.value * 10) / 10 : payload.value;
      const measure = pollutant
        ? `${pick(pollutant.name ?? {}, locale) || pollutant.shortName}: ${value} ${pollutant.unit}`
        : t(locale, "alert.levelValue", { level: String(payload.level ?? value) });
      const subject = t(locale, "alert.subject", { station: stationName });
      const bodyText = t(locale, "alert.body", {
        station: stationName,
        measure,
        threshold: String(payload.threshold ?? ""),
        rule: String(payload.ruleName ?? ""),
      });
      const stationUrl = String(payload.stationUrl ?? "");
      const unsubscribeUrl = String(payload.unsubscribeUrl ?? "");
      const body = `<p>${escapeHtml(bodyText)}</p>${button(stationUrl, t(locale, "alert.button"))}`;
      const footer = `${escapeHtml(t(locale, "common.sentBy"))} · <a href="${escapeHtml(unsubscribeUrl)}" style="color:#475569">${escapeHtml(t(locale, "common.unsubscribe"))}</a>`;
      const text = `${bodyText}\n\n${stationUrl}\n\n${t(locale, "common.unsubscribe")}: ${unsubscribeUrl}`;
      return { subject, html: layout(locale, subject, body, footer), text };
    }
    case "bulletin": {
      const subject = pick(payload.subject as I18nText, locale) || t(locale, "common.brand");
      const markdown = pick(payload.body as I18nText, locale);
      const baseUrl = String(payload.baseUrl ?? "").replace(/\/$/, "");
      // Относительные ссылки и картинки (/uploads/…) в письме должны быть абсолютными.
      const html = renderMarkdown(markdown).replace(
        /(href|src)="\/(?!\/)/g,
        (_, attr: string) => `${attr}="${baseUrl}/`,
      );
      const url = typeof payload.url === "string" ? payload.url : null;
      const unsubscribeUrl = String(payload.unsubscribeUrl ?? "");
      const body = `${html}${url ? button(url, t(locale, "bulletin.readOnSite")) : ""}`;
      const footer = `${escapeHtml(t(locale, "bulletin.footer"))} · <a href="${escapeHtml(unsubscribeUrl)}" style="color:#475569">${escapeHtml(t(locale, "common.unsubscribe"))}</a>`;
      const text = `${markdownToText(markdown)}${url ? `\n\n${t(locale, "bulletin.readOnSite")}: ${url}` : ""}\n\n${t(locale, "common.unsubscribe")}: ${unsubscribeUrl}`;
      return { subject, html: layout(locale, subject, body, footer), text };
    }
    case "integration": {
      const kind = payload.kind === "recovered" ? "recovered" : "failed";
      const integration = String(payload.integration ?? "");
      const name = t(locale, `integration.names.${integration}`);
      const fmt = (iso: unknown) =>
        typeof iso === "string" && !Number.isNaN(Date.parse(iso))
          ? new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "ru-RU", {
              timeZone: "Asia/Dushanbe",
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "—";
      const vars = {
        name,
        count: String(payload.failures ?? ""),
        since: fmt(payload.since),
        at: fmt(payload.at),
        error: String(payload.error ?? "—"),
        until: fmt(payload.circuitUntil),
      };
      const subject = t(locale, `integration.${kind}Subject`, vars);
      const lines = [
        t(locale, `integration.${kind}Body`, vars),
        kind === "failed" ? t(locale, "integration.lastError", vars) : "",
        kind === "failed" && payload.circuitUntil ? t(locale, "integration.paused", vars) : "",
      ].filter(Boolean);
      const dashboardUrl = String(payload.dashboardUrl ?? "");
      const body = `${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}${
        dashboardUrl ? button(dashboardUrl, t(locale, "integration.button")) : ""
      }`;
      const text = `${lines.join("\n\n")}${dashboardUrl ? `\n\n${dashboardUrl}` : ""}`;
      return {
        subject,
        html: layout(locale, subject, body, escapeHtml(t(locale, "common.sentBy"))),
        text,
      };
    }
    case "ecoBulletinDraft": {
      const lang = locale === "tg" ? "tg" : "ru";
      const date = String(payload.date ?? "");
      const items = Array.isArray(payload.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : [];
      const vars = { date, count: items.length };
      const subject = t(locale, "ecoBulletinDraft.subject", vars);
      const intro = t(locale, "ecoBulletinDraft.body", vars);
      const lines = items.map((item) => {
        const station = pick(item.station as I18nText, locale) || String(item.code ?? "");
        const exceedances = String(
          (item.exceedances as Record<string, string> | undefined)?.[lang] ?? "",
        ).trim();
        const status =
          item.hasData === false
            ? t(locale, "ecoBulletinDraft.noData")
            : exceedances
              ? t(locale, "ecoBulletinDraft.exceedances", { list: exceedances })
              : t(locale, "ecoBulletinDraft.none");
        const url = String((item.url as Record<string, string> | undefined)?.[locale] ?? "");
        return { text: `${station} (${String(item.code ?? "")}): ${status}`, url };
      });
      const journalUrl = String(payload.journalUrl ?? "");
      const list = lines
        .map(
          (l) =>
            `<li>${escapeHtml(l.text)}${l.url ? ` — <a href="${escapeHtml(l.url)}">${escapeHtml(t(locale, "ecoBulletinDraft.open"))}</a>` : ""}</li>`,
        )
        .join("");
      const body = `<p>${escapeHtml(intro)}</p><ul>${list}</ul>${journalUrl ? button(journalUrl, t(locale, "ecoBulletinDraft.button")) : ""}`;
      const text = `${intro}\n\n${lines.map((l) => `- ${l.text}${l.url ? `\n  ${l.url}` : ""}`).join("\n")}${journalUrl ? `\n\n${journalUrl}` : ""}`;
      return {
        subject,
        html: layout(locale, subject, body, escapeHtml(t(locale, "common.sentBy"))),
        text,
      };
    }
    case "stationData": {
      const kind = payload.kind === "recovered" ? "recovered" : "stale";
      const station = pick(payload.stationName as I18nText, locale) || String(payload.code ?? "");
      const fmt = (iso: unknown) =>
        typeof iso === "string" && !Number.isNaN(Date.parse(iso))
          ? new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "ru-RU", {
              timeZone: "Asia/Dushanbe",
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "—";
      const channel = t(
        locale,
        `stationData.channel.${payload.channel === "pull" ? "pull" : "api"}`,
      );
      const vars = {
        station,
        code: String(payload.code ?? ""),
        since: fmt(payload.since),
        at: fmt(payload.at),
        minutes: String(payload.minutes ?? ""),
        channel,
        error: String(payload.error ?? "—"),
      };
      const subject = t(locale, `stationData.${kind}Subject`, vars);
      const lines = [
        t(locale, `stationData.${kind}Body`, vars),
        kind === "stale" && payload.error ? t(locale, "stationData.lastError", vars) : "",
      ].filter(Boolean);
      const stationUrl = String(payload.stationUrl ?? "");
      const body = `${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}${
        stationUrl ? button(stationUrl, t(locale, "stationData.button")) : ""
      }`;
      const text = `${lines.join("\n\n")}${stationUrl ? `\n\n${stationUrl}` : ""}`;
      return {
        subject,
        html: layout(locale, subject, body, escapeHtml(t(locale, "common.sentBy"))),
        text,
      };
    }
    default: {
      const subject = t(locale, "test.subject");
      const details = [
        typeof payload.requestedBy === "string"
          ? t(locale, "test.requestedBy", { by: payload.requestedBy })
          : "",
        typeof payload.at === "string" ? t(locale, "test.sentAt", { at: payload.at }) : "",
      ].filter(Boolean);
      const body = `<p>${escapeHtml(t(locale, "test.body"))}</p>${details
        .map((d) => `<p style="font-size:13px;color:#475569">${escapeHtml(d)}</p>`)
        .join("")}`;
      return {
        subject,
        html: layout(locale, subject, body, escapeHtml(t(locale, "common.sentBy"))),
        text: [t(locale, "test.body"), ...details].join("\n"),
      };
    }
  }
}
