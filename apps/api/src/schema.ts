import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
export const taxa = sqliteTable("taxa", {
  id: text("id").primaryKey(),
  scientificName: text("scientific_name"),
  category: text("category")
    .$type<"fish" | "cephalopod" | "crustacean">()
    .notNull(),
  identificationLevel: text("identification_level")
    .$type<"species_name" | "aggregate" | "unresolved">()
    .notNull(),
  reviewStatus: text("review_status").notNull(),
  localPresenceStatus: text("local_presence_status").notNull(),
  initialSelection: integer("initial_selection").notNull(),
  notes: text("notes").notNull(),
});
export const names = sqliteTable("names", {
  taxonId: text("taxon_id")
    .notNull()
    .references(() => taxa.id),
  language: text("language").$type<"gl" | "es" | "la">().notNull(),
  name: text("name").notNull(),
  searchKey: text("search_key").notNull(),
  sourceId: text("source_id").notNull(),
  isPrimary: integer("is_primary").notNull(),
});
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<"admin" | "member">().notNull(),
  active: integer("active").notNull(),
  createdAt: text("created_at").notNull(),
});
export const profiles = sqliteTable("taxon_profiles", {
  taxonId: text("taxon_id")
    .primaryKey()
    .references(() => taxa.id),
  active: integer("active").notNull(),
  descriptionGl: text("description_gl").notNull(),
  descriptionEs: text("description_es").notNull(),
  tipsGl: text("tips_gl").notNull(),
  tipsEs: text("tips_es").notNull(),
  taxonomicClass: text("taxonomic_class").notNull(),
  taxonomicOrder: text("taxonomic_order").notNull(),
  family: text("family").notNull(),
  sizeStatus: text("size_status")
    .$type<"pending" | "has_minimum" | "confirmed_no_minimum">()
    .notNull(),
  minimumCm: real("minimum_cm"),
  minimumSource: text("minimum_source").notNull(),
  minimumReviewedAt: text("minimum_reviewed_at"),
  minimumReviewedBy: text("minimum_reviewed_by").references(() => users.id),
  revision: integer("revision").notNull(),
});
