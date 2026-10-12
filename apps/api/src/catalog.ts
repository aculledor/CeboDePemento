import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeSearch, type Taxon } from '@cebo/shared';
import { taxa, names } from './schema.js';
import type { Store } from './database.js';
const querySchema=z.object({q:z.string().trim().max(100).default(''),category:z.enum(['fish','cephalopod','crustacean']).optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(24)});
export function registerCatalog(app:FastifyInstance,store:Store){
  const attachNames=(rows:typeof taxa.$inferSelect[]):Taxon[]=>{
    const all=rows.length ? store.db.select().from(names).where(inArray(names.taxonId,rows.map(x=>x.id))).orderBy(names.language,names.isPrimary,names.name).all():[];
    return rows.map(row=>({...row,names:all.filter(x=>x.taxonId===row.id).map(({taxonId,searchKey,...n})=>n)}));
  };
  app.get('/api/catalog', async req=>{
    const query=querySchema.parse(req.query), search=normalizeSearch(query.q);
    const where=and(eq(taxa.initialSelection,1),query.category?eq(taxa.category,query.category):undefined,search?sql`EXISTS (SELECT 1 FROM names n WHERE n.taxon_id=${taxa.id} AND instr(n.search_key,${search})>0)`:undefined);
    const total=store.db.select({total:sql<number>`count(*)`}).from(taxa).where(where).get()!.total;
    return {items:attachNames(store.db.select().from(taxa).where(where).orderBy(taxa.scientificName,taxa.id).limit(query.pageSize).offset((query.page-1)*query.pageSize).all()),total,page:query.page,pageSize:query.pageSize};
  });
  app.get<{Params:{id:string}}>('/api/catalog/:id',async(req,reply)=>{
    const row=store.db.select().from(taxa).where(and(eq(taxa.id,req.params.id),eq(taxa.initialSelection,1))).get();
    if(!row)return reply.code(404).send({code:'NOT_FOUND',message:'Not found'});
    return attachNames([row])[0];
  });
}
