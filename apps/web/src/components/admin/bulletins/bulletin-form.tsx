"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type I18nText, type Locale, locales, pick } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@meteo/ui/components/tabs";
import { Textarea } from "@meteo/ui/components/textarea";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { type FieldPath, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { BulletinResult } from "@/app/[locale]/admin/(app)/bulletins/actions";
import { MarkdownPreview } from "@/components/admin/markdown-preview";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";
import { type BulletinInput, type BulletinValues, bulletinInput } from "@/lib/validation/news";

export interface BulletinFormProps {
  posts: Array<{ id: number; title: I18nText }>;
  initial?: Partial<BulletinInput> & { id?: number };
  action: (raw: BulletinInput) => Promise<BulletinResult>;
}

const emptyText = { tg: "", ru: "", en: "" };

export function BulletinForm({ posts, initial, action }: BulletinFormProps) {
  const t = useTranslations("bulletins");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [langTab, setLangTab] = useState<Locale>(locale);
  const form = useForm<BulletinInput, unknown, BulletinValues>({
    resolver: zodResolver(bulletinInput),
    defaultValues: {
      subject: { ...emptyText },
      body: { ...emptyText },
      postId: "" as unknown as number,
      ...initial,
    },
  });
  const { register, handleSubmit, setError, watch, formState } = form;

  function errorText(path: string): string | undefined {
    const err = path
      .split(".")
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
        formState.errors,
      );
    const message = (err as { message?: string } | undefined)?.message;
    return message ? translateOr(t, `errors.${message}`, message) : undefined;
  }

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await action(values as unknown as BulletinInput);
      if (!result.ok) {
        for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
          setError(path as FieldPath<BulletinInput>, { message: messages[0] });
        }
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      toast.success(t("saved"));
      router.push(`/admin/bulletins/${result.id}`);
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[2fr_1fr]" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{t("fields.body")}</CardTitle>
          <CardDescription>{t("hints.subject")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={langTab} onValueChange={(v) => setLangTab(v as Locale)}>
            <TabsList>
              {locales.map((l) => (
                <TabsTrigger key={l} value={l}>
                  {l.toUpperCase()}
                </TabsTrigger>
              ))}
            </TabsList>
            {locales.map((l) => (
              <TabsContent key={l} value={l} className="grid gap-4 pt-2">
                <Field>
                  <FieldLabel htmlFor={`subject-${l}`}>{t("fields.subject")}</FieldLabel>
                  <Input
                    id={`subject-${l}`}
                    lang={l}
                    {...register(`subject.${l}`)}
                    aria-invalid={l === "tg" && Boolean(errorText("subject.tg"))}
                  />
                  {l === "tg" && errorText("subject.tg") ? (
                    <FieldError>{errorText("subject.tg")}</FieldError>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor={`body-${l}`}>{t("fields.body")}</FieldLabel>
                  <Tabs defaultValue="editor">
                    <TabsList variant="line">
                      <TabsTrigger value="editor">{t("editor")}</TabsTrigger>
                      <TabsTrigger value="preview">{t("preview")}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="editor">
                      <Textarea
                        id={`body-${l}`}
                        lang={l}
                        rows={16}
                        className="font-mono text-sm"
                        {...register(`body.${l}`)}
                        aria-invalid={l === "tg" && Boolean(errorText("body.tg"))}
                      />
                    </TabsContent>
                    <TabsContent value="preview">
                      <MarkdownPreview markdown={watch(`body.${l}`) ?? ""} />
                    </TabsContent>
                  </Tabs>
                  <FieldDescription>{t("hints.body")}</FieldDescription>
                  {l === "tg" && errorText("body.tg") ? (
                    <FieldError>{errorText("body.tg")}</FieldError>
                  ) : null}
                </Field>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("fields.post")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor="postId">{t("fields.post")}</FieldLabel>
              <NativeSelect id="postId" {...register("postId")}>
                <NativeSelectOption value="">{t("noPost")}</NativeSelectOption>
                {posts.map((p) => (
                  <NativeSelectOption key={p.id} value={String(p.id)}>
                    {pick(p.title, locale)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending} className="flex-1">
            {pending ? <Spinner /> : null}
            {tc("actions.save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/admin/bulletins")}>
            {tc("actions.cancel")}
          </Button>
        </div>
      </div>
    </form>
  );
}
