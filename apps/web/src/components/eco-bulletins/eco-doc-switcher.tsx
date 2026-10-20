import type { BulletinLang, EcoDocKind } from "@meteo/core";
import { Button } from "@meteo/ui/components/button";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

const KINDS: readonly EcoDocKind[] = ["city", "summary", "form4a"];
const LANGS: readonly BulletinLang[] = ["tg", "ru"];

/** Переключатель документа (бюллетень города / сводка / форма 4а) и языка через query‑параметры. */
export async function EcoDocSwitcher({
  basePath,
  kind,
  lang,
}: {
  basePath: string;
  kind: EcoDocKind;
  lang: BulletinLang;
}) {
  const t = await getTranslations("ecoBulletin");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="eco-doc-switcher">
      <fieldset className="flex flex-wrap gap-1" aria-label={t("preview")}>
        {KINDS.map((k) => (
          <Button
            key={k}
            size="sm"
            variant={k === kind ? "default" : "outline"}
            render={<Link href={`${basePath}?doc=${k}&lang=${lang}`} />}
            nativeButton={false}
            aria-current={k === kind ? "page" : undefined}
          >
            {t(`docs.${k}`)}
          </Button>
        ))}
      </fieldset>
      <fieldset className="ml-auto flex gap-1" aria-label={`${t("lang.tg")} / ${t("lang.ru")}`}>
        {LANGS.map((l) => (
          <Button
            key={l}
            size="sm"
            variant={l === lang ? "secondary" : "ghost"}
            render={<Link href={`${basePath}?doc=${kind}&lang=${l}`} />}
            nativeButton={false}
            aria-current={l === lang ? "true" : undefined}
          >
            {t(`lang.${l}`)}
          </Button>
        ))}
      </fieldset>
    </div>
  );
}
