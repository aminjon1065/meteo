ALTER TABLE "station_index" ADD COLUMN "indicators" jsonb;--> statement-breakpoint
-- ПДК по ежедневному бюллетеню Агентства по гидрометеорологии (19.10.2026): максимальная разовая NO2 —
-- 0,085 мг/м³ (85 µg/m³), а не 200. Обновляются только строки с источником seed по умолчанию;
-- значения, изменённые администратором (source = admin:<email>), не трогаем.
UPDATE "limit_values" lv
   SET "value" = 85,
       "source" = 'ПДК Агентства по гидрометеорологии (бюллетень от 19.10.2026)',
       "updated_at" = now()
  FROM "pollutants" p
 WHERE p."id" = lv."pollutant_id"
   AND p."code" = 'NO2'
   AND lv."kind" = 'max_single'
   AND lv."source" = 'СанПиН 1.2.3685-21 (черновик, к подтверждению Заказчиком)';--> statement-breakpoint
-- Остальные значения seed совпадают с таблицей бюллетеня — меняем только подпись источника.
UPDATE "limit_values"
   SET "source" = 'ПДК Агентства по гидрометеорологии (бюллетень от 19.10.2026)',
       "updated_at" = now()
 WHERE "source" = 'СанПиН 1.2.3685-21 (черновик, к подтверждению Заказчиком)';--> statement-breakpoint
-- Терминология Агентства в названиях веществ seed (редактора названий в админке нет; меняем только прежний текст seed).
UPDATE "pollutants"
   SET "name" = '{"tg":"Зарачаҳои 2,5 мкр. (PM2.5)","ru":"Взвешенные частицы PM2.5","en":"Particulate matter PM2.5"}'::jsonb,
       "updated_at" = now()
 WHERE "code" = 'PM25'
   AND "name" = '{"tg":"Зарраҳои муаллақи PM2.5","ru":"Взвешенные частицы PM2.5","en":"Particulate matter PM2.5"}'::jsonb;--> statement-breakpoint
UPDATE "pollutants"
   SET "name" = '{"tg":"Зарачаҳои 10 мкр. (PM10)","ru":"Взвешенные частицы PM10","en":"Particulate matter PM10"}'::jsonb,
       "updated_at" = now()
 WHERE "code" = 'PM10'
   AND "name" = '{"tg":"Зарраҳои муаллақи PM10","ru":"Взвешенные частицы PM10","en":"Particulate matter PM10"}'::jsonb;--> statement-breakpoint
UPDATE "pollutants"
   SET "name" = '{"tg":"Дуоксиди нитроген","ru":"Диоксид азота","en":"Nitrogen dioxide"}'::jsonb,
       "updated_at" = now()
 WHERE "code" = 'NO2'
   AND "name" = '{"tg":"Диоксиди нитроген","ru":"Диоксид азота","en":"Nitrogen dioxide"}'::jsonb;--> statement-breakpoint
UPDATE "pollutants"
   SET "name" = '{"tg":"Дуоксиди сулфур","ru":"Диоксид серы","en":"Sulphur dioxide"}'::jsonb,
       "updated_at" = now()
 WHERE "code" = 'SO2'
   AND "name" = '{"tg":"Диоксиди сулфур","ru":"Диоксид серы","en":"Sulphur dioxide"}'::jsonb;
