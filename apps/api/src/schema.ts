import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const taxa = sqliteTable('taxa', {
  id:text('id').primaryKey(), scientificName:text('scientific_name'), category:text('category').$type<'fish'|'cephalopod'|'crustacean'>().notNull(),
  identificationLevel:text('identification_level').$type<'species_name'|'aggregate'|'unresolved'>().notNull(), reviewStatus:text('review_status').notNull(), localPresenceStatus:text('local_presence_status').notNull(),
  initialSelection:integer('initial_selection').notNull(), notes:text('notes').notNull()
});
export const names = sqliteTable('names', {taxonId:text('taxon_id').notNull().references(()=>taxa.id), language:text('language').$type<'gl'|'es'|'la'>().notNull(), name:text('name').notNull(), searchKey:text('search_key').notNull(), sourceId:text('source_id').notNull(), isPrimary:integer('is_primary').notNull()});
