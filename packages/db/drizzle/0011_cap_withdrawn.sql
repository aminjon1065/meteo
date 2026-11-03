-- Снятие с публикации без Cancel: сообщение пропало из ленты SmartAlert (capfeed.php — только последний выпуск редактора).
ALTER TABLE "cap_alerts" ADD COLUMN "withdrawn_at" timestamp with time zone;
