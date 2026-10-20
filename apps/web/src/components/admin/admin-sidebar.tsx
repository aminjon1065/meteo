"use client";

import { can, type Permission } from "@meteo/core";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@meteo/ui/components/sidebar";
import {
  BellRing,
  ClipboardList,
  Database,
  FileText,
  Gauge,
  HeartPulse,
  Image,
  type LucideIcon,
  MailCheck,
  Newspaper,
  Radio,
  ScrollText,
  Send,
  Settings,
  Siren,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/site/logo";
import { Link, usePathname } from "@/i18n/navigation";

interface Item {
  href: string;
  key:
    | "dashboard"
    | "stations"
    | "measurements"
    | "scales"
    | "healthAdvice"
    | "alerts"
    | "cap"
    | "news"
    | "media"
    | "bulletins"
    | "ecoBulletins"
    | "users"
    | "subscribers"
    | "auditLog"
    | "settings";
  icon: LucideIcon;
  permission: Permission;
  ready?: boolean;
}

const groups: Array<{ key: "content" | "measurements" | "settings" | null; items: Item[] }> = [
  {
    key: null,
    items: [
      { href: "/admin", key: "dashboard", icon: Gauge, permission: "admin.access", ready: true },
    ],
  },
  {
    key: "measurements",
    items: [
      {
        href: "/admin/stations",
        key: "stations",
        icon: Radio,
        permission: "stations.read",
        ready: true,
      },
      {
        href: "/admin/measurements",
        key: "measurements",
        icon: Database,
        permission: "measurements.read",
        ready: true,
      },
      {
        href: "/admin/scales",
        key: "scales",
        icon: SlidersHorizontal,
        permission: "scales.write",
        ready: true,
      },
      {
        href: "/admin/health-advice",
        key: "healthAdvice",
        icon: HeartPulse,
        permission: "healthAdvice.write",
        ready: true,
      },
      {
        href: "/admin/alerts",
        key: "alerts",
        icon: BellRing,
        permission: "alerts.manage",
        ready: true,
      },
      { href: "/admin/cap", key: "cap", icon: Siren, permission: "alerts.manage", ready: true },
    ],
  },
  {
    key: "content",
    items: [
      {
        href: "/admin/news",
        key: "news",
        icon: Newspaper,
        permission: "content.read",
        ready: true,
      },
      { href: "/admin/media", key: "media", icon: Image, permission: "content.write", ready: true },
      {
        href: "/admin/bulletins",
        key: "bulletins",
        icon: Send,
        permission: "content.publish",
        ready: true,
      },
      {
        href: "/admin/eco-bulletins",
        key: "ecoBulletins",
        icon: ClipboardList,
        permission: "ecoBulletin.read",
        ready: true,
      },
    ],
  },
  {
    key: "settings",
    items: [
      {
        href: "/admin/users",
        key: "users",
        icon: Users,
        permission: "users.manage",
        ready: true,
      },
      {
        href: "/admin/subscribers",
        key: "subscribers",
        icon: MailCheck,
        permission: "subscribers.manage",
        ready: true,
      },
      {
        href: "/admin/audit",
        key: "auditLog",
        icon: ScrollText,
        permission: "audit.read",
        ready: true,
      },
      {
        href: "/admin/settings",
        key: "settings",
        icon: Settings,
        permission: "settings.write",
        ready: true,
      },
    ],
  },
];

export function AdminSidebar({ role }: { role: string }) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" aria-label={t("title")}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/admin" />}>
              <Logo className="size-8" />
              <div className="flex flex-col leading-tight">
                <span className="font-heading font-bold">{tc("siteName")}</span>
                <span className="text-xs text-muted-foreground">{t("title")}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          const visible = group.items.filter((item) => can(role, item.permission));
          if (visible.length === 0) return null;
          return (
            <SidebarGroup key={group.key ?? "main"}>
              {group.key ? <SidebarGroupLabel>{t(group.key)}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {visible.map((item) => {
                    const active =
                      item.href === "/admin"
                        ? pathname === "/admin"
                        : pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.href}>
                        {item.ready ? (
                          <SidebarMenuButton
                            isActive={active}
                            tooltip={t(item.key)}
                            render={<Link href={item.href} />}
                          >
                            <Icon aria-hidden="true" />
                            <span>{t(item.key)}</span>
                          </SidebarMenuButton>
                        ) : (
                          <SidebarMenuButton
                            tooltip={t(item.key)}
                            aria-disabled="true"
                            className="opacity-60"
                          >
                            <Icon aria-hidden="true" />
                            <span>{t(item.key)}</span>
                          </SidebarMenuButton>
                        )}
                        {!item.ready ? <SidebarMenuBadge>…</SidebarMenuBadge> : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/" />} tooltip={tc("siteName")}>
              <FileText aria-hidden="true" />
              <span>{tc("siteName")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
