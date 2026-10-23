-- Данные сети PM‑датчиков приходят по открытому API wwcs.tj, а не с сайта airquality.meteo.tj: убираем
-- упоминание сайта из текстов, которые записали seed (описание шкалы US_AQI) и скрипт import-wwcs (описания
-- станций сети, подпись JSON‑источника). Меняются только тексты, где упоминание осталось.
UPDATE "index_scales"
SET "description" = jsonb_set(
  jsonb_set("description", '{ru}', to_jsonb(replace("description"->>'ru', '; на airquality.meteo.tj применяется таблица PM2.5 2012 г. к 10‑минутным значениям, поэтому числа могут немного отличаться', ''))),
  '{en}', to_jsonb(replace("description"->>'en', '; airquality.meteo.tj applies the 2012 PM2.5 table to 10‑minute values, so numbers may differ slightly', ''))
)
WHERE "code" = 'US_AQI' AND "description"::text LIKE '%airquality.meteo.tj%';
--> statement-breakpoint
UPDATE "stations"
SET "description" = replace("description"::text, ' (airquality.meteo.tj)', '')::jsonb
WHERE "description"::text LIKE '%(airquality.meteo.tj)%';
--> statement-breakpoint
UPDATE "station_sources"
SET "label" = 'WWCS airquality API'
WHERE "label" = 'WWCS airquality API (airquality.meteo.tj)';
