import { createApp } from "./app.js";
import { openDatabase, migrate, backupApplication } from "./database.js";
import { settings } from "./config.js";
const store = openDatabase();
try {
  await migrate(store);
  const app = await createApp(store, true);
  const intervalHours = Number(
    process.env.BACKUP_INTERVAL_HOURS ??
      (settings.NODE_ENV === "production" ? 24 : 0),
  );
  if (!Number.isFinite(intervalHours) || intervalHours < 0)
    throw new Error("Invalid BACKUP_INTERVAL_HOURS");
  let backupTask: Promise<unknown> | null = null;
  const backupIfDue = () => {
    const last = (
      store.sqlite
        .prepare(
          "SELECT value FROM app_metadata WHERE key='last_verified_backup'",
        )
        .get() as { value: string } | undefined
    )?.value;
    if (
      !backupTask &&
      (!last || Date.now() - Date.parse(last) >= intervalHours * 3600000)
    ) {
      backupTask = backupApplication(store)
        .then((result) =>
          app.log.info({ directory: result.directory }, "Backup verified"),
        )
        .catch((error) => app.log.error(error, "Backup failed"))
        .finally(() => {
          backupTask = null;
        });
    }
  };
  const timer = intervalHours
    ? setInterval(backupIfDue, Math.min(intervalHours * 3600000, 3600000))
    : null;
  if (intervalHours) backupIfDue();
  timer?.unref();
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
    await backupTask;
    store.sqlite.close();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close();
    });
  await app.listen({ host: settings.HOST, port: settings.PORT });
} catch (error) {
  store.sqlite.close();
  console.error(error);
  process.exitCode = 1;
}
