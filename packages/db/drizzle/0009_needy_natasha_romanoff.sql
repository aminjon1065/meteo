CREATE TYPE "public"."eco_bulletin_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "eco_bulletins" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"station_id" integer NOT NULL,
	"status" "eco_bulletin_status" DEFAULT 'draft' NOT NULL,
	"data" jsonb NOT NULL,
	"gamma" varchar(32),
	"generated_by" varchar(16) DEFAULT 'manual' NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"post_id" integer,
	"mail_bulletin_id" integer,
	"published_at" timestamp with time zone,
	"published_by" text,
	"notified_at" timestamp with time zone,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eco_bulletins" ADD CONSTRAINT "eco_bulletins_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_bulletins" ADD CONSTRAINT "eco_bulletins_post_id_news_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."news_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_bulletins" ADD CONSTRAINT "eco_bulletins_mail_bulletin_id_bulletins_id_fk" FOREIGN KEY ("mail_bulletin_id") REFERENCES "public"."bulletins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_bulletins" ADD CONSTRAINT "eco_bulletins_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_bulletins" ADD CONSTRAINT "eco_bulletins_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eco_bulletins" ADD CONSTRAINT "eco_bulletins_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eco_bulletins_date_station_uq" ON "eco_bulletins" USING btree ("date","station_id");--> statement-breakpoint
CREATE INDEX "eco_bulletins_status_date_idx" ON "eco_bulletins" USING btree ("status","date");