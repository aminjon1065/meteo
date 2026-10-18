CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS timescaledb;--> statement-breakpoint
CREATE TYPE "public"."forecast_location_kind" AS ENUM('city', 'district', 'station');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('pending', 'applied', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."qc_rule_kind" AS ENUM('range', 'spike', 'stuck', 'mad_outlier');--> statement-breakpoint
CREATE TYPE "public"."limit_kind" AS ENUM('daily', 'max_single', 'annual');--> statement-breakpoint
CREATE TYPE "public"."health_audience" AS ENUM('general', 'children', 'pregnant', 'elderly', 'respiratory', 'cardio');--> statement-breakpoint
CREATE TYPE "public"."index_scale_kind" AS ENUM('breakpoints', 'ratio_to_limit', 'iza');--> statement-breakpoint
CREATE TYPE "public"."station_data_source" AS ENUM('manual', 'import', 'api', 'sensor');--> statement-breakpoint
CREATE TYPE "public"."station_kind" AS ENUM('air', 'meteo', 'combined');--> statement-breakpoint
CREATE TYPE "public"."station_sampling" AS ENUM('continuous', 'discrete');--> statement-breakpoint
CREATE TYPE "public"."station_status" AS ENUM('active', 'suspended', 'decommissioned');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false,
	"locale" text DEFAULT 'tg' NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" serial PRIMARY KEY NOT NULL,
	"region_id" integer NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" jsonb NOT NULL,
	"geom" geometry(MultiPolygon, 4326),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "districts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "forecast_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" jsonb NOT NULL,
	"geom" geometry(point) NOT NULL,
	"region_id" integer,
	"kind" "forecast_location_kind" DEFAULT 'city' NOT NULL,
	"smartmet_place" varchar(128),
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecast_locations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" jsonb NOT NULL,
	"geom" geometry(MultiPolygon, 4326),
	"centroid" geometry(point),
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "warning_regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" jsonb NOT NULL,
	"geom" geometry(MultiPolygon, 4326),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warning_regions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" integer,
	"file_name" varchar(255) NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_ok" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"report" jsonb,
	"status" "import_batch_status" DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"time" timestamp with time zone NOT NULL,
	"station_id" integer NOT NULL,
	"pollutant_id" integer NOT NULL,
	"averaging_min" smallint DEFAULT 60 NOT NULL,
	"value" double precision,
	"original_value" double precision,
	"qc_flag" smallint DEFAULT 0 NOT NULL,
	"qc_reason" text,
	"source" smallint DEFAULT 1 NOT NULL,
	"batch_id" uuid,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurements_time_station_id_pollutant_id_averaging_min_pk" PRIMARY KEY("time","station_id","pollutant_id","averaging_min")
);
--> statement-breakpoint
CREATE TABLE "qc_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"pollutant_id" integer,
	"kind" "qc_rule_kind" NOT NULL,
	"params" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station_index" (
	"time" timestamp with time zone NOT NULL,
	"station_id" integer NOT NULL,
	"scale_id" integer NOT NULL,
	"value" real,
	"level" smallint NOT NULL,
	"dominant_pollutant_id" integer,
	"sub_indices" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_index_time_station_id_scale_id_pk" PRIMARY KEY("time","station_id","scale_id")
);
--> statement-breakpoint
CREATE TABLE "limit_values" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"pollutant_id" integer NOT NULL,
	"kind" "limit_kind" NOT NULL,
	"value" real NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pollutants" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" jsonb NOT NULL,
	"short_name" varchar(16) NOT NULL,
	"unit" varchar(16) NOT NULL,
	"decimals" smallint DEFAULT 1 NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"molar_mass" real,
	"hazard_class" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pollutants_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "health_advice" (
	"id" serial PRIMARY KEY NOT NULL,
	"scale_id" integer NOT NULL,
	"level" smallint NOT NULL,
	"audience" "health_audience" NOT NULL,
	"title" jsonb,
	"text" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_breakpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"scale_id" integer NOT NULL,
	"pollutant_id" integer NOT NULL,
	"level" smallint NOT NULL,
	"lo" real NOT NULL,
	"hi" real,
	"averaging_min" smallint DEFAULT 60 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_scales" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"kind" "index_scale_kind" NOT NULL,
	"levels" jsonb NOT NULL,
	"is_default_public" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_scales_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "station_pollutants" (
	"station_id" integer NOT NULL,
	"pollutant_id" integer NOT NULL,
	"input_unit" varchar(16) DEFAULT 'µg/m³' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "station_pollutants_station_id_pollutant_id_pk" PRIMARY KEY("station_id","pollutant_id")
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" jsonb NOT NULL,
	"kind" "station_kind" DEFAULT 'air' NOT NULL,
	"geom" geometry(point) NOT NULL,
	"elevation_m" real,
	"region_id" integer,
	"district_id" integer,
	"status" "station_status" DEFAULT 'active' NOT NULL,
	"commissioned_at" date,
	"decommissioned_at" date,
	"data_source" "station_data_source" DEFAULT 'manual' NOT NULL,
	"sampling" "station_sampling" DEFAULT 'discrete' NOT NULL,
	"description" jsonb,
	"address" jsonb,
	"photo" text,
	"api_key_hash" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stations_code_unique" UNIQUE("code"),
	CONSTRAINT "stations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"actor_role" varchar(16),
	"action" varchar(64) NOT NULL,
	"entity" varchar(64) NOT NULL,
	"entity_id" varchar(64),
	"before" jsonb,
	"after" jsonb,
	"ip" varchar(64),
	"user_agent" text,
	"request_id" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_locations" ADD CONSTRAINT "forecast_locations_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_pollutant_id_pollutants_id_fk" FOREIGN KEY ("pollutant_id") REFERENCES "public"."pollutants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_rules" ADD CONSTRAINT "qc_rules_pollutant_id_pollutants_id_fk" FOREIGN KEY ("pollutant_id") REFERENCES "public"."pollutants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_index" ADD CONSTRAINT "station_index_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_index" ADD CONSTRAINT "station_index_scale_id_index_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."index_scales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_index" ADD CONSTRAINT "station_index_dominant_pollutant_id_pollutants_id_fk" FOREIGN KEY ("dominant_pollutant_id") REFERENCES "public"."pollutants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_values" ADD CONSTRAINT "limit_values_pollutant_id_pollutants_id_fk" FOREIGN KEY ("pollutant_id") REFERENCES "public"."pollutants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_advice" ADD CONSTRAINT "health_advice_scale_id_index_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."index_scales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_breakpoints" ADD CONSTRAINT "index_breakpoints_scale_id_index_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."index_scales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_breakpoints" ADD CONSTRAINT "index_breakpoints_pollutant_id_pollutants_id_fk" FOREIGN KEY ("pollutant_id") REFERENCES "public"."pollutants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_pollutants" ADD CONSTRAINT "station_pollutants_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_pollutants" ADD CONSTRAINT "station_pollutants_pollutant_id_pollutants_id_fk" FOREIGN KEY ("pollutant_id") REFERENCES "public"."pollutants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "districts_region_id_idx" ON "districts" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "forecast_locations_region_id_idx" ON "forecast_locations" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "import_batches_station_id_idx" ON "import_batches" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "measurements_station_time_idx" ON "measurements" USING btree ("station_id","time");--> statement-breakpoint
CREATE INDEX "measurements_qc_flag_idx" ON "measurements" USING btree ("qc_flag");--> statement-breakpoint
CREATE INDEX "station_index_station_time_idx" ON "station_index" USING btree ("station_id","time");--> statement-breakpoint
CREATE UNIQUE INDEX "limit_values_pollutant_kind_uq" ON "limit_values" USING btree ("pollutant_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "health_advice_uq" ON "health_advice" USING btree ("scale_id","level","audience");--> statement-breakpoint
CREATE UNIQUE INDEX "index_breakpoints_uq" ON "index_breakpoints" USING btree ("scale_id","pollutant_id","level");--> statement-breakpoint
CREATE INDEX "stations_status_idx" ON "stations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stations_region_id_idx" ON "stations" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "stations_geom_idx" ON "stations" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");