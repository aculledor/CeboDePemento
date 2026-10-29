INSERT INTO sources VALUES ('pescaderias', 'pescadeRías · Xunta de Galicia', 'https://deondesenon.xunta.gal/es/productos-de-la-marca/que-productos-me-ofrece-la-marca', date('now'), 'Catálogo de productos comercializados. No acredita presencia local, permiso recreativo ni talla legal vigente.');
CREATE TABLE import_runs (
 id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('running','interrupted','completed','failed')),
 started_at TEXT NOT NULL, finished_at TEXT, options_json TEXT NOT NULL, policy_json TEXT NOT NULL,
 summary_json TEXT NOT NULL DEFAULT '{}', backup_path TEXT NOT NULL, error TEXT
);
CREATE TABLE import_records (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), external_id TEXT NOT NULL,
 taxon_id TEXT REFERENCES taxa(id), category TEXT NOT NULL CHECK(category IN ('fish','cephalopod','crustacean')),
 url TEXT NOT NULL, fao_code TEXT, scientific_name TEXT, payload_json TEXT NOT NULL, content_hash TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, match_kind TEXT NOT NULL,
 review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','verified','conflict','rejected')),
 first_run_id TEXT NOT NULL REFERENCES import_runs(id), last_run_id TEXT NOT NULL REFERENCES import_runs(id),
 retrieved_at TEXT NOT NULL, UNIQUE(source_id,external_id)
);
CREATE TABLE import_observations (
 run_id TEXT NOT NULL REFERENCES import_runs(id), record_id TEXT NOT NULL REFERENCES import_records(id),
 retrieved_at TEXT NOT NULL, content_hash TEXT NOT NULL, outcome TEXT NOT NULL,
 PRIMARY KEY(run_id,record_id)
);
CREATE TABLE import_record_versions (
 id INTEGER PRIMARY KEY, record_id TEXT NOT NULL REFERENCES import_records(id), content_hash TEXT NOT NULL,
 payload_json TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES import_runs(id), retrieved_at TEXT NOT NULL,
 UNIQUE(record_id,content_hash)
);
CREATE TABLE external_taxon_ids (
 source_id TEXT NOT NULL REFERENCES sources(id), external_id TEXT NOT NULL,
 taxon_id TEXT NOT NULL REFERENCES taxa(id), fao_code TEXT, url TEXT NOT NULL,
 PRIMARY KEY(source_id,external_id)
);
CREATE INDEX external_taxon_fao ON external_taxon_ids(fao_code);
CREATE TABLE catalog_manual_fields (
 taxon_id TEXT NOT NULL REFERENCES taxa(id), field TEXT NOT NULL, edited_by TEXT REFERENCES users(id), edited_at TEXT NOT NULL,
 PRIMARY KEY(taxon_id,field)
);
-- Conservatively protect all fields in existing manual edits, including intentional blanks.
INSERT OR IGNORE INTO catalog_manual_fields
 SELECT a.entity_id,j.key,a.actor_id,a.created_at FROM audit_log a, json_each(a.after_json) j
 WHERE a.entity_type='taxon' AND a.action IN ('taxon.created','taxon.updated') AND EXISTS(SELECT 1 FROM taxa t WHERE t.id=a.entity_id)
 ORDER BY a.id DESC;
CREATE TABLE import_conflicts (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES import_records(id), kind TEXT NOT NULL, field TEXT NOT NULL,
 fingerprint TEXT NOT NULL, current_json TEXT NOT NULL, proposed_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','rejected')),
 created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT REFERENCES users(id), resolution_json TEXT,
 UNIQUE(record_id,kind,field,fingerprint)
);
CREATE TABLE taxon_size_references (
 id TEXT PRIMARY KEY, taxon_id TEXT NOT NULL REFERENCES taxa(id), record_id TEXT REFERENCES import_records(id),
 source_key TEXT NOT NULL, value REAL CHECK(value>0), unit TEXT, measurement_method TEXT,
 literal TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'source_reference_recreational_unvalidated',
 source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL,
 verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','approved','rejected')),
 manually_edited INTEGER NOT NULL DEFAULT 0 CHECK(manually_edited IN (0,1)),
 reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(record_id,source_key), CHECK((value IS NULL)=(unit IS NULL))
);
CREATE TABLE taxon_source_descriptions (
 record_id TEXT NOT NULL REFERENCES import_records(id), language TEXT NOT NULL CHECK(language IN ('gl','es')),
 fields_json TEXT NOT NULL, permission_json TEXT NOT NULL, content_hash TEXT NOT NULL,
 PRIMARY KEY(record_id,language)
);
CREATE TABLE taxon_source_images (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES import_records(id), taxon_id TEXT NOT NULL REFERENCES taxa(id),
 original_url TEXT NOT NULL, page_url TEXT NOT NULL, image_type TEXT NOT NULL,
 author TEXT, license TEXT, license_url TEXT, rights_evidence TEXT,
 authorization TEXT NOT NULL CHECK(authorization IN ('pending','authorized','rejected','downloaded')),
 retrieved_at TEXT NOT NULL, photo_id TEXT REFERENCES photos(id), revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(record_id,original_url)
);
CREATE INDEX import_review ON import_records(review_status,retrieved_at);
CREATE INDEX import_conflict_status ON import_conflicts(status,record_id);
