-- Пост‑миграционный SQL: TimescaleDB + PostGIS. Идемпотентен. Разделитель выражений: "-- >>>".
CREATE EXTENSION IF NOT EXISTS timescaledb;
-- >>>
CREATE EXTENSION IF NOT EXISTS postgis;
-- >>>
-- Гипертаблица измерений: чанки по месяцу.
SELECT create_hypertable('measurements', by_range('time', INTERVAL '1 month'), if_not_exists => TRUE);
-- >>>
-- Сжатие исторических данных: сегменты по станции и веществу.
ALTER TABLE measurements SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'station_id, pollutant_id',
  timescaledb.compress_orderby = 'time DESC'
);
-- >>>
SELECT add_compression_policy('measurements', INTERVAL '3 months', if_not_exists => TRUE);
-- >>>
-- Часовые агрегаты (только валидные и скорректированные значения).
CREATE MATERIALIZED VIEW IF NOT EXISTS measurements_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 hour', time) AS bucket,
  station_id,
  pollutant_id,
  avg(value)   AS avg_value,
  min(value)   AS min_value,
  max(value)   AS max_value,
  count(value) AS n
FROM measurements
WHERE qc_flag IN (1, 4) AND value IS NOT NULL
GROUP BY bucket, station_id, pollutant_id
WITH NO DATA;
-- >>>
SELECT add_continuous_aggregate_policy('measurements_hourly',
  start_offset => INTERVAL '30 days',
  end_offset   => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '10 minutes',
  if_not_exists => TRUE);
-- >>>
-- Суточные агрегаты в местном времени (Asia/Dushanbe, UTC+5).
CREATE MATERIALIZED VIEW IF NOT EXISTS measurements_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 day', time, 'Asia/Dushanbe') AS bucket,
  station_id,
  pollutant_id,
  avg(value)   AS avg_value,
  min(value)   AS min_value,
  max(value)   AS max_value,
  count(value) AS n
FROM measurements
WHERE qc_flag IN (1, 4) AND value IS NOT NULL
GROUP BY bucket, station_id, pollutant_id
WITH NO DATA;
-- >>>
SELECT add_continuous_aggregate_policy('measurements_daily',
  start_offset => INTERVAL '90 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);
-- >>>
-- Месячные агрегаты в местном времени (для ИЗА по среднемесячным).
CREATE MATERIALIZED VIEW IF NOT EXISTS measurements_monthly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 month', time, 'Asia/Dushanbe') AS bucket,
  station_id,
  pollutant_id,
  avg(value)   AS avg_value,
  min(value)   AS min_value,
  max(value)   AS max_value,
  count(value) AS n
FROM measurements
WHERE qc_flag IN (1, 4) AND value IS NOT NULL
GROUP BY bucket, station_id, pollutant_id
WITH NO DATA;
-- >>>
SELECT add_continuous_aggregate_policy('measurements_monthly',
  start_offset => INTERVAL '2 years',
  end_offset   => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  if_not_exists => TRUE);
-- >>>
-- Журнал аудита: запрет UPDATE/DELETE на уровне триггера (append-only).
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
-- >>>
DROP TRIGGER IF EXISTS audit_log_immutable_trg ON audit_log;
-- >>>
CREATE TRIGGER audit_log_immutable_trg
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
