"use client";

import { type I18nText, type Locale, locales } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { Input } from "@meteo/ui/components/input";
import { Spinner } from "@meteo/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@meteo/ui/components/table";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { CapEventResult } from "@/app/[locale]/admin/(app)/cap/actions";
import { useRouter } from "@/i18n/navigation";

export interface EventRow {
  id: number;
  event: string;
  name: I18nText;
  /** Сколько сообщений CAP используют этот event. */
  uses: number;
}

const toText = (t: I18nText | null | undefined): Record<Locale, string> => ({
  tg: t?.tg ?? "",
  ru: t?.ru ?? "",
  en: t?.en ?? "",
});

/** Таблица словаря событий: по строке на event, три поля перевода, сохранение построчно. */
export function EventDictionaryEditor({
  rows,
  save,
  remove,
}: {
  rows: EventRow[];
  save: (raw: unknown) => Promise<CapEventResult>;
  remove: (id: number) => Promise<CapEventResult>;
}) {
  const t = useTranslations("capAdmin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<Record<number, Record<Locale, string>>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, toText(r.name)])),
  );
  const [draft, setDraft] = useState({ event: "", ...toText(null) });

  function submit(payload: unknown, after?: () => void) {
    startTransition(async () => {
      const result = await save(payload);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(t("saved"));
      after?.();
      router.refresh();
    });
  }

  function destroy(id: number) {
    startTransition(async () => {
      const result = await remove(id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(t("deleted"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("event")}</TableHead>
              {locales.map((l) => (
                <TableHead key={l}>{l.toUpperCase()}</TableHead>
              ))}
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {t("eventsEmpty")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const values = state[r.id] ?? toText(r.name);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="align-top">
                      <span className="font-medium">{r.event}</span>
                      <span className="block text-xs text-muted-foreground">× {r.uses}</span>
                    </TableCell>
                    {locales.map((l) => (
                      <TableCell key={l} className="align-top">
                        <Input
                          aria-label={`${r.event} ${l}`}
                          lang={l}
                          value={values[l]}
                          onChange={(e) =>
                            setState((s) => ({ ...s, [r.id]: { ...values, [l]: e.target.value } }))
                          }
                        />
                      </TableCell>
                    ))}
                    <TableCell className="align-top">
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          disabled={pending}
                          onClick={() => submit({ id: r.id, event: r.event, name: values })}
                        >
                          {tc("actions.save")}
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={tc("actions.delete")}
                          disabled={pending}
                          onClick={() => destroy(r.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <form
        className="grid gap-2 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          const { event, ...name } = draft;
          submit({ event, name }, () => setDraft({ event: "", ...toText(null) }));
        }}
      >
        <Input
          aria-label={t("event")}
          placeholder={t("eventPlaceholder")}
          value={draft.event}
          required
          onChange={(e) => setDraft((d) => ({ ...d, event: e.target.value }))}
        />
        {locales.map((l) => (
          <Input
            key={l}
            aria-label={l}
            lang={l}
            placeholder={l.toUpperCase()}
            value={draft[l]}
            onChange={(e) => setDraft((d) => ({ ...d, [l]: e.target.value }))}
          />
        ))}
        <Button type="submit" variant="secondary" disabled={pending || !draft.event.trim()}>
          {pending ? <Spinner /> : <PlusIcon aria-hidden="true" />}
          {t("addEvent")}
        </Button>
      </form>
    </div>
  );
}
