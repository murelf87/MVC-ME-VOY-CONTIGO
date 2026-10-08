/**
 * Operator CLI to give the first staff role to an existing account, run by
 * someone with direct database access. There is no master password: every
 * later grant is done in the admin panel by an admin and audited.
 *
 *   npm run staff:grant -- +34600000000 admin
 */
import pg from "pg";

const [phone,role]=process.argv.slice(2);
const ROLES=["admin","verification_admin","finance_admin","support_admin"];
if(!phone||!/^\+[1-9][0-9]{7,14}$/.test(phone)||!role||!ROLES.includes(role)){
  console.error(`Usage: npm run staff:grant -- <+E164 phone> <${ROLES.join("|")}>`);
  process.exit(2);
}
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL is required");
const pool=new pg.Pool({connectionString:databaseUrl});
try{
  const user=await pool.query(`select id from app_users where phone_e164=$1 and status='active'`,[phone]);
  if(!user.rowCount){
    console.error("No active account with that phone. The person must sign in once first.");
    process.exitCode=1;
  }else{
    const id=user.rows[0].id;
    await pool.query(`insert into user_roles(user_id,role) values($1,$2) on conflict do nothing`,[id,role]);
    await pool.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values(null,'role.granted','user',$1,$2)`,[id,{role,source:"operator_cli",osUser:process.env.USER??null}]);
    console.log(`Granted ${role} to ${phone}`);
  }
}finally{
  await pool.end();
}
