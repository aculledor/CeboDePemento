import { restoreSnapshot } from "../apps/api/src/restore.js";
const [source, target, photos] = process.argv.slice(2);
if (!source || !target)
  throw new Error(
    "Usage: npm run db:restore -- backup.sqlite data/restored.sqlite",
  );
console.log(await restoreSnapshot(source, target, photos));
