CREATE TYPE "public"."station_source_kind" AS ENUM('sftp', 'ftp', 'ftps', 'http');--> statement-breakpoint
CREATE TABLE "station_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_id" integer NOT NULL,
	"kind" "station_source_kind" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"label" varchar(64),
	"host" varchar(255) DEFAULT '' NOT NULL,
	"port" integer,
	"username" varchar(128),
	"secret" text,
	"private_key" text,
	"host_fingerprint" varchar(128),
	"path" text DEFAULT '' NOT NULL,
	"file_pattern" varchar(255) DEFAULT '*.csv' NOT NULL,
	"mapping" jsonb NOT NULL,
	"stale_after_min" integer DEFAULT 180 NOT NULL,
	"status" varchar(16) DEFAULT 'never' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_data_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_summary" jsonb,
	"alerted_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "last_ingest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "last_ingest_source" varchar(16);--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "last_ingest_summary" jsonb;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "stale_alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "station_sources" ADD CONSTRAINT "station_sources_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "station_sources_station_id_idx" ON "station_sources" USING btree ("station_id");