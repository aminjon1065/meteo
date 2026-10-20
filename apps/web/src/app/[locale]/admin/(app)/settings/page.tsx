import {
  BRANDING_KEY,
  eq,
  getBranding,
  getDisplaySettings,
  getIntegrationStates,
  getSetting,
  getSettingRow,
  SMTP_TEST_KEY,
  type SmtpTestState,
} from "@meteo/db";
import { emailOutbox, users } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { BrandingForm } from "@/components/admin/settings/branding-form";
import { DisplayForm } from "@/components/admin/settings/display-form";
import { SmtpTestForm } from "@/components/admin/settings/smtp-test-form";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { readIntegrationEnv } from "@/lib/settings";
import { saveBranding, saveDisplaySettings, sendTestEmail } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale, "settings.write");
  const db = getDb();
  const [t, format, branding, brandingRow, smtpTest, states, display] = await Promise.all([
    getTranslations("settingsAdmin"),
    getFormatter(),
    getBranding(db),
    getSettingRow<unknown>(db, BRANDING_KEY),
    getSetting<SmtpTestState>(db, SMTP_TEST_KEY),
    getIntegrationStates(db),
    getDisplaySettings(db),
  ]);
  const [updatedBy, testRow] = await Promise.all([
    brandingRow?.updatedBy
      ? db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, brandingRow.updatedBy))
          .then((r) => r[0]?.email ?? null)
      : Promise.resolve(null),
    smtpTest
      ? db
          .select({
            status: emailOutbox.status,
            attempts: emailOutbox.attempts,
            lastError: emailOutbox.lastError,
            sentAt: emailOutbox.sentAt,
          })
          .from(emailOutbox)
          .where(eq(emailOutbox.id, smtpTest.outboxId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const env = readIntegrationEnv();
  const dt = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  const envRows: Array<{ group: string; variable: string; value: string | null; hint?: string }> = [
    {
      group: t("integrations.smartmet"),
      variable: "SMARTMET_URL",
      value: env.smartmet.url ?? states.smartmet.source ?? null,
      hint: env.smartmet.url
        ? undefined
        : states.smartmet.source
          ? t("integrations.fromWorker")
          : undefined,
    },
    {
      group: t("integrations.smartmet"),
      variable: "SMARTMET_PRODUCER",
      value: env.smartmet.producer,
    },
    {
      group: t("integrations.smartmet"),
      variable: "SMARTMET_API_KEY",
      value: env.smartmet.apiKey ? t("integrations.apiKeySet") : null,
    },
    {
      group: t("integrations.silam"),
      variable: "SILAM_NCSS_URL",
      value:
        env.silam.url ?? (states.silam.source ? states.silam.source.replace(/[^/]*$/, "") : null),
      hint: env.silam.url
        ? undefined
        : states.silam.source
          ? t("integrations.fromWorker")
          : undefined,
    },
    {
      group: t("integrations.silam"),
      variable: "SILAM_DATASET",
      value:
        env.silam.dataset ??
        (states.silam.source ? (states.silam.source.split("/").pop() ?? null) : null),
    },
    { group: t("integrations.silam"), variable: "SILAM_KEEP_RUNS", value: env.silam.keepRuns },
    {
      group: t("integrations.cap"),
      variable: "CAP_FEED_URL",
      value: env.cap.url ?? states.cap.source ?? null,
      hint: env.cap.url ? undefined : states.cap.source ? t("integrations.fromWorker") : undefined,
    },
    { group: t("integrations.cap"), variable: "CAP_TIMEOUT_MS", value: env.cap.timeoutMs },
    { group: t("integrations.portal"), variable: "NEXT_PUBLIC_APP_URL", value: env.publicUrl },
    { group: t("integrations.portal"), variable: "UPLOADS_DIR", value: env.uploadsDir },
  ];

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("smtp.title")}</CardTitle>
            <CardDescription>{t("smtp.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <dl className="grid gap-1">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">SMTP:</dt>
                <dd>
                  {env.smtp.configured
                    ? t("smtp.configured", { host: env.smtp.host ?? "" })
                    : t("smtp.dev")}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">MAIL_FROM:</dt>
                <dd>{env.smtp.from ?? t("integrations.notSet")}</dd>
              </div>
            </dl>
            <SmtpTestForm
              defaultTo={session.user.email}
              action={sendTestEmail.bind(null, locale)}
              last={
                smtpTest
                  ? {
                      to: smtpTest.to,
                      at: dt(new Date(smtpTest.at)),
                      by: smtpTest.by,
                      status: testRow?.status ?? "pending",
                      attempts: testRow?.attempts ?? 0,
                      error: testRow?.lastError ?? null,
                      sentAt: testRow?.sentAt ? dt(testRow.sentAt) : null,
                    }
                  : null
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("integrations.title")}</CardTitle>
            <CardDescription>{t("integrations.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("integrations.title")}</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="px-6 py-2 font-medium sm:px-2">
                    {t("integrations.variable")}
                  </th>
                  <th scope="col" className="px-6 py-2 font-medium sm:px-2">
                    {t("integrations.value")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {envRows.map((row, i) => {
                  const first = i === 0 || envRows[i - 1]?.group !== row.group;
                  return (
                    <tr key={row.variable} className="border-b last:border-b-0">
                      <td className="px-6 py-2 align-top sm:px-2">
                        {first ? (
                          <span className="block text-xs text-muted-foreground">{row.group}</span>
                        ) : null}
                        <code className="font-mono text-xs">{row.variable}</code>
                      </td>
                      <td className="break-all px-6 py-2 align-top sm:px-2">
                        {row.value ?? (
                          <span className="text-muted-foreground">{t("integrations.notSet")}</span>
                        )}
                        {row.hint ? (
                          <span className="block text-xs text-muted-foreground">{row.hint}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("display.title")}</CardTitle>
          <CardDescription>{t("display.hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DisplayForm initial={display} action={saveDisplaySettings.bind(null, locale)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("branding.title")}</CardTitle>
          <CardDescription>
            {t("branding.hint")}
            {brandingRow
              ? ` ${t("branding.updatedAt", { time: dt(brandingRow.updatedAt), by: updatedBy ?? "—" })}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingForm initial={branding} action={saveBranding.bind(null, locale)} />
        </CardContent>
      </Card>
    </>
  );
}
