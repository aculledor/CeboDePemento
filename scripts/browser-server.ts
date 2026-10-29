// Isolated browser-test fixture. Never bootstraps an account in the real database.
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase, migrate } from "../apps/api/src/database.js";
import { createApp } from "../apps/api/src/app.js";
import { createUser } from "../apps/api/src/security.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Browser fixtures are disabled in production");
mkdirSync("work", { recursive: true });
const directory = mkdtempSync(resolve("work/browser-test-")),
  store = openDatabase(resolve(directory, "catalogo.sqlite"));
await migrate(store);
await createUser(store, {
  username: "admin",
  displayName: "Browser Test Admin",
  password: "only-for-browser-tests",
  role: "admin",
});
const app = await createApp(store);
app.addHook("onClose", async () => {
  store.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});
await app.listen({ host: "127.0.0.1", port: 3003 });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void app.close());
