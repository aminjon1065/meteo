"use client";

import type { I18nText, Locale } from "@meteo/i18n";
import { locales } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { Button } from "@meteo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@meteo/ui/components/card";
import { Field, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@meteo/ui/components/tabs";
import { Textarea } from "@meteo/ui/components/textarea";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { SimpleResult } from "@/app/[locale]/admin/(app)/scales/actions";
import { useRouter } from "@/i18n/navigation";

export const AUDIENCES = [
  "general",
  "children",
  "pregnant",
  "elderly",
  "respiratory",
  "cardio",
] as const;
type Entry = { title: Record<Locale, string>; text: Record<Locale, string> };

export interface HealthAdviceEditorProps {
  scaleId: number;
  scales: Array<{ id: number; name: string }>;
  levels: Array<{ level: number; color: string; label: string }>;
  entries: Array<{ level: number; audience: string; title: I18nText | null; text: I18nText }>;
  action: (raw: unknown) => Promise<SimpleResult>;
}

const toText = (t: I18nText | null | undefined): Record<Locale, string> => ({
  tg: t?.tg ?? "",
  ru: t?.ru ?? "",
  en: t?.en ?? "",
});

export function HealthAdviceEditor({
  scaleId,
  scales,
  levels,
  entries,
  action,
}: HealthAdviceEditorProps) {
  const t = useTranslations("healthAdmin");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<Record<string, Entry>>(() => {
    const s: Record<string, Entry> = {};
    for (const lv of levels) {
      for (const a of AUDIENCES) {
        const e = entries.find((x) => x.level === lv.level && x.audience === a);
        s[`${lv.level}:${a}`] = { title: toText(e?.title), text: toText(e?.text) };
      }
    }
    return s;
  });

  function save(level: number) {
    startTransition(async () => {
      const result = await action({
        scaleId,
        level,
        entries: AUDIENCES.map((a) => ({ audience: a, ...(state[`${level}:${a}`] as Entry) })),
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      {scales.length > 1 ? (
        <Field className="w-72">
          <FieldLabel htmlFor="scale">{t("scale")}</FieldLabel>
          <NativeSelect
            id="scale"
            value={String(scaleId)}
            onChange={(e) => router.push(`/admin/health-advice?scale=${e.target.value}`)}
          >
            {scales.map((s) => (
              <NativeSelectOption key={s.id} value={String(s.id)}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <Tabs defaultValue={String(levels[0]?.level ?? 1)}>
        <TabsList>
          {levels.map((lv) => (
            <TabsTrigger key={lv.level} value={String(lv.level)}>
              <span
                className="mr-1.5 inline-block size-2.5 rounded-full"
                style={{ background: lv.color }}
                aria-hidden="true"
              />
              {lv.label || lv.level}
            </TabsTrigger>
          ))}
        </TabsList>
        {levels.map((lv) => (
          <TabsContent key={lv.level} value={String(lv.level)} className="grid gap-4 pt-2">
            <div className="flex items-center gap-3">
              <AqBadge
                level={Math.min(5, Math.max(0, lv.level)) as 0 | 1 | 2 | 3 | 4 | 5}
                label={lv.label || String(lv.level)}
              />
              <Button
                onClick={() => save(lv.level)}
                disabled={pending}
                size="sm"
                className="ml-auto"
              >
                {pending ? <Spinner /> : null}
                {t("saveLevel", { level: lv.label || lv.level })}
              </Button>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {AUDIENCES.map((a) => {
                const key = `${lv.level}:${a}`;
                const entry = state[key] as Entry;
                return (
                  <Card key={a}>
                    <CardHeader>
                      <CardTitle className="text-base">{t(`audience.${a}`)}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Tabs defaultValue={locale}>
                        <TabsList>
                          {locales.map((l) => (
                            <TabsTrigger key={l} value={l}>
                              {l.toUpperCase()}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        {locales.map((l) => (
                          <TabsContent key={l} value={l} className="grid gap-3 pt-2">
                            <Field>
                              <FieldLabel htmlFor={`${key}-title-${l}`}>
                                {t("fields.title")}
                              </FieldLabel>
                              <Input
                                id={`${key}-title-${l}`}
                                lang={l}
                                value={entry.title[l]}
                                onChange={(e) =>
                                  setState({
                                    ...state,
                                    [key]: {
                                      ...entry,
                                      title: { ...entry.title, [l]: e.target.value },
                                    },
                                  })
                                }
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor={`${key}-text-${l}`}>
                                {t("fields.text")}
                              </FieldLabel>
                              <Textarea
                                id={`${key}-text-${l}`}
                                lang={l}
                                rows={4}
                                value={entry.text[l]}
                                onChange={(e) =>
                                  setState({
                                    ...state,
                                    [key]: {
                                      ...entry,
                                      text: { ...entry.text, [l]: e.target.value },
                                    },
                                  })
                                }
                              />
                            </Field>
                          </TabsContent>
                        ))}
                      </Tabs>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
