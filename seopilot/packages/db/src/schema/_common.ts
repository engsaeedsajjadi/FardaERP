import { timestamp, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Text UUID primary keys keep FK types consistent with Better Auth's text ids. */
export const id = () => text("id").primaryKey().default(sql`gen_random_uuid()::text`);
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const deletedAt = () => timestamp("deleted_at", { withTimezone: true });
