import test from 'node:test';
import assert from 'node:assert/strict';
import {demoRun,cleanupStatement} from './demo-staging.mjs';
test('run IDs reject paths, SQL, and ambiguous missing values',()=>{
 for(const value of [undefined,'','../other-run',"run';delete",'SHORT','tiny']) assert.throws(()=>demoRun(value));
 assert.equal(demoRun('staging-video-20261103'),'staging-video-20261103');
});
test('cleanup targets exactly recorded compound membership keys',()=>{
 const sql=cleanupStatement('community_members',[{community_id:'room',user_id:'person',role:'member'}],'community_id,user_id');
 assert.match(sql,/target.community_id = seeded.community_id AND target.user_id = seeded.user_id/);
 assert.ok(!sql.includes('role'));
 assert.throws(()=>cleanupStatement('users; DROP TABLE users',[],'id'));
});
test('cleanup quotes payloads and uses equality, not wildcard email deletion',()=>{
 const sql=cleanupStatement('users',[{id:"someone'else"}],'id');
 assert.match(sql,/someone''else/);
 assert.match(sql,/WHERE target.id = seeded.id/);
 assert.ok(!sql.includes('LIKE'));
});
