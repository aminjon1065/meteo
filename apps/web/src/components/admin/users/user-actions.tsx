"use client";

import { roles } from "@meteo/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@meteo/ui/components/alert-dialog";
import { Button } from "@meteo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@meteo/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@meteo/ui/components/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import {
  BanIcon,
  CopyIcon,
  KeyRoundIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  ShieldOffIcon,
  Trash2Icon,
  UserCogIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { UserActionResult } from "@/app/[locale]/admin/(app)/users/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";
import { generatePassword } from "./create-user-dialog";

export interface UserActionsProps {
  user: {
    id: string;
    email: string;
    role: string;
    banned: boolean;
    twoFactorEnabled: boolean;
    isSelf: boolean;
  };
  actions: {
    setRole: (role: string) => Promise<UserActionResult>;
    setPassword: (password: string) => Promise<UserActionResult>;
    ban: (reason: string, days: number | null) => Promise<UserActionResult>;
    unban: () => Promise<UserActionResult>;
    revokeSessions: () => Promise<UserActionResult>;
    resetTwoFactor: () => Promise<UserActionResult>;
    remove: () => Promise<UserActionResult>;
  };
}

type DialogKind = "role" | "password" | "ban" | "revoke" | "reset2fa" | "delete" | null;

/** Меню действий над пользователем: роль, пароль, блокировка, сессии, 2FA, удаление. */
export function UserActions({ user, actions }: UserActionsProps) {
  const t = useTranslations("usersAdmin");
  const tr = useTranslations("roles");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [role, setRole] = useState(user.role);
  const [password, setPassword] = useState(() => generatePassword());
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");

  function run(fn: () => Promise<UserActionResult>, successKey: "saved" | "created" = "saved") {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(translateOr(t, `errors.${r.message}`, r.message));
        return;
      }
      toast.success(t(successKey));
      setDialog(null);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`${t("actions")}: ${user.email}`} />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem disabled={user.isSelf} onClick={() => setDialog("role")}>
            <UserCogIcon aria-hidden="true" />
            {t("changeRole")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setPassword(generatePassword());
              setDialog("password");
            }}
          >
            <KeyRoundIcon aria-hidden="true" />
            {t("resetPassword")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("revoke")}>
            <LogOutIcon aria-hidden="true" />
            {t("revokeSessions")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!user.twoFactorEnabled} onClick={() => setDialog("reset2fa")}>
            <ShieldOffIcon aria-hidden="true" />
            {t("resetTwoFactor")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.banned ? (
            <DropdownMenuItem onClick={() => run(actions.unban)}>
              <BanIcon aria-hidden="true" />
              {t("unblock")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={user.isSelf} onClick={() => setDialog("ban")}>
              <BanIcon aria-hidden="true" />
              {t("block")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            disabled={user.isSelf}
            onClick={() => setDialog("delete")}
          >
            <Trash2Icon aria-hidden="true" />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === "role"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("changeRole")}</DialogTitle>
            <DialogDescription>{t("changeRoleHint")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`role-${user.id}`}>{t("role")}</FieldLabel>
            <NativeSelect
              id={`role-${user.id}`}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {roles.map((r) => (
                <NativeSelectOption key={r} value={r}>
                  {tr(r)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              disabled={pending || role === user.role}
              onClick={() => run(() => actions.setRole(role))}
            >
              {pending ? <Spinner /> : null}
              {tc("actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "password"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resetPassword")}</DialogTitle>
            <DialogDescription>{t("resetPasswordHint")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`pw-${user.id}`}>{t("newPassword")}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id={`pw-${user.id}`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("generate")}
                onClick={() => setPassword(generatePassword())}
              >
                <WandSparklesIcon aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("copyPassword")}
                onClick={async () => {
                  await navigator.clipboard.writeText(password);
                  toast.success(t("copied"));
                }}
              >
                <CopyIcon aria-hidden="true" />
              </Button>
            </div>
            <FieldDescription>{t("passwordHint")}</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button disabled={pending} onClick={() => run(() => actions.setPassword(password))}>
              {pending ? <Spinner /> : null}
              {tc("actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "ban"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("block")}</DialogTitle>
            <DialogDescription>{t("blockHint", { email: user.email })}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`reason-${user.id}`}>{t("blockReason")}</FieldLabel>
            <Input
              id={`reason-${user.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`days-${user.id}`}>{t("blockDays")}</FieldLabel>
            <Input
              id={`days-${user.id}`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {tc("actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => run(() => actions.ban(reason, days ? Number(days) : null))}
            >
              {pending ? <Spinner /> : null}
              {t("block")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialog === "revoke"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revokeSessions")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("revokeSessionsHint", { email: user.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(actions.revokeSessions)}>
              {t("revokeSessions")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === "reset2fa"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("resetTwoFactor")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("resetTwoFactorHint", { email: user.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(actions.resetTwoFactor)}>
              {t("resetTwoFactor")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirm", { email: user.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(actions.remove)}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
