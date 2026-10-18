CREATE TYPE "public"."forecast_provider" AS ENUM('smartmet', 'silam');--> statement-breakpoint
CREATE TABLE "forecast_points" (
	"location_id" integer NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"step_min" smallint DEFAULT 60 NOT NULL,
	"run_id" integer,
	"params" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" "forecast_provider" NOT NULL,
	"producer" varchar(64),
	"origin_time" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'ok' NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "silam_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"pollutant_id" integer NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"file" varchar(255) NOT NULL,
	"stats" jsonb,
	CONSTRAINT "silam_fields_uq" UNIQUE("run_id","pollutant_id","time")
);
--> statement-breakpoint
CREATE TABLE "silam_point_forecast" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"location_id" integer,
	"station_id" integer,
	"pollutant_id" integer NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"value" real NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "silam_point_uq" UNIQUE NULLS NOT DISTINCT("run_id","pollutant_id","time","location_id","station_id")
);
--> statement-breakpoint
CREATE TABLE "silam_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"origin_time" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'ok' NOT NULL,
	"hours" integer DEFAULT 0 NOT NULL,
	"grid" jsonb,
	"meta" jsonb,
	CONSTRAINT "silam_runs_origin_time_unique" UNIQUE("origin_time")
);
--> statement-breakpoint
ALTER TABLE "forecast_points" ADD CONSTRAINT "forecast_points_location_id_forecast_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."forecast_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_points" ADD CONSTRAINT "forecast_points_run_id_forecast_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."forecast_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silam_fields" ADD CONSTRAINT "silam_fields_run_id_silam_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."silam_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silam_fields" ADD CONSTRAINT "silam_fields_pollutant_id_pollutants_id_fk" FOREIGN KEY ("pollutant_id") REFERENCES "public"."pollutants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silam_point_forecast" ADD CONSTRAINT "silam_point_forecast_run_id_silam_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."silam_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silam_point_forecast" ADD CONSTRAINT "silam_point_forecast_location_id_forecast_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."forecast_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silam_point_forecast" ADD CONSTRAINT "silam_point_forecast_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "silam_point_forecast" ADD CONSTRAINT "silam_point_forecast_pollutant_id_pollutants_id_fk" FOREIGN KEY ("pollutant_id") REFERENCES "public"."pollutants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_points_uq" ON "forecast_points" USING btree ("location_id","time","step_min");--> statement-breakpoint
CREATE INDEX "forecast_points_time_idx" ON "forecast_points" USING btree ("time");--> statement-breakpoint
CREATE INDEX "forecast_runs_provider_fetched_idx" ON "forecast_runs" USING btree ("provider","fetched_at");--> statement-breakpoint
CREATE INDEX "silam_fields_time_idx" ON "silam_fields" USING btree ("time");--> statement-breakpoint
CREATE INDEX "silam_point_time_idx" ON "silam_point_forecast" USING btree ("time");