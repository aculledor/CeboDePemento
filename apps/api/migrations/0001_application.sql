CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','member')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE registration_invitations (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL,
 used_by TEXT REFERENCES users(id), used_at TEXT, revoked_at TEXT,
 CHECK((used_by IS NULL)=(used_at IS NULL))
);
CREATE TABLE auth_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE recovery_tokens (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE audit_log (
 id INTEGER PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL,
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX audit_entity ON audit_log(entity_type, entity_id, id);
CREATE TABLE idempotency (
 actor_id TEXT NOT NULL REFERENCES users(id), operation_id TEXT NOT NULL,
 route TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(actor_id,operation_id)
);
CREATE TABLE zones (
 id TEXT PRIMARY KEY, name_gl TEXT NOT NULL, name_es TEXT NOT NULL,
 description_gl TEXT NOT NULL DEFAULT '', description_es TEXT NOT NULL DEFAULT '',
 latitude REAL CHECK(latitude BETWEEN -90 AND 90), longitude REAL CHECK(longitude BETWEEN -180 AND 180),
 source TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), revision INTEGER NOT NULL DEFAULT 1,
 CHECK((latitude IS NULL)=(longitude IS NULL))
);
CREATE TABLE fishing_sessions (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), proposed_by TEXT NOT NULL REFERENCES users(id),
 start_at TEXT NOT NULL, end_at TEXT, timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
 zone_id TEXT REFERENCES zones(id), privacy TEXT NOT NULL CHECK(privacy IN ('private','general','exact')),
 latitude REAL CHECK(latitude BETWEEN -90 AND 90), longitude REAL CHECK(longitude BETWEEN -180 AND 180),
 notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 approved_at TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
 CHECK(end_at IS NULL OR end_at>=start_at), CHECK((latitude IS NULL)=(longitude IS NULL))
);
CREATE INDEX fishing_owner_time ON fishing_sessions(owner_id,start_at);
CREATE TABLE capture_batches (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES fishing_sessions(id),
 taxon_id TEXT NOT NULL REFERENCES taxa(id), caught_at TEXT NOT NULL, civil_date TEXT NOT NULL, fishing_day TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0), qualifying INTEGER CHECK(qualifying>=0 AND qualifying<=quantity),
 retained INTEGER NOT NULL CHECK(retained>=0 AND retained<=quantity),
 total_weight_kg REAL CHECK(total_weight_kg>=0), max_length_cm REAL CHECK(max_length_cm>=0),
 max_weight_kg REAL CHECK(max_weight_kg>=0),
 size_status_snapshot TEXT NOT NULL CHECK(size_status_snapshot IN ('pending','has_minimum','confirmed_no_minimum')),
 minimum_cm_snapshot REAL, declared_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 CHECK(total_weight_kg IS NULL OR max_weight_kg IS NULL OR max_weight_kg<=total_weight_kg)
);
CREATE INDEX capture_time ON capture_batches(caught_at,taxon_id);
CREATE TABLE photos (
 id TEXT PRIMARY KEY, taxon_id TEXT REFERENCES taxa(id), capture_id TEXT REFERENCES capture_batches(id),
 uploaded_by TEXT NOT NULL REFERENCES users(id), original_url TEXT NOT NULL,
 author TEXT NOT NULL, license TEXT NOT NULL, license_url TEXT NOT NULL,
 local_file TEXT, thumbnail_file TEXT, downloaded_at TEXT, status TEXT NOT NULL CHECK(status IN ('candidate','approved','rejected')),
 is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)), modifications TEXT NOT NULL DEFAULT '',
 CHECK((taxon_id IS NULL)<>(capture_id IS NULL))
);
CREATE UNIQUE INDEX primary_species_photo ON photos(taxon_id) WHERE is_primary=1 AND status='approved';
CREATE TABLE leagues (
 id TEXT PRIMARY KEY, created_by TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 visibility TEXT NOT NULL CHECK(visibility IN ('open','private')),
 first_day TEXT NOT NULL, last_day TEXT NOT NULL, start_at TEXT NOT NULL, end_exclusive_at TEXT NOT NULL,
 current_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, CHECK(last_day>=first_day), CHECK(end_exclusive_at>start_at)
);
CREATE TABLE league_members (
 league_id TEXT NOT NULL REFERENCES leagues(id), user_id TEXT NOT NULL REFERENCES users(id),
 joined_at TEXT NOT NULL, PRIMARY KEY(league_id,user_id)
);
CREATE TABLE league_invitations (
 id TEXT PRIMARY KEY, league_id TEXT NOT NULL REFERENCES leagues(id), token_hash TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL, used_by TEXT REFERENCES users(id), used_at TEXT
);
CREATE TABLE league_rule_versions (
 league_id TEXT NOT NULL REFERENCES leagues(id), version INTEGER NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('simple','custom')), default_points REAL NOT NULL CHECK(default_points>=0),
 allow_ungrouped INTEGER NOT NULL CHECK(allow_ungrouped IN (0,1)), allow_generic INTEGER NOT NULL CHECK(allow_generic IN (0,1)),
 scope_json TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 PRIMARY KEY(league_id,version)
);
CREATE TABLE league_scoring_groups (
 league_id TEXT NOT NULL, version INTEGER NOT NULL, group_id TEXT NOT NULL, name TEXT NOT NULL,
 below_points REAL NOT NULL CHECK(below_points>=0), qualifying_points REAL NOT NULL CHECK(qualifying_points>=0),
 single_points REAL NOT NULL CHECK(single_points>=0), PRIMARY KEY(league_id,version,group_id),
 FOREIGN KEY(league_id,version) REFERENCES league_rule_versions(league_id,version)
);
CREATE TABLE league_group_taxa (
 league_id TEXT NOT NULL, version INTEGER NOT NULL, group_id TEXT NOT NULL, taxon_id TEXT NOT NULL REFERENCES taxa(id),
 PRIMARY KEY(league_id,version,taxon_id),
 FOREIGN KEY(league_id,version,group_id) REFERENCES league_scoring_groups(league_id,version,group_id)
);
