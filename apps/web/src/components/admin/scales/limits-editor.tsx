"use client";

import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
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
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { SimpleResult } from "@/app/[locale]/admin/(app)/scales/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

export interface LimitsEditorProps {
  pollutants: Array<{
    id: number;
    code: string;
    shortName: string;
    unit: string;
    hazardClass: number | null;
  }>;
  limits: Array<{ pollutantId: number; kind: "daily" | "max_single" | "annual"; value: number }>;
  action: (raw: unknown) => Promise<SimpleResult>;
}

type Row = { daily: string; maxSingle: string; annual: string; hazardClass: string };

export function LimitsEditor({ pollutants, limits, action }: LimitsEditorProps) {
  const t = useTranslations("scales");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Record<number, Row>>(() => {
    const r: Record<number, Row> = {};
    for (const p of pollutants) {
      const get = (kind: string) =>
        limits.find((l) => l.pollutantId === p.id && l.kind === kind)?.value;
      r[p.id] = {
        daily: str(get("daily")),
        maxSingle: str(get("max_single")),
        annual: str(get("annual")),
        hazardClass: p.hazardClass ? String(p.hazardClass) : "",
      };
    }
    return r;
  });

  function submit() {
    startTransition(async () => {
      const result = await action({
        rows: pollutants.map((p) => {
          const r = rows[p.id] as Row;
          return {
            pollutantId: p.id,
            daily: r.daily.trim() === "" ? null : r.daily.replace(",", "."),
            maxSingle: r.maxSingle.trim() === "" ? null : r.maxSingle.replace(",", "."),
            annual: r.annual.trim() === "" ? null : r.annual.replace(",", "."),
            hazardClass: r.hazardClass === "" ? null : r.hazardClass,
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("limits.table")}</CardTitle>
        <CardDescription>{t("limits.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.pollutant")}</TableHead>
              <TableHead>{t("limits.daily")}</TableHead>
              <TableHead>{t("limits.maxSingle")}</TableHead>
              <TableHead>{t("limits.annual")}</TableHead>
              <TableHead className="w-36">{t("limits.hazardClass")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pollutants.map((p) => {
              const r = rows[p.id] as Row;
              const set = (patch: Partial<Row>) => setRows({ ...rows, [p.id]: { ...r, ...patch } });
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.shortName} <span className="text-xs text-muted-foreground">{p.unit}</span>
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      value={r.daily}
                      onChange={(e) => set({ daily: e.target.value })}
                      aria-label={`${p.shortName} ${t("limits.daily")}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      value={r.maxSingle}
                      onChange={(e) => set({ maxSingle: e.target.value })}
                      aria-label={`${p.shortName} ${t("limits.maxSingle")}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      inputMode="decimal"
                      value={r.annual}
                      onChange={(e) => set({ annual: e.target.value })}
                      aria-label={`${p.shortName} ${t("limits.annual")}`}
                    />
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      value={r.hazardClass}
                      onChange={(e) => set({ hazardClass: e.target.value })}
                      aria-label={`${p.shortName} ${t("limits.hazardClass")}`}
                    >
                      <NativeSelectOption value="">—</NativeSelectOption>
                      {["1", "2", "3", "4"].map((c) => (
                        <NativeSelectOption key={c} value={c}>
                          {c}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Spinner /> : null}
            {t("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function str(v: number | undefined): string {
  return v === undefined ? "" : String(v);
}
