-- 0005_user_roles.sql
-- Adds role-based access control and account enable/disable to the user table.
-- The first user (lowest id, typically the default-seeded admin) is promoted to admin.
-- All other existing users default to 'user' role and enabled=true.

ALTER TABLE "user" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
--> statement-breakpoint
UPDATE "user" SET "role" = 'admin' WHERE "id" = (SELECT MIN("id") FROM "user")
