import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { seedFixtures } from './fixtures.mjs';
import { root, work, localStatus, readLocalEnvironment } from './local.mjs';

const env=await readLocalEnvironment();
const status=await localStatus();
const path=resolve(work,'initialization.sql');
const result=spawnSync('python3',['scripts/db/initialize.py','--catalogs','config/environments/development-catalogs.json','--include-default-experience-levels','--sql-output',path],{cwd:root,encoding:'utf8'});
if(result.status!==0)throw new Error('Fixture initialization SQL generation failed');
const pgEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')));
const apply=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1','--dbname',status.DB_URL,'-f',path],{env:pgEnv,encoding:'utf8'});
if(apply.status!==0)throw new Error('Local fixture initialization failed');
await seedFixtures(env);
