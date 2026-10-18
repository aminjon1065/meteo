import type { Locale } from "@meteo/i18n";
import { Separator } from "@meteo/ui/components/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@meteo/ui/components/sidebar";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { UserMenu } from "@/components/admin/user-menu";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { enforceAdminTwoFactor, requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale);
  await enforceAdminTwoFactor(session, locale);
  const t = await getTranslations("admin");

  return (
    <SidebarProvider>
      <AdminSidebar role={session.user.role ?? "editor"} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">{t("title")}</span>
          <div className="ml-auto flex items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
            <UserMenu
              user={{
                name: session.user.name,
                email: session.user.email,
                role: session.user.role ?? "editor",
                image: session.user.image ?? null,
                twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
              }}
            />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
