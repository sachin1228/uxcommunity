import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {syncReferenceCatalogs} from './catalogs.mjs';

test('reference snapshot has complete original labels without production IDs or asset URLs',async()=>{
  const bytes=await readFile(new URL('../../config/environments/reference-catalogs.json',import.meta.url));
  const data=JSON.parse(bytes), source=JSON.parse(await readFile(new URL('../../config/environments/reference-catalogs.source.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);
  for(const [table,count] of Object.entries({cities:28,design_sectors:19,job_titles:6,experience_levels:5})){
    assert.equal(data[table].length,count);assert.equal(source.counts[table],count);
    const slugs=['job_titles','experience_levels'].includes(table);
    for(const row of data[table]){assert.deepEqual(Object.keys(row).sort(),slugs?['name','slug']:['name']);assert.ok(!row.name.startsWith('Development '));}
    assert.equal(new Set(data[table].map(row=>slugs?row.slug:row.name)).size,count);
  }
});

test('reference seeding refuses production before contacting any database',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('unexpected network')};
  try{await assert.rejects(()=>syncReferenceCatalogs({APP_ENV:'production'}),/nonproduction/);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
