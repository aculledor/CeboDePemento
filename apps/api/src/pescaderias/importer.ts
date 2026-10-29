import type Database from "better-sqlite3";
import { normalizeSearch } from "@cebo/shared";
import { assertIntegrity, backupDatabase, type Store } from "../database.js";
import {
  contentHash,
  digest,
  isGeneric,
  safeUrl,
  recordSchema,
  type SourceRecord,
  type Policy,
} from "./parser.js";

interface TaxonRow {
  id: string;
  scientific_name: string | null;
  category: string;
  identification_level: string;
}
export interface Match {
  kind: "exact" | "fao" | "synonym" | "new" | "conflict";
  taxonId: string | null;
  candidates: string[];
  reason?: string;
}
const hasTable = (db: Database.Database, name: string) =>
  !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
export function reconcile(db: Database.Database, record: SourceRecord): Match {
  const taxa = db
    .prepare(
      "SELECT id,scientific_name,category,identification_level FROM taxa",
    )
    .all() as TaxonRow[];
  const aliases = db
    .prepare("SELECT taxon_id,name FROM names WHERE language='la'")
    .all() as { taxon_id: string; name: string }[];
  const scientific = normalizeSearch(record.scientificName ?? "");
  const exact = taxa.filter(
    (t) =>
      scientific && normalizeSearch(t.scientific_name ?? "") === scientific,
  );
  const synonyms = aliases
    .filter((n) => scientific && normalizeSearch(n.name) === scientific)
    .map((n) => n.taxon_id);
  const fao = new Set<string>();
  if (record.faoCode) {
    for (const e of db
      .prepare(
        "SELECT DISTINCT taxon_id FROM evidence WHERE source_id='xunta' AND source_record_id=?",
      )
      .all(record.faoCode) as { taxon_id: string }[])
      fao.add(e.taxon_id);
    if (hasTable(db, "external_taxon_ids"))
      for (const e of db
        .prepare(
          "SELECT DISTINCT taxon_id FROM external_taxon_ids WHERE fao_code=?",
        )
        .all(record.faoCode) as { taxon_id: string }[])
        fao.add(e.taxon_id);
  }
  const previous = hasTable(db, "external_taxon_ids")
    ? (db
        .prepare(
          "SELECT taxon_id FROM external_taxon_ids WHERE source_id='pescaderias' AND external_id=?",
        )
        .get(record.externalId) as { taxon_id: string } | undefined)
    : undefined;
  const conflict = (candidates: string[], reason: string): Match => ({
    kind: "conflict",
    taxonId: previous?.taxon_id ?? null,
    candidates: [...new Set(candidates)],
    reason,
  });
  let ids = exact.map((t) => t.id),
    kind: Match["kind"] = "exact";
  if (!ids.length && fao.size) {
    ids = [...fao];
    kind = "fao";
  }
  if (!ids.length && synonyms.length) {
    ids = [...new Set(synonyms)];
    kind = "synonym";
  }
  if (ids.length) {
    if (ids.length !== 1) return conflict(ids, "AMBIGUOUS_TAXON");
    const id = ids[0]!,
      row = taxa.find((t) => t.id === id)!;
    if (previous && previous.taxon_id !== id)
      return conflict([previous.taxon_id, id], "EXTERNAL_ID_CHANGED_TAXON");
    if (row.category !== record.category)
      return conflict([id], "CATEGORY_DISCREPANCY");
    if (fao.size && (!fao.has(id) || fao.size > 1))
      return conflict([id, ...fao], "FAO_DISCREPANCY");
    if (
      kind === "fao" &&
      scientific &&
      normalizeSearch(row.scientific_name ?? "") !== scientific &&
      !synonyms.includes(id)
    )
      return conflict([id], "FAO_TAXONOMIC_DISCREPANCY");
    if (
      isGeneric(record.scientificName) &&
      row.identification_level === "species_name"
    )
      return conflict([id], "GENERIC_MUST_NOT_BECOME_SPECIES");
    return { kind, taxonId: id, candidates: [id] };
  }
  if (previous)
    return conflict([previous.taxon_id], "EXTERNAL_ID_SCIENTIFIC_CHANGE");
  // Common names only propose candidates. They never establish an automatic identity.
  const keys = [...record.names.gl, ...record.names.es].map(normalizeSearch);
  const common = (
    db
      .prepare(
        "SELECT taxon_id,search_key FROM names WHERE language IN ('gl','es')",
      )
      .all() as { taxon_id: string; search_key: string }[]
  )
    .filter((n) => keys.includes(n.search_key))
    .map((n) => n.taxon_id);
  if (common.length) return conflict(common, "COMMON_NAME_REQUIRES_REVIEW");
  if (!record.scientificName || isGeneric(record.scientificName))
    return conflict([], "UNRESOLVED_IDENTIFICATION");
  return { kind: "new", taxonId: null, candidates: [] };
}
export interface ImportSummary {
  found: number;
  processed: number;
  newSpecies: number;
  updatedSpecies: number;
  matches: number;
  unchanged: number;
  conflicts: number;
  errors: number;
  sizes: number;
  reusableImages: number;
  pendingImages: number;
}
export const emptySummary = (found = 0): ImportSummary => ({
  found,
  processed: 0,
  newSpecies: 0,
  updatedSpecies: 0,
  matches: 0,
  unchanged: 0,
  conflicts: 0,
  errors: 0,
  sizes: 0,
  reusableImages: 0,
  pendingImages: 0,
});
export function addConflict(
  db: Database.Database,
  recordId: string,
  kind: string,
  field: string,
  current: unknown,
  proposed: unknown,
) {
  const fingerprint = digest(JSON.stringify({ current, proposed })),
    id = `ic_${digest(recordId + kind + field + fingerprint).slice(0, 32)}`;
  db.prepare(
    "INSERT OR IGNORE INTO import_conflicts(id,record_id,kind,field,fingerprint,current_json,proposed_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    id,
    recordId,
    kind,
    field,
    fingerprint,
    JSON.stringify(current),
    JSON.stringify(proposed),
    new Date().toISOString(),
  );
}
export function markManualFields(
  db: Database.Database,
  id: string,
  actorId: string,
  before: unknown,
  after: unknown,
) {
  const previous = (before ?? {}) as Record<string, unknown>;
  for (const [field, value] of Object.entries(
    after as Record<string, unknown>,
  )) {
    if (
      ["revision", "minimumReviewedBy", "primaryPhotoId"].includes(field) ||
      JSON.stringify(previous[field]) === JSON.stringify(value)
    )
      continue;
    db.prepare(
      "INSERT INTO catalog_manual_fields VALUES (?,?,?,?) ON CONFLICT(taxon_id,field) DO UPDATE SET edited_by=excluded.edited_by,edited_at=excluded.edited_at",
    ).run(id, field, actorId, new Date().toISOString());
  }
}
function enrich(
  db: Database.Database,
  record: SourceRecord,
  recordId: string,
  taxonId: string,
  policy: Policy,
) {
  let changed = false;
  const locked = (field: string) =>
    !!db
      .prepare(
        "SELECT 1 FROM catalog_manual_fields WHERE taxon_id=? AND field=?",
      )
      .get(taxonId, field);
  const names = db
    .prepare("SELECT language,name FROM names WHERE taxon_id=?")
    .all(taxonId) as { language: string; name: string }[];
  for (const language of ["gl", "es"] as const)
    for (const name of record.names[language]) {
      if (
        names.some(
          (n) =>
            n.language === language &&
            normalizeSearch(n.name) === normalizeSearch(name),
        )
      )
        continue;
      if (locked("names")) {
        addConflict(
          db,
          recordId,
          "manual_priority",
          `names.${language}`,
          names.filter((n) => n.language === language),
          name,
        );
        continue;
      }
      const primary = names.some((n) => n.language === language) ? 0 : 1;
      db.prepare("INSERT OR IGNORE INTO names VALUES (?,?,?,?,?,?)").run(
        taxonId,
        language,
        name,
        normalizeSearch(name),
        "pescaderias",
        primary,
      );
      names.push({ language, name });
      changed = true;
    }
  const profile = db
    .prepare(
      "SELECT description_gl,description_es FROM taxon_profiles WHERE taxon_id=?",
    )
    .get(taxonId) as { description_gl: string; description_es: string };
  for (const language of ["gl", "es"] as const) {
    const text = Object.values(record.descriptions[language]).join("\n\n");
    db.prepare(
      "INSERT INTO taxon_source_descriptions VALUES (?,?,?,?,?) ON CONFLICT(record_id,language) DO UPDATE SET fields_json=excluded.fields_json,permission_json=excluded.permission_json,content_hash=excluded.content_hash",
    ).run(
      recordId,
      language,
      JSON.stringify(record.descriptions[language]),
      JSON.stringify({
        allowed: policy.descriptionsReuseAllowed,
        evidence: policy.evidence,
        reviewedBy: policy.reviewedBy,
      }),
      digest(text),
    );
    if (!text || !policy.descriptionsReuseAllowed) continue;
    const column = language === "gl" ? "description_gl" : "description_es",
      field = language === "gl" ? "descriptionGl" : "descriptionEs";
    if (profile[column] === text) continue;
    if (profile[column] || locked(field)) {
      addConflict(
        db,
        recordId,
        "description_difference",
        field,
        profile[column],
        text,
      );
      continue;
    }
    db.prepare(`UPDATE taxon_profiles SET ${column}=? WHERE taxon_id=?`).run(
      text,
      taxonId,
    );
    changed = true;
  }
  for (const size of record.sizes) {
    const key = digest(JSON.stringify(size)),
      id = `size_${digest(recordId + key).slice(0, 32)}`;
    db.prepare(
      "INSERT OR IGNORE INTO taxon_size_references(id,taxon_id,record_id,source_key,value,unit,measurement_method,literal,source_url,retrieved_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      taxonId,
      recordId,
      key,
      size.value,
      size.unit,
      size.method,
      size.literal,
      record.url,
      record.retrievedAt,
    );
  }
  for (const image of record.images) {
    const id = `img_${digest(recordId + image.url).slice(0, 32)}`;
    const old = db
      .prepare("SELECT * FROM taxon_source_images WHERE id=?")
      .get(id) as
      | { author: string | null; license: string | null; authorization: string }
      | undefined;
    if (old) {
      if (old.author !== image.author || old.license !== image.license) {
        addConflict(db, recordId, "image_rights_change", "image", old, image);
        db.prepare(
          "UPDATE taxon_source_images SET authorization='pending',revision=revision+1 WHERE id=? AND photo_id IS NULL AND authorization<>'rejected'",
        ).run(id);
      }
      continue;
    }
    db.prepare(
      "INSERT INTO taxon_source_images(id,record_id,taxon_id,original_url,page_url,image_type,author,license,license_url,rights_evidence,authorization,retrieved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      recordId,
      taxonId,
      image.url,
      image.pageUrl,
      image.type,
      image.author,
      image.license,
      image.licenseUrl,
      image.rightsEvidence,
      image.authorization,
      record.retrievedAt,
    );
  }
  if (changed)
    db.prepare(
      "UPDATE taxon_profiles SET revision=revision+1 WHERE taxon_id=?",
    ).run(taxonId);
  db.prepare(
    "INSERT OR IGNORE INTO evidence VALUES (?, 'pescaderias', ?, ?, ?)",
  ).run(
    taxonId,
    record.externalId,
    record.scientificName,
    `Ficha comercial: ${record.url}. No valida presencia ni talla recreativa.`,
  );
  return changed;
}
export function applyRecord(
  db: Database.Database,
  input: SourceRecord,
  runId: string,
  policy: Policy,
  summary: ImportSummary,
) {
  const record = recordSchema.parse(input);
  safeUrl(record.url);
  for (const image of record.images) {
    safeUrl(image.url);
    safeUrl(image.pageUrl);
  }
  if (!policy.descriptionsReuseAllowed)
    record.descriptions = { gl: {}, es: {} };
  if (!policy.imagesReuseAllowed)
    for (const image of record.images) image.authorization = "pending";
  const hash = contentHash(record),
    recordId = `pdr_${digest(record.externalId).slice(0, 32)}`;
  const old = db
    .prepare("SELECT * FROM import_records WHERE id=?")
    .get(recordId) as
    | {
        taxon_id: string | null;
        content_hash: string;
        payload_json: string;
        review_status: string;
      }
    | undefined;
  // An unchanged source is observed, but cannot undo a later manual edit.
  if (old?.content_hash === hash) {
    db.prepare(
      "INSERT OR IGNORE INTO import_observations VALUES (?,?,?,?,?)",
    ).run(runId, recordId, record.retrievedAt, hash, "unchanged");
    summary.processed++;
    summary.unchanged++;
    return;
  }
  if (old?.review_status === "rejected") {
    db.prepare(
      "UPDATE import_records SET payload_json=?,content_hash=?,last_run_id=?,retrieved_at=?,revision=revision+1 WHERE id=?",
    ).run(JSON.stringify(record), hash, runId, record.retrievedAt, recordId);
    db.prepare(
      "INSERT OR IGNORE INTO import_record_versions(record_id,content_hash,payload_json,run_id,retrieved_at) VALUES (?,?,?,?,?)",
    ).run(recordId, hash, JSON.stringify(record), runId, record.retrievedAt);
    db.prepare(
      "INSERT OR IGNORE INTO import_observations VALUES (?,?,?,?,?)",
    ).run(runId, recordId, record.retrievedAt, hash, "rejected");
    addConflict(
      db,
      recordId,
      "rejected_source_changed",
      "source",
      JSON.parse(old.payload_json),
      record,
    );
    summary.processed++;
    return;
  }
  const match = reconcile(db, record);
  let taxonId = match.taxonId;
  if (match.kind === "new") {
    taxonId = `pescaderias_${digest(record.externalId).slice(0, 20)}`;
    db.prepare(
      "INSERT INTO taxa(id,scientific_name,category,identification_level) VALUES (?,?,?,'species_name')",
    ).run(taxonId, record.scientificName, record.category);
    db.prepare("INSERT INTO taxon_profiles(taxon_id,active) VALUES (?,0)").run(
      taxonId,
    );
    db.prepare("INSERT INTO names VALUES (?,'la',?,?, 'pescaderias',0)").run(
      taxonId,
      record.scientificName,
      normalizeSearch(record.scientificName!),
    );
    summary.newSpecies++;
  } else if (match.kind !== "conflict") summary.matches++;
  db.prepare(
    "INSERT INTO import_records(id,source_id,external_id,taxon_id,category,url,fao_code,scientific_name,payload_json,content_hash,match_kind,review_status,first_run_id,last_run_id,retrieved_at) VALUES (?,'pescaderias',?,?,?,?,?,?,?,?,?,?,?, ?,?) ON CONFLICT(id) DO UPDATE SET taxon_id=excluded.taxon_id,url=excluded.url,fao_code=excluded.fao_code,scientific_name=excluded.scientific_name,payload_json=excluded.payload_json,content_hash=excluded.content_hash,match_kind=excluded.match_kind,review_status=excluded.review_status,last_run_id=excluded.last_run_id,retrieved_at=excluded.retrieved_at,revision=import_records.revision+1",
  ).run(
    recordId,
    record.externalId,
    taxonId,
    record.category,
    record.url,
    record.faoCode,
    record.scientificName,
    JSON.stringify(record),
    hash,
    match.kind,
    match.kind === "conflict" ? "conflict" : "pending",
    runId,
    runId,
    record.retrievedAt,
  );
  db.prepare(
    "INSERT OR IGNORE INTO import_record_versions(record_id,content_hash,payload_json,run_id,retrieved_at) VALUES (?,?,?,?,?)",
  ).run(recordId, hash, JSON.stringify(record), runId, record.retrievedAt);
  if (match.kind === "conflict") {
    addConflict(
      db,
      recordId,
      match.reason ?? "identity",
      "identity",
      { taxonId: old?.taxon_id ?? null, candidates: match.candidates },
      record,
    );
    summary.conflicts++;
  } else if (taxonId) {
    db.prepare(
      "INSERT INTO external_taxon_ids VALUES ('pescaderias',?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET fao_code=excluded.fao_code,url=excluded.url",
    ).run(record.externalId, taxonId, record.faoCode, record.url);
    if (old)
      addConflict(
        db,
        recordId,
        "source_changed",
        "source",
        JSON.parse(old.payload_json),
        record,
      );
    const changed = enrich(db, record, recordId, taxonId, policy);
    if (changed && match.kind !== "new") summary.updatedSpecies++;
    summary.sizes += record.sizes.length;
    summary.reusableImages += record.images.filter(
      (i) => i.authorization === "authorized",
    ).length;
    summary.pendingImages += record.images.filter(
      (i) => i.authorization === "pending",
    ).length;
    db.prepare(
      "INSERT INTO audit_log(actor_id,action,entity_type,entity_id,before_json,after_json,created_at) VALUES (NULL,'taxon.imported','taxon',?,?,?,?)",
    ).run(
      taxonId,
      old?.payload_json ?? "null",
      JSON.stringify({
        recordId,
        runId,
        match: match.kind,
        source: record.url,
      }),
      new Date().toISOString(),
    );
  }
  db.prepare(
    "INSERT OR IGNORE INTO import_observations VALUES (?,?,?,?,?)",
  ).run(runId, recordId, record.retrievedAt, hash, match.kind);
  summary.processed++;
}
export async function importRecords(
  store: Store,
  records: SourceRecord[],
  policy: Policy,
  options: unknown,
  found = records.length,
  runId = crypto.randomUUID(),
) {
  const backup = await backupDatabase(store),
    summary = emptySummary(found);
  store.sqlite
    .prepare(
      "INSERT INTO import_runs(id,status,started_at,options_json,policy_json,backup_path) VALUES (?,'running',?,?,?,?)",
    )
    .run(
      runId,
      new Date().toISOString(),
      JSON.stringify(options),
      JSON.stringify(policy),
      backup,
    );
  try {
    // A batch is atomic: a SQL failure rolls back every species, reference, image and observation.
    store.sqlite.transaction(() => {
      const prior = (
        store.sqlite
          .prepare("SELECT count(*) n FROM import_conflicts")
          .get() as { n: number }
      ).n;
      for (const record of records)
        applyRecord(store.sqlite, record, runId, policy, summary);
      summary.conflicts =
        (
          store.sqlite
            .prepare("SELECT count(*) n FROM import_conflicts")
            .get() as { n: number }
        ).n - prior;
      assertIntegrity(store.sqlite);
      store.sqlite
        .prepare(
          "UPDATE import_runs SET status='completed',finished_at=?,summary_json=? WHERE id=?",
        )
        .run(new Date().toISOString(), JSON.stringify(summary), runId);
    })();
  } catch (error) {
    store.sqlite
      .prepare(
        "UPDATE import_runs SET status='failed',finished_at=?,error=? WHERE id=?",
      )
      .run(new Date().toISOString(), String(error), runId);
    throw error;
  }
  return { runId, backup, summary };
}
export function preview(db: Database.Database, records: SourceRecord[]) {
  return records.map((record) => ({
    externalId: record.externalId,
    scientificName: record.scientificName,
    match: reconcile(db, record),
    sizes: record.sizes,
    images: {
      authorized: record.images.filter((x) => x.authorization === "authorized")
        .length,
      pending: record.images.filter((x) => x.authorization === "pending")
        .length,
    },
  }));
}
export { enrich as enrichReviewedRecord };
