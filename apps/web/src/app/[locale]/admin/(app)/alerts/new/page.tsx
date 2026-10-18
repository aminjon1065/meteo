import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RuleForm } from "@/components/admin/alerts/rule-form";
import { requireAdminSession } from "@/lib/session";
import { loadRuleFormOptions } from "../_data";
import { createRule } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewRulePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "alerts.manage");
  const [t, options] = await Promise.all([getTranslations("alerts"), loadRuleFormOptions()]);
  async function action(raw: unknown) {
    "use server";
    return createRule(locale, raw);
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("add")}</h1>
      <RuleForm options={options} action={action} />
    </>
  );
}
