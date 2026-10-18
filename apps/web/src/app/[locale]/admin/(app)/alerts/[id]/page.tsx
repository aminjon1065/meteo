import { eq } from "@meteo/db";
import { alertRules } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { RuleForm } from "@/components/admin/alerts/rule-form";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { loadRuleFormOptions } from "../_data";
import { deleteRule, updateRule } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditRulePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id: rawId } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  await requireAdminSession(locale, "alerts.manage");
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const rule = await getDb().query.alertRules.findFirst({ where: eq(alertRules.id, id) });
  if (!rule) notFound();
  const options = await loadRuleFormOptions();
  async function action(raw: unknown) {
    "use server";
    return updateRule(locale, id, raw);
  }
  async function remove() {
    "use server";
    return deleteRule(locale, id);
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{rule.name}</h1>
      <RuleForm
        options={options}
        initial={{
          name: rule.name,
          scope: rule.scope,
          stationId: rule.stationId ? String(rule.stationId) : "",
          regionId: rule.regionId ? String(rule.regionId) : "",
          kind: rule.kind,
          pollutantId: rule.pollutantId ? String(rule.pollutantId) : "",
          scaleId: rule.scaleId ? String(rule.scaleId) : "",
          threshold: String(rule.threshold),
          averagingMin: String(rule.averagingMin),
          cooldownMin: String(rule.cooldownMin),
          channels: rule.channels,
          enabled: rule.enabled,
        }}
        action={action}
        onDelete={remove}
      />
    </>
  );
}
