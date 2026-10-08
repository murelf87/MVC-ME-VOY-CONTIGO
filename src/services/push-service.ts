import type { Pool } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { DomainError } from "../errors.js";

/**
 * Push delivery. The device registry and the outbox are real; the provider (APNs/FCM directly,
 * or a relay such as Expo's) is still to be chosen, so the only provider today is "disabled",
 * which sends nothing and lets old notices expire instead of piling up.
 */
export type PushMessage={token:string;platform:"ios"|"android";title:string;body:string;data:Record<string,unknown>};
export type PushResult={ok:true}|{ok:false;error:string;tokenInvalid?:boolean};
export interface PushProvider{
  readonly name:string;
  send(message:PushMessage):Promise<PushResult>;
}
export const disabledPushProvider:PushProvider={
  name:"disabled",
  async send(){ return {ok:false,error:"push provider not configured"}; }
};

/** A push older than this is useless (the trip moved on); it stays in the in-app inbox. */
const PUSH_TTL_MINUTES=60;
const MAX_ATTEMPTS=5;

export async function registerPushDevice(pool:Pool,principal:AuthPrincipal,input:{platform:"ios"|"android";token:string}){
  const token=input.token.trim();
  if(token.length<10) throw new DomainError("INVALID_PUSH_TOKEN","Push token is invalid");
  // A phone that changes hands moves its token to whoever signed in last.
  const r=await pool.query(`
    insert into push_devices(user_id,platform,token) values($1,$2,$3)
    on conflict(token) do update set user_id=excluded.user_id,platform=excluded.platform,
      last_seen_at=now(),disabled_at=null,disabled_reason=null
    returning id,platform,created_at,last_seen_at`,[principal.userId,input.platform,token]);
  return r.rows[0];
}

export async function unregisterPushDevice(pool:Pool,principal:AuthPrincipal,token:string){
  const r=await pool.query(`
    update push_devices set disabled_at=now(),disabled_reason='user_unregistered'
     where token=$1 and user_id=$2 and disabled_at is null`,[token.trim(),principal.userId]);
  return {unregistered:r.rowCount===1};
}

/** Short, language-ready texts; the app shows the detailed text from the inbox. */
export function pushText(kind:string,payload:Record<string,any>):{title:string;body:string}{
  const who=(k:string)=>payload[k]||"";
  switch(kind){
    case "ride_request.received": return {title:"Nueva solicitud",body:`${who("passengerName")||"Alguien"} quiere una plaza en tu viaje.`};
    case "ride_request.accepted": return {title:"Solicitud aceptada",body:"Paga para confirmar tu plaza antes de que caduque."};
    case "ride_request.rejected": return {title:"Solicitud no aceptada",body:"Busca otro viaje para esa hora."};
    case "booking.confirmed": return {title:"Reserva confirmada",body:"Tu plaza está confirmada."};
    case "booking.cancelled_by_passenger": return {title:"Reserva cancelada",body:`${who("passengerName")||"Un pasajero"} ha cancelado su plaza.`};
    case "trip.started": return {title:"El viaje ha empezado",body:"Sigue el coche en directo."};
    case "trip.driver_arriving": return {title:"Tu conductor está llegando",body:"Prepárate en el punto de recogida."};
    case "trip.completed": return {title:"Viaje terminado",body:"Puedes valorar el viaje."};
    case "trip.cancelled": return {title:"Viaje cancelado",body:"El conductor ha cancelado el viaje."};
    case "route_change.requested": return {title:"Te piden un desvío",body:"Revisa la solicitud de recogida."};
    case "route_change.proposed": return {title:"Cambio de ruta",body:"El conductor quiere recoger a alguien más. ¿Te parece bien?"};
    case "route_change.applied": return {title:"Ruta actualizada",body:"El recorrido del viaje ha cambiado."};
    case "route_change.rejected": return {title:"Desvío no aplicado",body:"El cambio de ruta no sale adelante."};
    case "report.closed": return {title:"Reporte revisado",body:"Hemos cerrado tu reporte."};
    default: return {title:"MVC",body:"Tienes un aviso nuevo."};
  }
}

export async function deliverPendingPushes(pool:Pool,provider:PushProvider,limit=200){
  const expired=await pool.query(`
    update push_outbox set status='expired'
     where status='pending' and created_at<now()-make_interval(mins=>$1)`,[PUSH_TTL_MINUTES]);
  if(provider.name==="disabled") return {sent:0,failed:0,expired:expired.rowCount??0};
  const rows=(await pool.query(`
    select o.id,d.id as device_id,d.token,d.platform,n.kind,n.payload,n.trip_id
      from push_outbox o join push_devices d on d.id=o.device_id join user_notifications n on n.id=o.notification_id
     where o.status='pending' and d.disabled_at is null
     order by o.id limit $1`,[limit])).rows;
  let sent=0,failed=0;
  for(const r of rows){
    const text=pushText(r.kind,r.payload??{});
    const result=await provider.send({token:r.token,platform:r.platform,...text,data:{kind:r.kind,tripId:r.trip_id}})
      .catch((e:unknown):PushResult=>({ok:false,error:e instanceof Error?e.message:"send failed"}));
    if(result.ok){
      await pool.query(`update push_outbox set status='sent',sent_at=now(),attempts=attempts+1,last_error=null where id=$1`,[r.id]);
      sent++;
      continue;
    }
    failed++;
    if(result.tokenInvalid){
      await pool.query(`update push_devices set disabled_at=now(),disabled_reason='token_invalid' where id=$1`,[r.device_id]);
    }
    await pool.query(`
      update push_outbox set attempts=attempts+1,last_error=$2,
        status=case when $3 or attempts+1>=$4 then 'failed' else 'pending' end
       where id=$1`,[r.id,result.error.slice(0,500),Boolean(result.tokenInvalid),MAX_ATTEMPTS]);
  }
  return {sent,failed,expired:expired.rowCount??0};
}
