CREATE TYPE "public"."cap_certainty" AS ENUM('Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown');--> statement-breakpoint
CREATE TYPE "public"."cap_msg_type" AS ENUM('Alert', 'Update', 'Cancel', 'Ack', 'Error');--> statement-breakpoint
CREATE TYPE "public"."cap_scope" AS ENUM('Public', 'Restricted', 'Private');--> statement-breakpoint
CREATE TYPE "public"."cap_severity" AS ENUM('Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown');--> statement-breakpoint
CREATE TYPE "public"."cap_status" AS ENUM('Actual', 'Exercise', 'System', 'Test', 'Draft');--> statement-breakpoint
CREATE TYPE "public"."cap_urgency" AS ENUM('Immediate', 'Expected', 'Future', 'Past', 'Unknown');--> statement-breakpoint
CREATE TYPE "public"."bulletin_status" AS ENUM('draft', 'queued', 'sent');--> statement-breakpoint
CREATE TYPE "public"."news_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "cap_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"sender" varchar(255) NOT NULL,
	"sent" timestamp with time zone NOT NULL,
	"status" "cap_status" NOT NULL,
	"msg_type" "cap_msg_type" NOT NULL,
	"scope" "cap_scope" NOT NULL,
	"source" varchar(255),
	"note" text,
	"refs" text,
	"superseded_by" integer,
	"source_url" text,
	"raw_xml" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cap_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"info_id" integer NOT NULL,
	"area_desc" text NOT NULL,
	"geom" geometry(MultiPolygon, 4326),
	"warning_region_id" integer,
	"geocodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"altitude" real,
	"ceiling" real
);
--> statement-breakpoint
CREATE TABLE "cap_event_translations" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" varchar(255) NOT NULL,
	"name" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cap_event_translations_event_unique" UNIQUE("event")
);
--> statement-breakpoint
CREATE TABLE "cap_infos" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer NOT NULL,
	"language" varchar(16) DEFAULT 'en-US' NOT NULL,
	"locale" varchar(5),
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"event" varchar(255) NOT NULL,
	"response_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"urgency" "cap_urgency" NOT NULL,
	"severity" "cap_severity" NOT NULL,
	"certainty" "cap_certainty" NOT NULL,
	"audience" text,
	"event_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective" timestamp with time zone,
	"onset" timestamp with time zone,
	"expires" timestamp with time zone,
	"sender_name" text,
	"headline" text,
	"description" text,
	"instruction" text,
	"web" text,
	"contact" text,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulletins" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" jsonb NOT NULL,
	"body" jsonb NOT NULL,
	"post_id" integer,
	"status" "bulletin_status" DEFAULT 'draft' NOT NULL,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"path" varchar(255) NOT NULL,
	"original_name" varchar(255),
	"mime" varchar(64) NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"alt" jsonb,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "news_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" jsonb NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "news_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(128) NOT NULL,
	"category_id" integer,
	"title" jsonb NOT NULL,
	"excerpt" jsonb,
	"body" jsonb NOT NULL,
	"cover_id" integer,
	"status" "news_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"author_id" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "cap_alerts" ADD CONSTRAINT "cap_alerts_superseded_by_cap_alerts_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."cap_alerts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cap_areas" ADD CONSTRAINT "cap_areas_info_id_cap_infos_id_fk" FOREIGN KEY ("info_id") REFERENCES "public"."cap_infos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cap_areas" ADD CONSTRAINT "cap_areas_warning_region_id_warning_regions_id_fk" FOREIGN KEY ("warning_region_id") REFERENCES "public"."warning_regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cap_infos" ADD CONSTRAINT "cap_infos_alert_id_cap_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."cap_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_post_id_news_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."news_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_category_id_news_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."news_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_cover_id_media_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_posts" ADD CONSTRAINT "news_posts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cap_alerts_identifier_sent_uq" ON "cap_alerts" USING btree ("identifier","sent");--> statement-breakpoint
CREATE INDEX "cap_alerts_identifier_idx" ON "cap_alerts" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "cap_alerts_status_type_idx" ON "cap_alerts" USING btree ("status","msg_type");--> statement-breakpoint
CREATE INDEX "cap_alerts_superseded_by_idx" ON "cap_alerts" USING btree ("superseded_by");--> statement-breakpoint
CREATE INDEX "cap_alerts_sent_idx" ON "cap_alerts" USING btree ("sent");--> statement-breakpoint
CREATE INDEX "cap_areas_info_id_idx" ON "cap_areas" USING btree ("info_id");--> statement-breakpoint
CREATE INDEX "cap_areas_warning_region_id_idx" ON "cap_areas" USING btree ("warning_region_id");--> statement-breakpoint
CREATE INDEX "cap_areas_geom_idx" ON "cap_areas" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "cap_infos_alert_id_idx" ON "cap_infos" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "cap_infos_expires_idx" ON "cap_infos" USING btree ("expires");--> statement-breakpoint
CREATE INDEX "cap_infos_event_idx" ON "cap_infos" USING btree ("event");--> statement-breakpoint
CREATE INDEX "bulletins_status_idx" ON "bulletins" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "news_posts_status_published_idx" ON "news_posts" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "news_posts_category_id_idx" ON "news_posts" USING btree ("category_id");