import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import type { LatLng, RouteProvider } from "../maps/types.js";
import { computeProvinceCompliantSegmentPlan } from "../maps/province-route-service.js";
import { publishTrip } from "./trip-service.js";
import { assertLegalAccepted } from "./legal-service.js";

export type CreateTripDraftInput = {
  vehicleId: string;
  provinceId: string;
  category: "work" | "university" | "fp_academies" | "hospital" | "sport" | "other";
  leg: "outbound" | "return";
  departureAt: string;
  flexibilityMinutes: number;
  maxDetourM: number;
  offeredSeats: number;
  origin: LatLng;
  destination: LatLng;
  intermediates?: LatLng[];
};

async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client=await pool.connect();
  try{
    await client.query("begin");
    const result=await fn(client);
    await client.query("commit");
    return result;
  }catch(error){
    await client.query("rollback");
    throw error;
  }finally{
    client.release();
  }
}

function validateInput(input: CreateTripDraftInput): Date {
  const departure=new Date(input.departureAt);
  if(Number.isNaN(departure.getTime())){
    throw new DomainError("INVALID_DEPARTURE_TIME","departureAt must be a valid ISO timestamp");
  }
  if(departure.getTime()<Date.now()-300000){
    throw new DomainError("DEPARTURE_TIME_IN_PAST","Departure time cannot be in the past",422);
  }
  if(!Number.isInteger(input.flexibilityMinutes)||input.flexibilityMinutes<0||input.flexibilityMinutes>60){
    throw new DomainError("INVALID_FLEXIBILITY","Flexibility must be between 0 and 60 minutes");
  }
  if(!Number.isInteger(input.maxDetourM)||input.maxDetourM<0||input.maxDetourM>100000){
    throw new DomainError("INVALID_MAX_DETOUR","Maximum detour is invalid");
  }
  if(!Number.isInteger(input.offeredSeats)||input.offeredSeats<1||input.offeredSeats>8){
    throw new DomainError("INVALID_OFFERED_SEATS","Offered seats must be between 1 and 8");
  }
  if((input.intermediates?.length ?? 0)>10){
    throw new DomainError("TOO_MANY_STOPS","A trip can contain at most 10 intermediate stops");
  }
  return departure;
}

