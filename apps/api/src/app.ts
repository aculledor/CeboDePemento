import Fastify from 'fastify';
import { ZodError } from 'zod';
import { sql } from 'drizzle-orm';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './config.js';
import { registerCatalog } from './catalog.js';
import { taxa } from './schema.js';
import type { Store } from './database.js';
export async function createApp(store:Store,logger=false){
  const app=Fastify({logger,bodyLimit:256*1024});
  app.addHook('onSend',async(_req,reply,payload)=>{reply.header('Cache-Control','no-store');return payload;});
  app.setErrorHandler((error,req,reply)=>{
    if(error instanceof ZodError)return reply.code(400).send({code:'VALIDATION',message:'Invalid request',details:error.issues});
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode==='number' ? error.statusCode : 500;
    if(status>=500)req.log.error(error);
    return reply.code(status).send({code:status>=500?'SERVER_ERROR':'BAD_REQUEST',message:status>=500?'Server error':error instanceof Error?error.message:'Invalid request'});
  });
  app.get('/api/health',async()=>{
    const counts=store.db.select({reference:sql<number>`count(*)`,initial:sql<number>`sum(initial_selection)`}).from(taxa).get()!;
    return {status:'ok',catalog:{...counts,pending:counts.reference-counts.initial},migrations:(store.sqlite.prepare('SELECT count(*) n FROM app_migrations').get() as {n:number}).n};
  });
  registerCatalog(app,store);
  const web=resolve(root,'apps/web/dist');
  if(existsSync(web)){
    await app.register(staticFiles,{root:web});
    app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.code(404).send({code:'NOT_FOUND',message:'Not found'}):reply.sendFile('index.html'));
  }
  return app;
}
