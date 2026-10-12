import { createApp } from './app.js';
import { openDatabase, migrate } from './database.js';
import { settings } from './config.js';
const store=openDatabase();
try{
  await migrate(store);
  const app=await createApp(store,true);
  app.addHook('onClose',async()=>{store.sqlite.close();});
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close();});
  await app.listen({host:settings.HOST,port:settings.PORT});
}catch(error){store.sqlite.close();console.error(error);process.exitCode=1;}
