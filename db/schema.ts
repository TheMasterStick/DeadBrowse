import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
// One versioned world snapshot is intentional for this small first district.
// The revision provides atomic compare-and-swap across concurrent Workers.
export const hostedWorld = sqliteTable("hosted_world", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  payload: text("payload").notNull(),
});
