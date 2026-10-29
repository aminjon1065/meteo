"use client";

import {
  FMI_SILAM_AQI_SPLIT,
  FMI_SILAM_LAST_HOUR,
  FMI_SILAM_PRODUCTS,
  type FmiSilamCode,
  fmiSilamFrameTime,
  fmiSilamFrameUrl,
} from "@meteo/core/silam-fmi";
import { Button } from "@meteo/ui/components/button";
import { cn } from "@meteo/ui/lib/utils";
import { ExternalLinkIcon, Loader2Icon, PauseIcon, PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** Пауза между кадрами анимации после того, как кадр показан (ждём загрузку, а не таймер). */
const FRAME_MS = 450;
/** Пауза на последнем кадре перед повтором. */
const WRAP_MS = 1500;
/** Часы листают колесом или пальцем — качаем только кадр, на котором остановились. */
const SETTLE_MS = 150;
/** Прокрутка колеса на один час, px: щелчок колеса мыши ≈ 100, тачпад шлёт мелкие шаги. */
const WHEEL_STEP_PX = 50;
/** Сдвиг пальца по карте на один час, px. */
const SWIPE_STEP_PX = 16;
/** Сдвиг пальца, после которого понятно, листают часы или прокручивают страницу. */
const SWIPE_LOCK_PX = 12;
const HOURS = Array.from({ length: FMI_SILAM_LAST_HOUR + 1 }, (_, h) => h);

interface Frame {
  code: FmiSilamCode;
  hour: number;
}

const keyOf = (f: Frame) => `${f.code}/${f.hour}`;
const clampHour = (h: number) => Math.min(FMI_SILAM_LAST_HOUR, Math.max(0, h));

export interface FmiSilamViewerProps {
  run: { id: string; originTime: string };
  /**
   * Подписи часов 0…48 по Душанбе и местные сутки прогона — форматирует сервер: в браузерах (Chrome)
   * нет данных Intl для tg, и дата после первого же перелистывания стала бы английской.
   */
  frameLabels: string[];
  days: Array<{ key: string; first: number; last: number; label: string }>;
  initialCode: FmiSilamCode;
  /** Кадр при открытии — ближайший к текущему часу (считается на сервере, чтобы не было рассогласования). */
  initialHour: number;
  /** Час «сейчас» внутри прогона для метки на полосе часов; null — сейчас вне прогона. */
  nowHour: number | null;
}

/**
 * Просмотр карт SILAM от FMI так, как у FMI и на data.meteo.uz: кнопки показателей сверху, часы
 * листаются колесом мыши над картой (вниз — позже) или наведением на полосу часов, на телефоне —
 * движением пальца по карте, с клавиатуры — стрелками; «Анимация» прокручивает все 48 часов.
 * Под медленную сеть: качается только показанный кадр и один-три соседних, анимация переходит
 * к следующему кадру, когда загружен текущий. У AQI показывается только карта индекса (верхняя
 * часть кадра FMI); картинки FMI не меняются.
 */
export function FmiSilamViewer({
  run,
  frameLabels,
  days,
  initialCode,
  initialHour,
  nowHour,
}: FmiSilamViewerProps) {
  const t = useTranslations("silamPage");
  const origin = useMemo(() => new Date(run.originTime), [run.originTime]);
  const [target, setTarget] = useState<Frame>({ code: initialCode, hour: initialHour });
  const [shown, setShown] = useState<Frame>(target);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef(target.hour);
  const swipe = useRef<{ id: number; x: number; y: number; hour: number; locked: boolean } | null>(
    null,
  );
  const prefetched = useRef(new Set<string>());

  const url = (f: Frame) => fmiSilamFrameUrl(run.id, f.code, f.hour);
  const pending = keyOf(target) !== keyOf(shown) && failed !== keyOf(target);
  const error = failed === keyOf(target);

  /** Перейти на час (абсолютный или на `by` от текущего) — анимация останавливается, как у FMI. */
  const goHour = useCallback((next: { hour?: number; by?: number }) => {
    setPlaying(false);
    setFailed(null);
    setTarget((cur) => {
      const hour = clampHour(next.hour ?? cur.hour + (next.by ?? 0));
      return hour === cur.hour ? cur : { ...cur, hour };
    });
  }, []);

  const selectCode = (code: FmiSilamCode) => {
    setFailed(null);
    setTarget((cur) => ({ ...cur, code }));
    const next = new URL(window.location.href);
    next.searchParams.set("param", code);
    window.history.replaceState(null, "", next);
  };

  useEffect(() => {
    hourRef.current = target.hour;
  }, [target.hour]);

  // Колесо мыши над картой листает часы: вниз — позже, вверх — раньше; страница при этом не
  // прокручивается. На первом и последнем часу прокрутка уходит странице — с карты можно «выйти».
  // Слушатель не пассивный: иначе preventDefault не остановит прокрутку.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // жест масштаба на тачпаде
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      if (dy === 0) return;
      const dir = dy > 0 ? 1 : -1;
      const hour = hourRef.current;
      if ((dir > 0 && hour >= FMI_SILAM_LAST_HOUR) || (dir < 0 && hour <= 0)) {
        acc = 0;
        return;
      }
      e.preventDefault();
      if (Math.abs(dy) >= WHEEL_STEP_PX) {
        acc = 0;
        goHour({ by: dir });
        return;
      }
      acc += dy;
      const steps = Math.trunc(acc / WHEEL_STEP_PX);
      if (steps !== 0) {
        acc -= steps * WHEEL_STEP_PX;
        goHour({ by: steps });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [goHour]);

  // Палец по карте: влево — позже, вправо — раньше. Вертикальное движение остаётся прокруткой
  // страницы (touch-action: pan-y), щипок — масштабом.
  const onMapPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    swipe.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      hour: target.hour,
      locked: false,
    };
  };
  const onMapPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(dy) > SWIPE_LOCK_PX && Math.abs(dy) > Math.abs(dx)) {
        swipe.current = null;
        return;
      }
      if (Math.abs(dx) < SWIPE_LOCK_PX) return;
      s.locked = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    goHour({ hour: s.hour - Math.trunc(dx / SWIPE_STEP_PX) });
  };
  const endSwipe = () => {
    swipe.current = null;
  };

  const onMapKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const by: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: 6,
      PageDown: -6,
    };
    if (e.key === "Home") goHour({ hour: 0 });
    else if (e.key === "End") goHour({ hour: FMI_SILAM_LAST_HOUR });
    else if (by[e.key] !== undefined) goHour({ by: by[e.key] });
    else return;
    e.preventDefault();
  };

  /** Полоса часов, как столбик часов у FMI: наведение мыши выбирает час, палец — касание и ведение. */
  const stripHour = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return clampHour(Math.floor(((e.clientX - rect.left) / rect.width) * HOURS.length));
  };
  const onStripPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" && !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    goHour({ hour: stripHour(e) });
  };
  const onStripPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") e.currentTarget.setPointerCapture(e.pointerId);
    goHour({ hour: stripHour(e) });
  };

  // Загрузка выбранного кадра: показываем его, только когда он скачан и раскодирован — старый кадр
  // остаётся на месте, на медленной сети не мигает пустота.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt — повтор после ошибки
  useEffect(() => {
    const key = keyOf(target);
    if (key === keyOf(shown)) return;
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        const img = new Image();
        img.src = fmiSilamFrameUrl(run.id, target.code, target.hour);
        img.decode().then(
          () => {
            if (!cancelled) setShown(target);
          },
          () => {
            if (cancelled) return;
            setFailed(key);
            setPlaying(false);
          },
        );
      },
      playing ? 0 : SETTLE_MS,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [target, shown, playing, run.id, attempt]);

  // Анимация: следующий кадр запрашивается после того, как показан текущий.
  useEffect(() => {
    if (!playing || keyOf(target) !== keyOf(shown)) return;
    const last = target.hour >= FMI_SILAM_LAST_HOUR;
    const id = window.setTimeout(
      () => setTarget((cur) => ({ ...cur, hour: last ? 0 : cur.hour + 1 })),
      last ? WRAP_MS : FRAME_MS,
    );
    return () => window.clearTimeout(id);
  }, [playing, target, shown]);

  // Соседние кадры — заранее, когда браузер свободен: при анимации три вперёд, иначе по одному
  // в обе стороны (≈ 80 КБ).
  useEffect(() => {
    const ahead = playing ? [1, 2, 3] : [1, -1];
    const prefetch = () => {
      for (const step of ahead) {
        const hour = (shown.hour + step + HOURS.length) % HOURS.length;
        const src = fmiSilamFrameUrl(run.id, shown.code, hour);
        if (prefetched.current.has(src)) continue;
        prefetched.current.add(src);
        const img = new Image();
        img.src = src;
      }
    };
    const id = window.setTimeout(prefetch, playing ? 0 : 800);
    return () => window.clearTimeout(id);
  }, [shown, playing, run.id]);

  // Кадр из серверной разметки мог не загрузиться ещё до гидратации — onError тогда не сработает.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(keyOf(shown));
  }, [shown]);

  const product = FMI_SILAM_PRODUCTS.find((p) => p.code === shown.code) ?? FMI_SILAM_PRODUCTS[0];
  // У AQI под картой индекса у FMI ещё карта определяющего вещества — её не показываем.
  const visibleHeight = product.code === "AQI" ? FMI_SILAM_AQI_SPLIT : product.height;
  const timeLabel = (hour: number) =>
    t("viewer.localTime", { time: frameLabels[hour] ?? String(hour) });
  const utcHour = String(fmiSilamFrameTime(origin, target.hour).getUTCHours()).padStart(2, "0");
  const name = t(`products.${shown.code}.name`);
  const src = url(shown);
  const retry = () => {
    setFailed(null);
    setAttempt((n) => n + 1);
  };

  return (
    <section
      aria-label={t("viewer.heading")}
      className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4"
      data-testid="silam-fmi"
    >
      <nav aria-label={t("viewer.products")} className="flex flex-wrap gap-1.5">
        {FMI_SILAM_PRODUCTS.map((p) => {
          const active = p.code === target.code;
          return (
            <a
              key={p.code}
              href={`?param=${p.code}`}
              aria-current={active ? "true" : undefined}
              title={t(`products.${p.code}.name`)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                selectCode(p.code);
              }}
              className={cn(
                "inline-flex h-9 min-w-[3.25rem] items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted",
              )}
            >
              {t(`products.${p.code}.label`)}
            </a>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            type="button"
            variant={playing ? "default" : "outline"}
            className="gap-1.5 px-3"
            aria-pressed={playing}
            onClick={() => {
              setFailed(null);
              setPlaying((p) => !p);
            }}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
            {playing ? t("viewer.pause") : t("viewer.play")}
          </Button>
          <p
            className="min-w-0 flex-1 text-sm font-semibold tabular-nums"
            aria-live={playing ? "off" : "polite"}
          >
            {timeLabel(target.hour)}{" "}
            <span className="font-normal text-muted-foreground">
              · {t("viewer.utc", { hour: utcHour })}
            </span>
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="pointer-coarse:hidden">{t("viewer.hint")}</span>
          <span className="hidden pointer-coarse:inline">{t("viewer.hintTouch")}</span>
        </p>

        {/* Полоса часов — дубль колеса и клавиатуры для мыши и пальца, поэтому скрыта от чтецов. */}
        <div aria-hidden="true" className="flex flex-col gap-0.5">
          <div
            className="relative flex h-5 cursor-pointer touch-none overflow-hidden rounded-md border select-none"
            onPointerDown={onStripPointerDown}
            onPointerMove={onStripPointerMove}
            data-testid="silam-fmi-hours"
          >
            {HOURS.map((h) => (
              <span
                key={h}
                className={cn(
                  "flex-1 border-l border-background/60 first:border-l-0",
                  h === target.hour
                    ? "bg-primary"
                    : h % 6 === 0
                      ? "bg-muted-foreground/30"
                      : "bg-muted",
                )}
              />
            ))}
            {nowHour !== null ? (
              <span
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-brand-accent"
                style={{ left: `${((nowHour + 0.5) / HOURS.length) * 100}%` }}
              />
            ) : null}
          </div>
          <div className="relative h-4 text-xs text-muted-foreground">
            {days.map((d) => (
              <span
                key={d.key}
                className="absolute top-0 truncate border-l pl-1"
                style={{
                  left: `${(d.first / HOURS.length) * 100}%`,
                  maxWidth: `${((d.last - d.first + 1) / HOURS.length) * 100}%`,
                }}
              >
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <figure className="flex flex-col gap-2" aria-busy={pending}>
        <div className="relative mx-auto w-full max-w-[800px]">
          <div
            ref={mapRef}
            role="slider"
            tabIndex={0}
            aria-label={t("viewer.time")}
            aria-valuemin={0}
            aria-valuemax={FMI_SILAM_LAST_HOUR}
            aria-valuenow={target.hour}
            aria-valuetext={timeLabel(target.hour)}
            onKeyDown={onMapKeyDown}
            onPointerDown={onMapPointerDown}
            onPointerMove={onMapPointerMove}
            onPointerUp={endSwipe}
            onPointerCancel={endSwipe}
            className="touch-pan-y touch-pinch-zoom overflow-hidden rounded-lg border bg-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            style={{ aspectRatio: `${product.width} / ${visibleHeight}` }}
            data-testid="silam-fmi-map"
          >
            {/* biome-ignore lint/performance/noImgElement: картинка FMI без изменений, размер фиксирован */}
            <img
              key={`attempt-${attempt}`}
              ref={imgRef}
              src={src}
              alt={`${name}: ${frameLabels[shown.hour] ?? ""}`}
              width={product.width}
              height={product.height}
              decoding="async"
              draggable={false}
              onError={() => setFailed(keyOf(shown))}
              className={cn(
                "pointer-events-none size-full object-cover object-top transition-opacity select-none",
                (pending || error) && "opacity-60",
              )}
            />
          </div>
          {pending ? (
            <span className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full border bg-card/95 px-2.5 py-1 text-xs font-medium shadow-sm">
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
              {t("viewer.loading")}
            </span>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="absolute inset-x-2 top-2 flex flex-wrap items-center gap-2 rounded-lg border bg-card/95 px-3 py-2 text-sm shadow-sm sm:inset-x-auto sm:right-2 sm:max-w-sm"
            >
              <span className="flex-1">{t("viewer.frameError")}</span>
              <Button type="button" size="sm" variant="outline" onClick={retry}>
                {t("viewer.retry")}
              </Button>
            </div>
          ) : null}
        </div>
        <figcaption className="mx-auto flex w-full max-w-[800px] flex-col gap-1 text-sm">
          <p>
            <span className="font-semibold">{name}.</span>{" "}
            <span className="text-muted-foreground">{t(`products.${shown.code}.hint`)}</span>
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{t("viewer.attribution")}</span>
            <a
              href={url(target)}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
            >
              {t("viewer.fullSize")}
              <ExternalLinkIcon className="size-3" aria-hidden="true" />
            </a>
          </p>
        </figcaption>
      </figure>
    </section>
  );
}
