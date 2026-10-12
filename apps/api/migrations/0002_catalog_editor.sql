INSERT INTO sources VALUES ('admin', 'Edición manual del catálogo', '', date('now'), 'Cambios editoriales auditados; referencias internas de competición.');
CREATE TABLE taxon_profiles (
 taxon_id TEXT PRIMARY KEY REFERENCES taxa(id), active INTEGER NOT NULL CHECK(active IN (0,1)),
 description_gl TEXT NOT NULL DEFAULT '', description_es TEXT NOT NULL DEFAULT '',
 tips_gl TEXT NOT NULL DEFAULT '', tips_es TEXT NOT NULL DEFAULT '',
 taxonomic_class TEXT NOT NULL DEFAULT '', taxonomic_order TEXT NOT NULL DEFAULT '', family TEXT NOT NULL DEFAULT '',
 size_status TEXT NOT NULL DEFAULT 'pending' CHECK(size_status IN ('pending','has_minimum','confirmed_no_minimum')),
 minimum_cm REAL CHECK(minimum_cm>0), minimum_source TEXT NOT NULL DEFAULT '', minimum_reviewed_at TEXT,
 minimum_reviewed_by TEXT REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 1,
 CHECK((size_status='has_minimum' AND minimum_cm IS NOT NULL) OR (size_status<>'has_minimum' AND minimum_cm IS NULL))
);
INSERT INTO taxon_profiles(taxon_id,active) SELECT id,initial_selection FROM taxa;
