"use client";

import { clampAqLevel } from "@meteo/core";
import type { I18nText, Locale } from "@meteo/i18n";
import { locales } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { Field, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@meteo/ui/components/native-select";
import { Spinner } from "@meteo/ui/components/spinner";
import { Switch } from "@meteo/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@meteo/ui/components/tabs";
import { Textarea } from "@meteo/ui/components/textarea";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { SimpleResult } from "@/app/[locale]/admin/(app)/scales/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

export interface ScaleEditorProps {
  scale: {
    id: number;
    kind: "breakpoints" | "ratio_to_limit" | "iza";
    name: I18nText;
    description: I18nText | null;
    isDefaultPublic: boolean;
    enabled: boolean;
    sortOrder: number;
    levels: Array<{
      level: number;
      color: string;
      label: I18nText;
      lo?: number;
      hi?: number | null;
    }>;
  };
  breakpoints: Array<{
    pollutantId: number;
    level: number;
    lo: number;
    hi: number | null;
    averagingMin: number;
  }>;
  pollutants: Array<{ id: number; code: string; shortName: string; unit: string }>;
  action: (raw: unknown) => Promise<SimpleResult>;
}

const toText = (t: I18nText | null | undefined): Record<Locale, string> => ({
  tg: t?.tg ?? "",
  ru: t?.ru ?? "",
  en: t?.en ?? "",
});

export function ScaleEditor({ scale, breakpoints, pollutants, action }: ScaleEditorProps) {
  const t = useTranslations("scales");
  const tl = useTranslations("levels");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(toText(scale.name));
  const [description, setDescription] = useState(toText(scale.description));
  const [isDefaultPublic, setDefault] = useState(scale.isDefaultPublic);
  const [enabled, setEnabled] = useState(scale.enabled);
  const [sortOrder, setSortOrder] = useState(String(scale.sortOrder));
  const [levels, setLevels] = useState(
    scale.levels.map((l) => ({
      ...l,
      label: toText(l.label),
      lo: l.lo !== undefined ? String(l.lo) : "",
      hi: l.hi !== undefined && l.hi !== null ? String(l.hi) : "",
    })),
  );
  // Число уровней задаёт шкала (5 — оперативная/ВОЗ, 6 — US AQI): столько же границ по веществу.
  const levelNumbers = [...scale.levels].map((l) => l.level).sort((a, b) => a - b);
  const levelCount = levelNumbers.length;
  const emptyLows = () => Array.from({ length: levelCount }, () => "");
  const [grid, setGrid] = useState<Record<number, { averagingMin: string; lows: string[] }>>(() => {
    const g: Record<number, { averagingMin: string; lows: string[] }> = {};
    for (const p of pollutants) {
      const rows = breakpoints
        .filter((b) => b.pollutantId === p.id)
        .sort((a, b) => a.level - b.level);
      g[p.id] = {
        averagingMin: String(rows[0]?.averagingMin ?? 60),
        lows: rows.length === levelCount ? rows.map((r) => String(r.lo)) : emptyLows(),
      };
    }
    return g;
  });

  function submit() {
    startTransition(async () => {
      const result = await action({
        name,
        description,
        isDefaultPublic,
        enabled,
        sortOrder,
        levels: levels.map((l) => ({
          level: l.level,
          color: l.color,
          label: l.label,
          lo: l.lo === "" ? undefined : l.lo,
          hi: l.hi === "" ? null : l.hi,
        })),
        breakpoints: pollutants.map((p) => {
          const row = grid[p.id];
          const lows = (row?.lows ?? []).filter((v) => v.trim() !== "");
          return {
            pollutantId: p.id,
            averagingMin: row?.averagingMin ?? "60",
            lows: lows.length === levelCount ? lows : [],
          };
        }),
      });
      if (!result.ok) {
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("sections.general")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
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
                  <FieldLabel htmlFor={`name-${l}`}>{t("fields.name")}</FieldLabel>
                  <Input
                    id={`name-${l}`}
                    value={name[l]}
                    onChange={(e) => setName({ ...name, [l]: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`desc-${l}`}>{t("fields.description")}</FieldLabel>
                  <Textarea
                    id={`desc-${l}`}
                    rows={2}
                    value={description[l]}
                    onChange={(e) => setDescription({ ...description, [l]: e.target.value })}
                  />
                </Field>
              </TabsContent>
            ))}
          </Tabs>
          <div className="flex flex-wrap items-center gap-6">
            <Field orientation="horizontal">
              <Switch
                id="default"
                checked={isDefaultPublic}
                onCheckedChange={(v) => setDefault(Boolean(v))}
              />
              <FieldLabel htmlFor="default">{t("fields.isDefaultPublic")}</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="enabled"
                checked={enabled}
                onCheckedChange={(v) => setEnabled(Boolean(v))}
              />
              <FieldLabel htmlFor="enabled">{t("fields.enabled")}</FieldLabel>
            </Field>
            <Field className="w-28">
              <FieldLabel htmlFor="sortOrder">{t("fields.sortOrder")}</FieldLabel>
              <Input
                id="sortOrder"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("sections.levels")}</CardTitle>
          <CardDescription>
            {scale.kind === "breakpoints" ? t("hints.levelsBreakpoints") : t("hints.levelsBands")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{t("fields.level")}</TableHead>
                <TableHead className="w-20">{t("fields.color")}</TableHead>
                {locales.map((l) => (
                  <TableHead key={l}>{l.toUpperCase()}</TableHead>
                ))}
                {scale.kind !== "breakpoints" ? (
                  <>
                    <TableHead className="w-24">{t("fields.lo")}</TableHead>
                    <TableHead className="w-24">{t("fields.hi")}</TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {levels.map((lv, i) => (
                <TableRow key={lv.level}>
                  <TableCell className="font-medium">{lv.level}</TableCell>
                  <TableCell>
                    <span
                      className="inline-block size-6 rounded-md border"
                      style={{ background: lv.color }}
                      title={lv.color}
                    />
                  </TableCell>
                  {locales.map((l) => (
                    <TableCell key={l}>
                      <Input
                        value={lv.label[l]}
                        placeholder={tl(`${clampAqLevel(lv.level) || 1}` as "1")}
                        onChange={(e) =>
                          setLevels(
                            levels.map((x, j) =>
                              j === i ? { ...x, label: { ...x.label, [l]: e.target.value } } : x,
                            ),
                          )
                        }
                      />
                    </TableCell>
                  ))}
                  {scale.kind !== "breakpoints" ? (
                    <>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={lv.lo}
                          onChange={(e) =>
                            setLevels(
                              levels.map((x, j) => (j === i ? { ...x, lo: e.target.value } : x)),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          value={lv.hi}
                          placeholder="∞"
                          onChange={(e) =>
                            setLevels(
                              levels.map((x, j) => (j === i ? { ...x, hi: e.target.value } : x)),
                            )
                          }
                        />
                      </TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {scale.kind === "breakpoints" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("sections.breakpoints")}</CardTitle>
            <CardDescription>{t("hints.breakpoints")}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fields.pollutant")}</TableHead>
                  <TableHead className="w-32">{t("fields.averaging")}</TableHead>
                  {levelNumbers.map((lvl) => (
                    <TableHead key={lvl} className="min-w-24">
                      {t("fields.levelFrom", { level: lvl })}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pollutants.map((p) => {
                  const row = grid[p.id] ?? { averagingMin: "60", lows: emptyLows() };
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {p.shortName}{" "}
                        <span className="text-xs text-muted-foreground">{p.unit}</span>
                      </TableCell>
                      <TableCell>
                        <NativeSelect
                          value={row.averagingMin}
                          onChange={(e) =>
                            setGrid({ ...grid, [p.id]: { ...row, averagingMin: e.target.value } })
                          }
                          aria-label={t("fields.averaging")}
                        >
                          {["60", "480", "1440"].map((m) => (
                            <NativeSelectOption key={m} value={m}>
                              {t(`averaging.${m}` as "averaging.60")}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </TableCell>
                      {row.lows.map((v, i) => (
                        <TableCell key={`${p.id}-${i + 1}`}>
                          <Input
                            inputMode="decimal"
                            value={v}
                            aria-label={`${p.shortName} ${t("fields.levelFrom", { level: i + 1 })}`}
                            onChange={(e) =>
                              setGrid({
                                ...grid,
                                [p.id]: {
                                  ...row,
                                  lows: row.lows.map((x, j) => (j === i ? e.target.value : x)),
                                },
                              })
                            }
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? <Spinner /> : null}
          {t("save")}
        </Button>
        <Button variant="outline" onClick={() => router.push("/admin/scales")}>
          {t("back")}
        </Button>
      </div>
    </div>
  );
}