export async function createTripDraftWithServerRoute(
  pool: Pool,
  principal: AuthPrincipal,
  provider: RouteProvider | null,
  input: CreateTripDraftInput
) {
  requireAnyRole(principal,["driver"]);
  if(!provider){
    throw new DomainError("MAPS_PROVIDER_UNAVAILABLE","A real routing provider is not configured",503);
  }
  const departure=validateInput(input);

  const vehicle=await pool.query(
    `select driver_user_id,passenger_seats from vehicles where id=$1`,
    [input.vehicleId]
  );
  if(!vehicle.rowCount) throw new DomainError("VEHICLE_NOT_FOUND","Vehicle not found",404);
  if(vehicle.rows[0].driver_user_id!==principal.userId){
    throw new DomainError("VEHICLE_NOT_OWNED","Only the vehicle owner may create a trip with it",403);
  }
  if(input.offeredSeats>vehicle.rows[0].passenger_seats){
    throw new DomainError("OFFERED_SEATS_EXCEED_VEHICLE","Offered seats exceed vehicle capacity",422);
  }

  const plan=await computeProvinceCompliantSegmentPlan(pool,provider,{
    provinceId:input.provinceId,
    origin:input.origin,
    destination:input.destination,
    ...(input.intermediates?.length ? {intermediates:input.intermediates}:{}),
    departureTime:departure.toISOString()
  });

  return tx(pool,async client=>{
    const routeGeoJson=JSON.stringify(plan.route.geometry);
    const tripQ=await client.query(
      `insert into trips(
         driver_user_id,vehicle_id,province_id,category,kind,leg,status,departure_at,
         flexibility_minutes,max_detour_m,offered_seats,
         origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,
         route_provider,route_provider_ref
       ) values(
         $1,$2,$3,$4,'single',$5,'draft',$6,
         $7,$8,$9,
         ST_SetSRID(ST_Point($10,$11),4326),
         ST_SetSRID(ST_Point($12,$13),4326),
         ST_SetSRID(ST_GeomFromGeoJSON($14),4326)::geometry(LineString,4326),
         $15,$16,$17,$18
       )
       returning id,driver_user_id,vehicle_id,province_id,category,kind,leg,status,departure_at,
                 flexibility_minutes,max_detour_m,offered_seats,route_distance_m,route_duration_s,
                 route_provider,route_provider_ref,route_version,created_at,updated_at`,
      [
        principal.userId,input.vehicleId,input.provinceId,input.category,input.leg,departure.toISOString(),
        input.flexibilityMinutes,input.maxDetourM,input.offeredSeats,
        input.origin.longitude,input.origin.latitude,
        input.destination.longitude,input.destination.latitude,
        routeGeoJson,plan.route.distanceMeters,plan.route.durationSeconds,
        plan.route.provider,plan.route.providerRef
      ]
    );
    const trip=tripQ.rows[0];

    const points=[input.origin,...(input.intermediates ?? []),input.destination];
    for(let seq=0;seq<points.length;seq+=1){
      const point=points[seq]!;
      const kind=seq===0?"origin":seq===points.length-1?"destination":"stop";
      await client.query(
        `insert into trip_stops(trip_id,seq,kind,geom)
         values($1,$2,$3,ST_SetSRID(ST_Point($4,$5),4326))`,
        [trip.id,seq,kind,point.longitude,point.latitude]
      );
    }
    for(let seq=0;seq<plan.segments.length;seq+=1){
      const segment=plan.segments[seq]!;
      await client.query(
        `insert into trip_segments(
           trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity
         ) values($1,$2,$2,$3,$4,$5,$6)`,
        [trip.id,seq,seq+1,segment.distanceMeters,segment.durationSeconds,input.offeredSeats]
      );
    }
    await client.query(
      `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
       values($1,'trip.draft.created','trip',$2,$3::jsonb)`,
      [principal.userId,trip.id,JSON.stringify({
        provider:plan.route.provider,
        segmentCount:plan.segments.length,
        routeDistanceM:plan.route.distanceMeters
      })]
    );
    return trip;
  });
}

export async function listOwnDriverTrips(pool:Pool,principal:AuthPrincipal){
  requireAnyRole(principal,["driver"]);
  return (await pool.query(
    `select t.id,t.vehicle_id,t.province_id,t.category,t.kind,t.leg,t.status,t.departure_at,
            t.flexibility_minutes,t.max_detour_m,t.offered_seats,
            t.route_distance_m,t.route_duration_s,t.route_provider,t.route_provider_ref,
            t.route_version,t.created_at,t.updated_at,
            t.series_id,ts.weekdays::int[] as series_weekdays,ts.status as series_status
       from trips t left join trip_series ts on ts.id=t.series_id
      where t.driver_user_id=$1 order by t.created_at desc,t.departure_at asc`,
    [principal.userId]
  )).rows;
}

export async function publishOwnedTrip(
  pool:Pool,
  principal:AuthPrincipal,
  tripId:string
):Promise<void>{
  requireAnyRole(principal,["driver"]);
  await assertLegalAccepted(pool,principal.userId);
  const trip=await pool.query(`select driver_user_id,kind from trips where id=$1`,[tripId]);
  if(!trip.rowCount) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
  if(trip.rows[0].driver_user_id!==principal.userId){
    throw new DomainError("TRIP_NOT_OWNED","Only the trip driver may publish it",403);
  }
  if(trip.rows[0].kind==="recurring"){
    throw new DomainError("RECURRING_TRIP_NOT_READY","Recurring trip scheduling is not implemented yet",409);
  }
  await publishTrip(pool,tripId);
}
