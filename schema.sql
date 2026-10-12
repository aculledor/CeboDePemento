
PRAGMA foreign_keys=ON;
CREATE TABLE sources(id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, retrieved_on TEXT NOT NULL, scope_note TEXT NOT NULL);
CREATE TABLE taxa(
 id TEXT PRIMARY KEY, scientific_name TEXT UNIQUE, category TEXT NOT NULL CHECK(category IN ('fish','cephalopod','crustacean')),
 identification_level TEXT NOT NULL CHECK(identification_level IN ('species_name','aggregate','unresolved')),
 review_status TEXT NOT NULL DEFAULT 'pending', local_presence_status TEXT NOT NULL DEFAULT 'not_verified',
 legal_status TEXT NOT NULL DEFAULT 'not_reviewed', minimum_size_status TEXT NOT NULL DEFAULT 'not_reviewed',
 initial_selection INTEGER NOT NULL DEFAULT 0 CHECK(initial_selection IN (0,1)), notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE names(taxon_id TEXT NOT NULL REFERENCES taxa(id), language TEXT NOT NULL CHECK(language IN ('gl','es','la')),
 name TEXT NOT NULL, search_key TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id), is_primary INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(taxon_id,language,name));
CREATE INDEX names_search ON names(search_key);
CREATE TABLE evidence(taxon_id TEXT NOT NULL REFERENCES taxa(id), source_id TEXT NOT NULL REFERENCES sources(id),
 source_record_id TEXT NOT NULL, scientific_name_as_reported TEXT, note TEXT NOT NULL, PRIMARY KEY(taxon_id,source_id,source_record_id));
CREATE TABLE scoring_templates(id TEXT PRIMARY KEY, name_gl TEXT NOT NULL, name_es TEXT NOT NULL, points_below INTEGER NOT NULL, points_legal INTEGER NOT NULL);
CREATE TABLE template_members(taxon_id TEXT PRIMARY KEY REFERENCES taxa(id), template_id TEXT NOT NULL REFERENCES scoring_templates(id));
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE VIEW initial_catalog AS SELECT * FROM taxa WHERE initial_selection=1;
CREATE VIEW pending_catalog AS SELECT * FROM taxa WHERE initial_selection=0;
