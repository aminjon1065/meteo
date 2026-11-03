-- В текстах портала вместо длинного тире пишем обычный дефис "-" (решение 03.11.2026). Переводы и код
-- исправлены в репозитории; здесь тексты, которые seed и скрипты импорта уже записали в базу: шкалы,
-- рекомендации, справочники, станции, реквизиты Агентства. Сообщения CAP синоптиков, опубликованные
-- экобюллетени, рассылки и новости редакции не меняем. Повторный запуск ничего не меняет.
UPDATE "index_scales"
SET "name" = replace("name"::text, '—', '-')::jsonb,
  "description" = replace("description"::text, '—', '-')::jsonb,
  "levels" = replace("levels"::text, '—', '-')::jsonb
WHERE concat("name"::text, "description"::text, "levels"::text) LIKE '%—%';
--> statement-breakpoint
UPDATE "health_advice"
SET "title" = replace("title"::text, '—', '-')::jsonb,
  "text" = replace("text"::text, '—', '-')::jsonb
WHERE concat("title"::text, "text"::text) LIKE '%—%';
--> statement-breakpoint
UPDATE "pollutants" SET "name" = replace("name"::text, '—', '-')::jsonb WHERE "name"::text LIKE '%—%';
--> statement-breakpoint
UPDATE "cap_event_translations" SET "name" = replace("name"::text, '—', '-')::jsonb WHERE "name"::text LIKE '%—%';
--> statement-breakpoint
UPDATE "regions" SET "name" = replace("name"::text, '—', '-')::jsonb WHERE "name"::text LIKE '%—%';
--> statement-breakpoint
UPDATE "districts" SET "name" = replace("name"::text, '—', '-')::jsonb WHERE "name"::text LIKE '%—%';
--> statement-breakpoint
UPDATE "warning_regions" SET "name" = replace("name"::text, '—', '-')::jsonb WHERE "name"::text LIKE '%—%';
--> statement-breakpoint
UPDATE "forecast_locations" SET "name" = replace("name"::text, '—', '-')::jsonb WHERE "name"::text LIKE '%—%';
--> statement-breakpoint
UPDATE "news_categories" SET "name" = replace("name"::text, '—', '-')::jsonb WHERE "name"::text LIKE '%—%';
--> statement-breakpoint
UPDATE "stations"
SET "name" = replace("name"::text, '—', '-')::jsonb,
  "description" = replace("description"::text, '—', '-')::jsonb,
  "address" = replace("address"::text, '—', '-')::jsonb
WHERE concat("name"::text, "description"::text, "address"::text) LIKE '%—%';
--> statement-breakpoint
UPDATE "settings" SET "value" = replace("value"::text, '—', '-')::jsonb
WHERE "key" = 'branding' AND "value"::text LIKE '%—%';
