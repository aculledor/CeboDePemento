import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root, settings } from './config.js';
import * as schema from './schema.js';

export function openDatabase(path = settings.databasePath) {
  if (resolve(path) === resolve(root,'catalogo.sqlite')) throw new Error('Refusing to modify the original catalog');
  mkdirSync(dirname(path),{recursive:true});
  if (!existsSync(path)) {
    const source = new Database(resolve(root,'catalogo.sqlite'),{readonly:true,fileMustExist:true});
    try { assertIntegrity(source); source.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`); }
    catch(error) { if(existsSync(path)) unlinkSync(path); throw error; }
    finally { source.close(); }
  }
  const sqlite = new Database(path);
  try { sqlite.pragma('foreign_keys = ON'); sqlite.pragma('busy_timeout = 5000'); assertIntegrity(sqlite); sqlite.pragma('journal_mode = WAL'); return { sqlite, db:drizzle(sqlite,{schema}), path }; }
  catch(error) { sqlite.close(); throw error; }
}
export type Store = ReturnType<typeof openDatabase>;
export function assertIntegrity(sqlite: Database.Database) {
  if (sqlite.pragma('integrity_check',{simple:true}) !== 'ok' || (sqlite.pragma('foreign_key_check') as unknown[]).length) throw new Error('SQLite integrity check failed');
}
export async function backupDatabase(store: Store, directory = resolve(root,'data/backups')) {
  mkdirSync(directory,{recursive:true});
  const path = resolve(directory, `catalogo-${new Date().toISOString().replaceAll(':','-')}-${crypto.randomUUID()}.sqlite`);
  await store.sqlite.backup(path);
  const copy = new Database(path,{readonly:true}); try { assertIntegrity(copy); } finally { copy.close(); }
  return path;
}
export async function migrate(store: Store) {
  const dir = resolve(root,'apps/api/migrations');
  const hasHistory = store.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_migrations'").get();
  const applied = hasHistory ? store.sqlite.prepare('SELECT * FROM app_migrations').all() as {name:string;checksum:string}[] : [];
  const files = readdirSync(dir).filter(x=>/^\d+.*\.sql$/.test(x)).sort();
  const pending: {name:string;sql:string;checksum:string}[] = [];
  for (const name of files) {
    const sql=readFileSync(resolve(dir,name),'utf8'), checksum=createHash('sha256').update(sql).digest('hex'), previous=applied.find(x=>x.name===name);
    if(previous && previous.checksum!==checksum) throw new Error(`Modified applied migration: ${name}`);
    if(!previous) pending.push({name,sql,checksum});
  }
  if(!pending.length) return;
  await backupDatabase(store);
  store.sqlite.transaction(()=>{
    store.sqlite.exec('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    for(const item of pending){store.sqlite.exec(item.sql);store.sqlite.prepare('INSERT INTO app_migrations VALUES (?,?,?)').run(item.name,item.checksum,new Date().toISOString());}
    assertIntegrity(store.sqlite);
  })();
}
