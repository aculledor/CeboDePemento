import Database from "better-sqlite3";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { root, settings } from "../config.js";
import { openDatabase, migrate } from "../database.js";
import {
  SourceClient,
  inspectSource,
  verifyPolicy,
  crawlSource,
  saveJson,
  type CrawlResult,
} from "./crawler.js";
import { importRecords, preview } from "./importer.js";
import { recordSchema, type Category } from "./parser.js";
import { downloadAuthorizedImages } from "./images.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    category: { type: "string", default: "all" },
    limit: { type: "string", default: "1000" },
    cache: { type: "string" },
    resume: { type: "string" },
    policy: { type: "string" },
    from: { type: "string" },
    database: { type: "string" },
    "dry-run": { type: "boolean" },
    "download-images": { type: "boolean" },
    actor: { type: "string" },
  },
});
const command = positionals[0] ?? "help";
try {
  if (command === "help")
    console.log(`catalog:import inspect --cache work/pescaderias/revision
catalog:import import --policy policy.json [--category fish|cephalopod|crustacean|all] [--limit 3] [--dry-run]
catalog:import import --resume work/pescaderias/ID --policy policy.json
catalog:import import --from work/pescaderias/ID/checkpoint.json --resume work/pescaderias/ID --policy policy.json
catalog:import images --actor admin
catalog:import results | conflicts
No escribe la base en inspect, results, conflicts o --dry-run. Revisar primero robots y condiciones. No hay autorización predeterminada.`);
  else if (["results", "conflicts"].includes(command)) {
    const db = new Database(
      resolve(root, values.database ?? settings.databasePath),
      { readonly: true, fileMustExist: true },
    );
    try {
      console.log(
        JSON.stringify(
          db
            .prepare(
              command === "results"
                ? "SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 100"
                : "SELECT * FROM import_conflicts WHERE status='pending' ORDER BY created_at LIMIT 500",
            )
            .all(),
          null,
          2,
        ),
      );
    } finally {
      db.close();
    }
  } else if (command === "images") {
    if (!values.actor) throw new Error("--actor administrador requerido");
    const store = openDatabase(
      resolve(root, values.database ?? settings.databasePath),
    );
    try {
      await migrate(store);
      console.log(
        JSON.stringify(
          await downloadAuthorizedImages(store, values.actor),
          null,
          2,
        ),
      );
    } finally {
      store.sqlite.close();
    }
  } else if (command === "inspect" || command === "import") {
    const directory = resolve(
      root,
      values.resume ??
        values.cache ??
        `work/pescaderias/${new Date().toISOString().replaceAll(":", "-")}`,
    );
    mkdirSync(directory, { recursive: true });
    console.error(`Cache/checkpoint: ${directory}`);
    const client = new SourceClient(directory);
    if (command === "inspect")
      console.log(JSON.stringify(await inspectSource(client), null, 2));
    else {
      if (!values.policy)
        throw new Error(
          "--policy requerido: revise robots y condiciones mediante inspect antes de importar",
        );
      const policy = await verifyPolicy(
        client,
        JSON.parse(readFileSync(resolve(root, values.policy), "utf8")),
      );
      const category = z
          .enum(["all", "fish", "cephalopod", "crustacean"])
          .parse(values.category),
        limit = z.coerce.number().int().min(1).max(1000).parse(values.limit);
      const selected: Category[] =
        category === "all" ? ["fish", "cephalopod", "crustacean"] : [category];
      let result: CrawlResult;
      if (values.from) {
        const saved = JSON.parse(
          readFileSync(resolve(root, values.from), "utf8"),
        ) as CrawlResult;
        result = {
          records: z
            .array(recordSchema)
            .max(1000)
            .parse(saved.records)
            .filter((r) => selected.includes(r.category))
            .slice(0, limit),
          found: saved.found,
          errors: saved.errors ?? [],
          partial: saved.partial ?? false,
        };
      } else
        result = await crawlSource(client, policy, selected, limit, (message) =>
          console.error(message),
        );
      saveJson(resolve(directory, "checkpoint.json"), result);
      const path = resolve(root, values.database ?? settings.databasePath);
      if (values["dry-run"]) {
        const db = new Database(
          existsSync(path) ? path : resolve(root, "catalogo.sqlite"),
          { readonly: true, fileMustExist: true },
        );
        try {
          console.log(
            JSON.stringify(
              {
                dryRun: true,
                found: result.found,
                processed: result.records.length,
                errors: result.errors,
                partial: result.partial,
                proposals: preview(db, result.records),
              },
              null,
              2,
            ),
          );
        } finally {
          db.close();
        }
      } else {
        const store = openDatabase(path);
        try {
          await migrate(store);
          const applied = await importRecords(
            store,
            result.records,
            policy,
            {
              category,
              limit,
              directory,
              partial: result.partial,
              errors: result.errors,
            },
            result.found,
          );
          applied.summary.errors = result.errors.length;
          store.sqlite
            .prepare("UPDATE import_runs SET summary_json=? WHERE id=?")
            .run(JSON.stringify(applied.summary), applied.runId);
          console.log(
            JSON.stringify(
              {
                ...applied,
                partial: result.partial,
                sourceErrors: result.errors,
              },
              null,
              2,
            ),
          );
          if (values["download-images"]) {
            if (!values.actor)
              throw new Error(
                "--actor administrador requerido para descargar imágenes autorizadas",
              );
            console.log(await downloadAuthorizedImages(store, values.actor));
          }
        } finally {
          store.sqlite.close();
        }
      }
      if (result.errors.length) process.exitCode = 2;
    }
  } else throw new Error("Comando desconocido; use help");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
