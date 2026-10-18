"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { slugify } from "@meteo/core";
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
import { Switch } from "@meteo/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@meteo/ui/components/tabs";
import { Textarea } from "@meteo/ui/components/textarea";
import { ImageIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Controller, type FieldPath, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { NewsResult } from "@/app/[locale]/admin/(app)/news/actions";
import { MarkdownPreview } from "@/components/admin/markdown-preview";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";
import { type NewsInput, type NewsValues, newsInput, newsStatuses } from "@/lib/validation/news";

export interface NewsFormProps {
  options: { categories: Array<{ id: number; name: I18nText }> };
  initial?: Partial<NewsInput> & { id?: number };
  initialCover?: { id: number; url: string } | null;
  action: (raw: NewsInput) => Promise<NewsResult>;
  canPublish: boolean;
}

const emptyText = { tg: "", ru: "", en: "" };

export function NewsForm({ options, initial, initialCover, action, canPublish }: NewsFormProps) {
  const t = useTranslations("newsAdmin");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [langTab, setLangTab] = useState<Locale>(locale);
  const [cover, setCover] = useState(initialCover ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm<NewsInput, unknown, NewsValues>({
    resolver: zodResolver(newsInput),
    defaultValues: {
      slug: "",
      title: { ...emptyText },
      excerpt: { ...emptyText },
      body: { ...emptyText },
      categoryId: "" as unknown as number,
      coverId: "" as unknown as number,
      status: "draft",
      publishedAt: "",
      pinned: false,
      ...initial,
    },
  });
  const { register, control, handleSubmit, setError, setValue, watch, formState } = form;

  function errorText(path: string): string | undefined {
    const err = path
      .split(".")
      .reduce<unknown>(
        (acc, key) =>
          acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
        formState.errors,
      );
    const message = (err as { message?: string } | undefined)?.message;
    if (!message) return undefined;
    return translateOr(t, `errors.${message}`, message);
  }

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await action(values as unknown as NewsInput);
      if (!result.ok) {
        for (const [path, messages] of Object.entries(result.fieldErrors ?? {})) {
          setError(path as FieldPath<NewsInput>, { message: messages[0] });
        }
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      toast.success(t("saved"));
      router.push(`/admin/news/${result.id}`);
      router.refresh();
    });
  });

  async function uploadCover(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/media", { method: "POST", body });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { id: number; url: string };
      setCover({ id: data.id, url: data.url });
      setValue("coverId", data.id, { shouldDirty: true });
    } catch {
      toast.error(t("cover.error"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[2fr_1fr]" noValidate>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("fields.body")}</CardTitle>
            <CardDescription>{t("hints.languages")}</CardDescription>
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
                    <FieldLabel htmlFor={`title-${l}`}>{t("fields.title")}</FieldLabel>
                    <Input
                      id={`title-${l}`}
                      lang={l}
                      {...register(`title.${l}`)}
                      aria-invalid={l === "tg" && Boolean(errorText("title.tg"))}
                    />
                    {l === "tg" && errorText("title.tg") ? (
                      <FieldError>{errorText("title.tg")}</FieldError>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`excerpt-${l}`}>{t("fields.excerpt")}</FieldLabel>
                    <Textarea id={`excerpt-${l}`} lang={l} rows={2} {...register(`excerpt.${l}`)} />
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
                          rows={18}
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
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("fields.status")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="status">{t("fields.status")}</FieldLabel>
              <NativeSelect id="status" {...register("status")}>
                {newsStatuses
                  .filter((s) => canPublish || s !== "published" || initial?.status === "published")
                  .map((s) => (
                    <NativeSelectOption key={s} value={s}>
                      {t(`status.${s}`)}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="publishedAt">{t("fields.publishedAt")}</FieldLabel>
              <Input
                id="publishedAt"
                type="datetime-local"
                {...register("publishedAt")}
                aria-invalid={Boolean(errorText("publishedAt"))}
              />
              <FieldDescription>{t("hints.publishedAt")}</FieldDescription>
              {errorText("publishedAt") ? (
                <FieldError>{errorText("publishedAt")}</FieldError>
              ) : null}
            </Field>
            <Controller
              control={control}
              name="pinned"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Switch
                    id="pinned"
                    checked={Boolean(field.value)}
                    onCheckedChange={(v) => field.onChange(v)}
                  />
                  <FieldLabel htmlFor="pinned">{t("fields.pinned")}</FieldLabel>
                </Field>
              )}
            />
            <Field>
              <FieldLabel htmlFor="categoryId">{t("fields.category")}</FieldLabel>
              <NativeSelect id="categoryId" {...register("categoryId")}>
                <NativeSelectOption value="">—</NativeSelectOption>
                {options.categories.map((c) => (
                  <NativeSelectOption key={c.id} value={String(c.id)}>
                    {pick(c.name, locale)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="slug">{t("fields.slug")}</FieldLabel>
              <Input
                id="slug"
                {...register("slug")}
                placeholder={slugify(pick(watch("title") as I18nText, "en") || "", 100)}
                aria-invalid={Boolean(errorText("slug"))}
              />
              <FieldDescription>{t("hints.slug")}</FieldDescription>
              {errorText("slug") ? <FieldError>{errorText("slug")}</FieldError> : null}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("fields.cover")}</CardTitle>
            <CardDescription>{t("cover.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <input type="hidden" {...register("coverId")} />
            {cover ? (
              <div className="relative overflow-hidden rounded-lg border">
                {/* biome-ignore lint/performance/noImgElement: превью загруженного файла из нашего каталога */}
                <img src={cover.url} alt="" className="aspect-video w-full object-cover" />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => {
                    setCover(null);
                    setValue("coverId", "" as unknown as number, { shouldDirty: true });
                  }}
                >
                  <XIcon aria-hidden="true" />
                  {t("cover.remove")}
                </Button>
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                <ImageIcon className="size-8" aria-hidden="true" />
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
              aria-label={t("cover.choose")}
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadCover(file);
              }}
            />
            {uploading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> {t("cover.uploading")}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending || uploading} className="flex-1">
            {pending ? <Spinner /> : null}
            {tc("actions.save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/admin/news")}>
            {tc("actions.cancel")}
          </Button>
        </div>
      </div>
    </form>
  );
}
