import { openDatabase, migrate, backupApplication } from "./database.js";
import { createUser, hashToken, newToken, audit } from "./security.js";
import { readPassword } from "./secret-input.js";
import { z } from "zod";
import { restoreSnapshot } from "./restore.js";
const store = openDatabase();
try {
  await migrate(store);
  switch (process.argv[2]) {
    case "migrate":
      await migrate(store);
      console.log("Migraciones aplicadas.");
      break;
    case "backup":
      console.log(JSON.stringify(await backupApplication(store), null, 2));
      break;
    case "restore": {
      const [source, target, photos] = process.argv.slice(3);
      if (!source || !target)
        throw new Error(
          "Use restore snapshot data/restored.sqlite data/restored-photos",
        );
      console.log(await restoreSnapshot(source, target, photos));
      break;
    }
    case "admin": {
      if (store.sqlite.prepare("SELECT id FROM users WHERE role='admin'").get())
        throw new Error("El primer administrador ya existe.");
      const username = process.argv[3] ?? "admin",
        user = await createUser(store, {
          username,
          displayName: username,
          role: "admin",
          password: await readPassword(),
        });
      console.log(`Administrador creado: ${user.username}`);
      break;
    }
    case "invite": {
      const actor = store.sqlite
        .prepare(
          "SELECT id FROM users WHERE username=? AND role='admin' AND active=1",
        )
        .get(process.argv[3] ?? "admin") as { id: string } | undefined;
      if (!actor) throw new Error("Administrador no encontrado");
      const hours = z.coerce
          .number()
          .int()
          .min(1)
          .max(720)
          .parse(process.argv[4] ?? 72),
        token = newToken(),
        id = crypto.randomUUID(),
        expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
      store.sqlite.transaction(() => {
        store.sqlite
          .prepare(
            "INSERT INTO registration_invitations(id,token_hash,created_by,expires_at) VALUES (?,?,?,?)",
          )
          .run(id, hashToken(token), actor.id, expiresAt);
        audit(
          store,
          actor.id,
          "invitation.created",
          "registration_invitation",
          id,
          null,
          { expiresAt },
        );
      })();
      console.log(JSON.stringify({ token, expiresAt }, null, 2));
      break;
    }
    case "recovery": {
      const actor = store.sqlite
        .prepare(
          "SELECT id FROM users WHERE username=? AND role='admin' AND active=1",
        )
        .get(process.argv[3] ?? "admin") as { id: string } | undefined;
      const user = store.sqlite
        .prepare("SELECT id FROM users WHERE username=?")
        .get(process.argv[4]) as { id: string } | undefined;
      if (!actor || !user)
        throw new Error("Administrador o usuario no encontrado");
      const token = newToken(),
        expiresAt = new Date(Date.now() + 3600000).toISOString();
      store.sqlite.transaction(() => {
        store.sqlite
          .prepare("DELETE FROM recovery_tokens WHERE user_id=?")
          .run(user.id);
        store.sqlite
          .prepare("INSERT INTO recovery_tokens VALUES (?,?,?,?,NULL)")
          .run(hashToken(token), user.id, actor.id, expiresAt);
        audit(store, actor.id, "recovery.created", "user", user.id);
      })();
      console.log(JSON.stringify({ token, expiresAt }, null, 2));
      break;
    }
    default:
      throw new Error("Use migrate, backup, admin, invite or recovery");
  }
} finally {
  store.sqlite.close();
}
