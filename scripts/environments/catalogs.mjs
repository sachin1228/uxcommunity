import { readFile } from 'node:fs/promises';
import { assertWebEnvironment, fetchIsolatedService } from '../../packages/shared/src/environment.ts';
import { createClient } from '@supabase/supabase-js';

/** Apply the offline public reference snapshot only to isolated nonproduction DBs. */
export async function syncReferenceCatalogs(env) {
  if (!['development','staging'].includes(env.APP_ENV)) throw new Error('Catalog fixtures require a nonproduction environment');
  assertWebEnvironment(env);
  const catalog=JSON.parse(await readFile(new URL('../../config/environments/reference-catalogs.json',import.meta.url),'utf8'));
  const legacy=JSON.parse(await readFile(new URL('../../supabase/initialization/experience-levels.json',import.meta.url),'utf8'));
  const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false},global:{fetch:(input,init)=>fetchIsolatedService(input,init??{},env)}});
  for(const table of ['cities','design_sectors','job_titles','experience_levels']) {
    const {error}=await db.from(table).upsert(catalog[table].map(row=>({...row,is_active:true})),{onConflict:['job_titles','experience_levels'].includes(table)?'slug':'name'});
    if(error)throw error;
  }
  // Keep all referenced rows/IDs. Retire only the original synthetic seed options.
  for(const [table,key,value] of [['cities','name','Development City'],['design_sectors','name','Development Design'],['job_titles','slug','development_designer']]) {
    const {error}=await db.from(table).update({is_active:false}).eq(key,value);
    if(error)throw error;
  }
  const current=new Set(catalog.experience_levels.map(row=>row.slug));
  const obsolete=legacy.map(row=>row.slug).filter(slug=>!current.has(slug));
  if(obsolete.length){const {error}=await db.from('experience_levels').update({is_active:false}).in('slug',obsolete);if(error)throw error;}
}
