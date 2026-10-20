import { cn } from "@meteo/ui/lib/utils";
import { getFormatter } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export interface EditorialItem {
  key: string;
  href: string;
  title: string;
  /** Рубрика: «Новости», «Бюллетень», «Предупреждение». */
  kind: string;
  date: Date | null;
  excerpt?: string | null;
}

/** Редакционный список (макет 1): дата · рубрика, заголовок, одна строка анонса; без карточек. */
export async function EditorialList({
  items,
  className,
  columns = 3,
}: {
  items: EditorialItem[];
  className?: string;
  columns?: 1 | 2 | 3;
}) {
  const format = await getFormatter();
  return (
    <ul
      className={cn(
        "grid gap-3.5",
        columns === 3 && "md:grid-cols-3",
        columns === 2 && "md:grid-cols-2",
        className,
      )}
    >
      {items.map((item) => (
        <li
          key={item.key}
          className="grid content-start gap-1.5 border-t-2 border-foreground pt-3.5 pb-2"
        >
          <small className="text-caption text-muted-foreground">
            {item.date ? format.dateTime(item.date, { day: "numeric", month: "long" }) : null}
            {item.date ? " · " : ""}
            {item.kind}
          </small>
          <h3 className="text-h3 leading-snug">
            <Link href={item.href} className="hover:underline">
              {item.title}
            </Link>
          </h3>
          {item.excerpt ? (
            <p className="line-clamp-3 text-sm text-muted-foreground">{item.excerpt}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
