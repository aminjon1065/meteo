"use client";

import { Button } from "@meteo/ui/components/button";
import { LogOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({
  variant = "default",
}: {
  variant?: "default" | "ghost" | "outline";
}) {
  const t = useTranslations("auth");
  const router = useRouter();
  return (
    <Button
      variant={variant}
      onClick={async () => {
        await authClient.signOut();
        router.push("/admin/login");
        router.refresh();
      }}
    >
      <LogOutIcon aria-hidden="true" />
      {t("signOut")}
    </Button>
  );
}
