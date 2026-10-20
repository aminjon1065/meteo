import { Button } from "@meteo/ui/components/button";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <main className="container-page flex min-h-dvh flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="num font-heading text-display text-muted-foreground">404</p>
      <h1 className="text-h2">{t("title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("description")}</p>
      <Button render={<Link href="/" />} nativeButton={false}>
        {t("backHome")}
      </Button>
    </main>
  );
}
