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
import type { CategoryResult } from "@/app/[locale]/admin/(app)/news/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

export interface CategoryRow {
  id: number;
  slug: string;
  name: I18nText;
  sortOrder: number;
  posts: number;
}

type Draft = { slug: string; sortOrder: string } & Record<Locale, string>;

const toDraft = (r?: CategoryRow): Draft => ({
  slug: r?.slug ?? "",
  sortOrder: String(r?.sortOrder ?? 0),
  tg: r?.name.tg ?? "",
  ru: r?.name.ru ?? "",
  en: r?.name.en ?? "",
});

/** Таблица рубрик: slug, названия на трёх языках, порядок; сохранение построчно. */
export function CategoriesEditor({
  rows,
  save,
  remove,
}: {
  rows: CategoryRow[];
  save: (raw: unknown) => Promise<CategoryResult>;
  remove: (id: number) => Promise<CategoryResult>;
}) {
  const t = useTranslations("newsAdmin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, toDraft(r)])),
  );
  const [draft, setDraft] = useState<Draft>(toDraft());

  function payload(d: Draft, id?: number) {
    const { slug, sortOrder, ...name } = d;
    return { id, slug, sortOrder, name };
  }

  function submit(raw: unknown, after?: () => void) {
    startTransition(async () => {
      const r = await save(raw);
      if (!r.ok) {
        toast.error(translateOr(t, `errors.${r.message}`, r.message));
        return;
      }
      toast.success(t("saved"));
      after?.();
      router.refresh();
    });
  }

  function destroy(id: number) {
    if (!window.confirm(t("categories.deleteConfirm"))) return;
    startTransition(async () => {
      const r = await remove(id);
      if (!r.ok) {
        toast.error(translateOr(t, `errors.${r.message}`, r.message));
        return;
      }
      router.refresh();
    });
  }

  const fields = (d: Draft, set: (d: Draft) => void, idPrefix: string) => (
    <>
      <TableCell className="align-top">
        <Input
          aria-label={t("categories.slug")}
          id={`${idPrefix}-slug`}
          value={d.slug}
          onChange={(e) => set({ ...d, slug: e.target.value })}
        />
      </TableCell>
      {locales.map((l) => (
        <TableCell key={l} className="align-top">
          <Input
            aria-label={`${t("categories.name")} ${l}`}
            lang={l}
            value={d[l]}
            onChange={(e) => set({ ...d, [l]: e.target.value })}
          />
        </TableCell>
      ))}
      <TableCell className="w-24 align-top">
        <Input
          aria-label={t("categories.order")}
          type="number"
          min={0}
          value={d.sortOrder}
          onChange={(e) => set({ ...d, sortOrder: e.target.value })}
        />
      </TableCell>
    </>
  );

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("categories.slug")}</TableHead>
            {locales.map((l) => (
              <TableHead key={l}>{l.toUpperCase()}</TableHead>
            ))}
            <TableHead>{t("categories.order")}</TableHead>
            <TableHead className="w-44" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                {t("categories.empty")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => {
              const d = state[r.id] ?? toDraft(r);
              return (
                <TableRow key={r.id}>
                  {fields(d, (nd) => setState((s) => ({ ...s, [r.id]: nd })), `c${r.id}`)}
                  <TableCell className="align-top">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending}
                        onClick={() => submit(payload(d, r.id))}
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
                      <span className="text-xs text-muted-foreground">× {r.posts}</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
          <TableRow>
            {fields(draft, setDraft, "new")}
            <TableCell className="align-top">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending || !draft.slug.trim()}
                onClick={() => submit(payload(draft), () => setDraft(toDraft()))}
              >
                {pending ? <Spinner /> : <PlusIcon aria-hidden="true" />}
                {t("categories.add")}
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
