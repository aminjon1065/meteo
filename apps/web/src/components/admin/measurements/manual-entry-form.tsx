"use client";

import { DISCRETE_SAMPLE_TIMES, utcToDushanbeLocal } from "@meteo/core";
import { type Locale, pick } from "@meteo/i18n";
import { Alert, AlertDescription, AlertTitle } from "@meteo/ui/components/alert";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ClipboardEvent, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { EntryStation } from "@/app/[locale]/admin/(app)/measurements/_data";
import type { ManualEntryResult } from "@/app/[locale]/admin/(app)/measurements/actions";
import { translateOr } from "@/lib/i18n-utils";

type InvalidItem = Extract<ManualEntryResult, { ok: true }>["invalid"][number];

interface Row {
  key: number;
  time: string;
  values: Record<string, string>;
}

let keySeq = 1;
const makeRows = (times: readonly string[]): Row[] =>
  times.map((time) => ({ key: keySeq++, time, values: {} }));

export function ManualEntryForm({
  stations,
  action,
}: {
  stations: EntryStation[];
  action: (raw: unknown) => Promise<ManualEntryResult>;
}) {
  const t = useTranslations("measurements");
  const locale = useLocale() as Locale;
  const usable = useMemo(() => stations.filter((s) => s.pollutants.length > 0), [stations]);
  const [stationId, setStationId] = useState<number>(usable[0]?.id ?? 0);
  const [date, setDate] = useState(() => utcToDushanbeLocal(new Date()).date);
  const [rows, setRows] = useState<Row[]>(() => makeRows(DISCRETE_SAMPLE_TIMES));
  const [pending, startTransition] = useTransition();
  const [invalid, setInvalid] = useState<InvalidItem[]>([]);
  const station = usable.find((s) => s.id === stationId);

  function setCell(key: number, pollutantId: number, value: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, values: { ...r.values, [pollutantId]: value } } : r,
      ),
    );
  }
  function onPaste(e: ClipboardEvent<HTMLInputElement>, key: number, startIndex: number) {
    const text = e.clipboardData.getData("text");
    if (!station || !/[\t;]/.test(text)) return;
    e.preventDefault();
    const parts = text.split(/[\t;]/).map((p) => p.trim());
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const values = { ...r.values };
        parts.forEach((part, i) => {
          const p = station.pollutants[startIndex + i];
          if (p) values[p.id] = part;
        });
        return { ...r, values };
      }),
    );
  }

  function submit() {
    if (!station) return;
    startTransition(async () => {
      const result = await action({
        stationId: station.id,
        date,
        rows: rows.map((r) => ({ time: r.time, values: r.values })),
      });
      if (!result.ok) {
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      setInvalid(result.invalid);
      toast.success(t("entry.saved", { count: result.saved }));
      setRows((prev) => prev.map((r) => ({ ...r, values: {} })));
    });
  }

  if (usable.length === 0) {
    return (
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>{t("entry.noPollutants")}</AlertTitle>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="station">{t("entry.station")}</FieldLabel>
            <NativeSelect
              id="station"
              value={String(stationId)}
              onChange={(e) => setStationId(Number(e.target.value))}
            >
              {usable.map((s) => (
                <NativeSelectOption key={s.id} value={String(s.id)}>
                  {s.code} · {pick(s.name, locale)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="date">{t("entry.date")}</FieldLabel>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={utcToDushanbeLocal(new Date()).date}
            />
          </Field>
          <div className="flex items-end">
            <p className="text-xs text-muted-foreground">{t("entry.unitHint")}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {station ? `${station.code} · ${pick(station.name, locale)}` : ""}
          </CardTitle>
          <CardDescription>{t("entry.pasteHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">{t("entry.time")}</TableHead>
                  {station?.pollutants.map((p) => (
                    <TableHead key={p.id} className="min-w-28">
                      {p.shortName}{" "}
                      <span className="font-normal text-muted-foreground">{p.inputUnit}</span>
                    </TableHead>
                  ))}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <Input
                        type="time"
                        value={row.time}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.key === row.key ? { ...r, time: e.target.value } : r,
                            ),
                          )
                        }
                        aria-label={t("entry.time")}
                      />
                    </TableCell>
                    {station?.pollutants.map((p, index) => (
                      <TableCell key={p.id}>
                        <Input
                          inputMode="decimal"
                          value={row.values[p.id] ?? ""}
                          onChange={(e) => setCell(row.key, p.id, e.target.value)}
                          onPaste={(e) => onPaste(e, row.key, index)}
                          aria-label={`${row.time} ${p.shortName}`}
                          className="tabular-nums"
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("entry.removeRow")}
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                        disabled={rows.length <= 1}
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((prev) => [...prev, { key: keySeq++, time: nextTime(prev), values: {} }])
              }
            >
              <PlusIcon />
              {t("entry.addRow")}
            </Button>
            <Button onClick={submit} disabled={pending || !station} className="ml-auto">
              {pending ? <Spinner /> : null}
              {t("entry.save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {invalid.length > 0 ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("entry.invalidTitle")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {invalid.map((i) => (
                <li key={`${i.time}-${i.pollutant}`}>
                  {i.time} · {i.pollutant}: {i.value} ({i.reason})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function nextTime(rows: Row[]): string {
  const last = rows[rows.length - 1]?.time ?? "00:00";
  const [h] = last.split(":").map(Number);
  return `${String(((h ?? 0) + 1) % 24).padStart(2, "0")}:00`;
}
