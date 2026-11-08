import { PGlite } from '@electric-sql/pglite';
let t=performance.now();
const a = new PGlite(); await a.query('select 1');
console.log('first', Math.round(performance.now()-t)); t=performance.now();
const b = new PGlite(); await b.query('select 1');
console.log('second', Math.round(performance.now()-t)); t=performance.now();
await a.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
console.log('reset', Math.round(performance.now()-t)); t=performance.now();
const c = await PGlite.create({}); 
const dump = await a.dumpDataDir?.('none'); console.log('dump', !!dump, Math.round(performance.now()-t));t=performance.now();
if (dump) { const d = new PGlite({ loadDataDir: dump }); await d.query('select 1'); console.log('fromdump', Math.round(performance.now()-t)); }
