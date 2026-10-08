import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createSession } from "../src/auth/session.js";
import { pool } from "../src/db/pool.js";

/**
 * Mandatory test 17 over HTTP: every administrative route the running app exposes refuses
 * anonymous callers and ordinary passengers/drivers, whatever its body or path parameters.
 */
let app:FastifyInstance;
let userToken:string;
const someId="00000000-0000-4000-8000-000000000000";

before(async()=>{
  app=await buildApp();
  await app.ready();
  const user=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  await pool.query(`insert into user_roles(user_id,role) values($1,'passenger'),($1,'driver')`,[user]);
  const client=await pool.connect();
  try{ userToken=(await createSession(client,user,600)).token; }finally{ client.release(); }
});

after(async()=>{
  await app.close();
  await pool.end();
});

function adminRoutes(){
  const paths=(app.swagger() as {paths:Record<string,Record<string,unknown>>}).paths;
  const routes:{method:"GET"|"POST";url:string}[]=[];
  for(const [path,methods] of Object.entries(paths)){
    if(!path.startsWith("/v1/admin")) continue;
    for(const m of Object.keys(methods)){
      routes.push({method:m.toUpperCase() as "GET"|"POST",url:path.replace(/\{[^}]+\}/g,someId)});
    }
  }
  return routes;
}

test("every administrative route refuses anonymous and non-staff callers",async()=>{
  const routes=adminRoutes();
  assert.ok(routes.length>=20,`expected the admin surface, found ${routes.length} routes`);
  for(const r of routes){
    const payload=r.method==="POST"?{}:undefined;
    const anon=await app.inject({method:r.method,url:r.url,...(payload?{payload}:{})});
    assert.equal(anon.statusCode,401,`${r.method} ${r.url} anonymous -> ${anon.statusCode}`);
    const user=await app.inject({method:r.method,url:r.url,...(payload?{payload}:{}),
      headers:{authorization:`Bearer ${userToken}`}});
    assert.equal(user.statusCode,403,`${r.method} ${r.url} passenger/driver -> ${user.statusCode}`);
  }
});
