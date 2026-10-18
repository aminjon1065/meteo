CREATE TYPE "public"."alert_event_status" AS ENUM('active', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."alert_kind" AS ENUM('pollutant', 'index');--> statement-breakpoint
CREATE TYPE "public"."alert_scope" AS ENUM('all', 'station', 'region');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('pending', 'confirmed', 'unsubscribed');--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"station_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"peak_value" real,
	"last_value" real,
	"level" smallint,
	"status" "alert_event_status" DEFAULT 'active' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"scope" "alert_scope" DEFAULT 'all' NOT NULL,
	"station_id" integer,
	"region_id" integer,
	"kind" "alert_kind" DEFAULT 'pollutant' NOT NULL,
	"pollutant_id" integer,
	"scale_id" integer,
	"threshold" real NOT NULL,
	"averaging_min" smallint DEFAULT 60 NOT NULL,
	"cooldown_min" integer DEFAULT 180 NOT NULL,
	"channels" jsonb DEFAULT '["portal"]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"locale" varchar(5) DEFAULT 'tg' NOT NULL,
	"template" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "email_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dedup_key" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"locale" varchar(5) DEFAULT 'tg' NOT NULL,
	"status" "subscriber_status" DEFAULT 'pending' NOT NULL,
	"confirm_token" text NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"topics" jsonb DEFAULT '{"all":true}'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "measurements" ADD COLUMN "qc_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_pollutant_id_pollutants_id_fk" FOREIGN KEY ("pollutant_id") REFERENCES "public"."pollutants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_scale_id_index_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."index_scales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_status_idx" ON "alert_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "alert_events_station_started_idx" ON "alert_events" USING btree ("station_id","started_at");--> statement-breakpoint
CREATE INDEX "alert_rules_enabled_idx" ON "alert_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "email_outbox_status_idx" ON "email_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_dedup_uq" ON "email_outbox" USING btree ("dedup_key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_email_uq" ON "subscribers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_confirm_token_uq" ON "subscribers" USING btree ("confirm_token");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_unsubscribe_token_uq" ON "subscribers" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "subscribers_status_idx" ON "subscribers" USING btree ("status");