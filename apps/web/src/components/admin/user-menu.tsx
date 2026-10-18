"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@meteo/ui/components/avatar";
import { Button } from "@meteo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@meteo/ui/components/dropdown-menu";
import { LogOutIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";

export interface UserMenuProps {
  user: {
    name: string;
    email: string;
    role: string;
    image: string | null;
    twoFactorEnabled?: boolean;
  };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserMenu({ user }: UserMenuProps) {
  const t = useTranslations("auth");
  const tr = useTranslations("roles");
  const router = useRouter();
  const roleLabel = (["admin", "operator", "editor"] as const).includes(user.role as "admin")
    ? tr(user.role as "admin" | "operator" | "editor")
    : user.role;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={`${user.name} (${roleLabel})`}
          />
        }
      >
        <Avatar className="size-8">
          {user.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback>{initials(user.name) || "?"}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{user.name}</span>
            <span className="text-xs text-muted-foreground">{user.email}</span>
            <span className="text-xs text-muted-foreground">{roleLabel}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/admin/two-factor" />}>
          {user.twoFactorEnabled ? (
            <ShieldCheckIcon aria-hidden="true" />
          ) : (
            <ShieldIcon aria-hidden="true" />
          )}
          {t("twoFactorSetup")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            router.push("/admin/login");
            router.refresh();
          }}
        >
          <LogOutIcon aria-hidden="true" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
