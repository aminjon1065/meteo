"use client";

import { roles } from "@meteo/core";
import { type Locale, localeNames, locales } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@meteo/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { CopyIcon, PlusIcon, WandSparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import type { UserActionResult } from "@/app/[locale]/admin/(app)/users/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

/** Случайный пароль из 16 символов без похожих букв (O/0, l/1). */
export function generatePassword(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function CreateUserDialog({
  action,
  defaultLocale,
}: {
  action: (raw: unknown) => Promise<UserActionResult>;
  defaultLocale: Locale;
}) {
  const t = useTranslations("usersAdmin");
  const tr = useTranslations("roles");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [password, setPassword] = useState(() => generatePassword());
  const err = (key: string) => {
    const code = errors[key]?.[0];
    return code ? translateOr(t, `errors.${code}`, code) : undefined;
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password,
      role: String(form.get("role") ?? "editor"),
      locale: String(form.get("locale") ?? defaultLocale),
    };
    setErrors({});
    startTransition(async () => {
      const result = await action(raw);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      toast.success(t("created"));
      setOpen(false);
      setPassword(generatePassword());
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon aria-hidden="true" />
        {t("create")}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("create")}</DialogTitle>
            <DialogDescription>{t("createHint")}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={err("name") ? true : undefined}>
            <FieldLabel htmlFor="nu-name">{t("name")}</FieldLabel>
            <Input
              id="nu-name"
              name="name"
              required
              autoComplete="off"
              aria-invalid={err("name") ? true : undefined}
            />
            {err("name") ? <FieldError>{err("name")}</FieldError> : null}
          </Field>
          <Field data-invalid={err("email") ? true : undefined}>
            <FieldLabel htmlFor="nu-email">{t("email")}</FieldLabel>
            <Input
              id="nu-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              aria-invalid={err("email") ? true : undefined}
            />
            {err("email") ? <FieldError>{err("email")}</FieldError> : null}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="nu-role">{t("role")}</FieldLabel>
              <NativeSelect id="nu-role" name="role" defaultValue="editor">
                {roles.map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {tr(r)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="nu-locale">{t("locale")}</FieldLabel>
              <NativeSelect id="nu-locale" name="locale" defaultValue={defaultLocale}>
                {locales.map((l) => (
                  <NativeSelectOption key={l} value={l}>
                    {localeNames[l]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field data-invalid={err("password") ? true : undefined}>
            <FieldLabel htmlFor="nu-password">{t("password")}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="nu-password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="font-mono"
                aria-invalid={err("password") ? true : undefined}
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
            {err("password") ? <FieldError>{err("password")}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {tc("actions.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
