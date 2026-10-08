import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";

/**
 * Terms of use and privacy notice, versioned. The team writes and publishes them from the admin
 * panel; publishing a new version asks every user to accept it again before their next booking
 * or trip. With nothing published there is nothing to accept and nothing is blocked.
 */
type Db=Pool|PoolClient;
export type LegalKind="terms"|"privacy";
const LEGAL_ADMIN=["admin"] as const;

async function tx<T>(pool:Pool,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const value=await fn(client);
    await client.query("commit");
    return value;
  }catch(error){
    await client.query("rollback");
    throw error;
  }finally{
    client.release();
  }
}

export async function currentLegalDocuments(db:Db){
  return (await db.query(`
    select id,kind,version,title,body,published_at from legal_documents
     where status='published' order by kind`)).rows;
}

/** Published documents this user has not accepted yet. */
export async function pendingLegalDocuments(db:Db,userId:string){
  return (await db.query(`
    select d.id,d.kind,d.version,d.title,d.body,d.published_at from legal_documents d
     where d.status='published'
       and not exists(select 1 from legal_acceptances a where a.document_id=d.id and a.user_id=$1)
     order by d.kind`,[userId])).rows;
}

/** Called before booking, requesting a detour or publishing a trip. */
export async function assertLegalAccepted(db:Db,userId:string){
  const pending=await pendingLegalDocuments(db,userId);
  if(pending.length){
    throw new DomainError("LEGAL_ACCEPTANCE_REQUIRED","Current terms must be accepted first",409,
      {pending:pending.map(d=>({id:d.id,kind:d.kind,version:d.version}))});
  }
}

export async function ownLegalStatus(pool:Pool,principal:AuthPrincipal){
  const accepted=(await pool.query(`
    select d.id,d.kind,d.version,d.title,a.accepted_at from legal_acceptances a
      join legal_documents d on d.id=a.document_id
     where a.user_id=$1 order by a.accepted_at desc`,[principal.userId])).rows;
  return {pending:await pendingLegalDocuments(pool,principal.userId),accepted};
}

export async function acceptLegalDocuments(pool:Pool,principal:AuthPrincipal,documentIds:string[]){
  const ids=[...new Set(documentIds)];
  if(!ids.length) throw new DomainError("LEGAL_DOCUMENT_REQUIRED","At least one document is required");
  return tx(pool,async client=>{
    const docs=(await client.query(`select id,status from legal_documents where id=any($1::uuid[])`,[ids])).rows;
    if(docs.length!==ids.length) throw new DomainError("LEGAL_DOCUMENT_NOT_FOUND","Legal document not found",404);
    // Accepting an old or unpublished text would record consent to something the user is not shown.
    if(docs.some(d=>d.status!=="published")){
      throw new DomainError("LEGAL_DOCUMENT_NOT_CURRENT","Only the current published version can be accepted",409);
    }
    await client.query(`
      insert into legal_acceptances(user_id,document_id) select $1,unnest($2::uuid[])
      on conflict do nothing`,[principal.userId,ids]);
    return {pending:await pendingLegalDocuments(client,principal.userId)};
  });
}

export async function adminListLegalDocuments(pool:Pool,principal:AuthPrincipal){
  requireAnyRole(principal,LEGAL_ADMIN);
  return (await pool.query(`
    select d.id,d.kind,d.version,d.title,d.body,d.status,d.created_at,d.published_at,d.retired_at,
           (select count(*)::int from legal_acceptances a where a.document_id=d.id) as acceptances
      from legal_documents d order by d.kind,d.version desc`)).rows;
}

export async function adminCreateLegalDocument(pool:Pool,principal:AuthPrincipal,input:{kind:LegalKind;title:string;body:string}){
  requireAnyRole(principal,LEGAL_ADMIN);
  const title=input.title.trim();
  const body=input.body.trim();
  if(!title||!body) throw new DomainError("INVALID_LEGAL_DOCUMENT","Title and text are required");
  return tx(pool,async client=>{
    await client.query(`lock table legal_documents in share row exclusive mode`);
    const next=(await client.query(`select coalesce(max(version),0)+1 as v from legal_documents where kind=$1`,[input.kind])).rows[0].v;
    const row=(await client.query(`
      insert into legal_documents(kind,version,title,body,created_by) values($1,$2,$3,$4,$5)
      returning id,kind,version,title,status,created_at`,[input.kind,next,title,body,principal.userId])).rows[0];
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'legal_document.created','legal_document',$2,$3)`,[principal.userId,row.id,{kind:input.kind,version:next}]);
    return row;
  });
}

export async function adminPublishLegalDocument(pool:Pool,principal:AuthPrincipal,documentId:string){
  requireAnyRole(principal,LEGAL_ADMIN);
  return tx(pool,async client=>{
    const d=(await client.query(`select * from legal_documents where id=$1 for update`,[documentId])).rows[0];
    if(!d) throw new DomainError("LEGAL_DOCUMENT_NOT_FOUND","Legal document not found",404);
    if(d.status!=="draft") throw new DomainError("LEGAL_DOCUMENT_NOT_DRAFT","Only drafts can be published",409);
    await client.query(`update legal_documents set status='retired',retired_at=now() where kind=$1 and status='published'`,[d.kind]);
    const row=(await client.query(`
      update legal_documents set status='published',published_by=$2,published_at=now() where id=$1
      returning id,kind,version,title,status,published_at`,[documentId,principal.userId])).rows[0];
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'legal_document.published','legal_document',$2,$3)`,[principal.userId,documentId,{kind:d.kind,version:d.version}]);
    return row;
  });
}
