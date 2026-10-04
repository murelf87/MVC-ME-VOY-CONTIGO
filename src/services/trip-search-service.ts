import type { Pool } from "pg";
import { DomainError } from "../errors.js";

export type TripSearchInput = {
  provinceId: string;
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  radiusM?: number;
  departureAfter?: string;
  departureBefore?: string;
  limit?: number;
};

export type TripSearchResult = {
  tripId: string;
  category: string;
  leg: string;
  departureAt: string | null;
  fromSegmentSeq: number;
  toSegmentSeq: number;
  pickupDistanceM: number;
  dropoffDistanceM: number;
  roadDistanceM: number;
  estimatedDurationS: number;
  availableSeats: number;
  driverDisplayName: string | null;
};

function finite(value:number,min:number,max:number,label:string):void{
  if(!Number.isFinite(value)||value<min||value>max){
    throw new DomainError("INVALID_SEARCH_COORDINATE",`${label} is outside its valid range`);
  }
}

function parseDate(value:string|undefined,label:string):Date|null{
  if(!value) return null;
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) throw new DomainError("INVALID_SEARCH_DATE",`${label} is invalid`);
  return d;
}

async function availableSeatsForRange(
  pool:Pool,
  tripId:string,
  fromSegmentSeq:number,
  toSegmentSeq:number
):Promise<number>{
  const result=await pool.query<{available:number|null}>(`
    with target_segments as (
      select seq,capacity
        from trip_segments
       where trip_id=$1 and seq >= $2 and seq < $3
    ),
    occupancy as (
      select s.seq,s.capacity,
        (
          select count(*)::int
            from seat_holds h
            join ride_requests r on r.id=h.request_id
           where r.trip_id=$1
             and h.status='active' and h.expires_at>now()
             and r.from_segment_seq <= s.seq and r.to_segment_seq > s.seq
        )
        +
        (
          select count(*)::int
            from bookings b
            join ride_requests r on r.id=b.request_id
           where r.trip_id=$1
             and b.status in ('confirmed','completed')
             and r.from_segment_seq <= s.seq and r.to_segment_seq > s.seq
        ) as occupied
      from target_segments s
    )
    select min(capacity-occupied)::int as available from occupancy
  `,[tripId,fromSegmentSeq,toSegmentSeq]);
  return Math.max(0,result.rows[0]?.available ?? 0);
}

export async function searchPublishedTrips(
  pool:Pool,
  input:TripSearchInput
):Promise<TripSearchResult[]>{
  finite(input.originLatitude,-90,90,"originLatitude");
  finite(input.originLongitude,-180,180,"originLongitude");
  finite(input.destinationLatitude,-90,90,"destinationLatitude");
  finite(input.destinationLongitude,-180,180,"destinationLongitude");

  const radiusM=input.radiusM ?? 5000;
  if(!Number.isInteger(radiusM)||radiusM<100||radiusM>50000){
    throw new DomainError("INVALID_SEARCH_RADIUS","Search radius must be between 100 and 50000 meters");
  }
  const limit=input.limit ?? 30;
  if(!Number.isInteger(limit)||limit<1||limit>100){
    throw new DomainError("INVALID_SEARCH_LIMIT","Search limit must be between 1 and 100");
  }
  const after=parseDate(input.departureAfter,"departureAfter") ?? new Date(Date.now()-300000);
  const before=parseDate(input.departureBefore,"departureBefore");
  if(before && before<=after){
    throw new DomainError("INVALID_SEARCH_WINDOW","departureBefore must be after departureAfter");
  }

  const candidates=await pool.query<{
    trip_id:string;category:string;leg:string;departure_at:Date|null;
    from_seq:number;to_seq:number;pickup_distance_m:number;dropoff_distance_m:number;
    road_distance_m:number;estimated_duration_s:number;driver_display_name:string|null;
  }>(`
    select distinct on (t.id)
      t.id as trip_id,t.category::text,t.leg::text,t.departure_at,
      pickup.seq as from_seq,dropoff.seq as to_seq,
      round(ST_Distance(
        pickup.geom::geography,
        ST_SetSRID(ST_Point($2,$3),4326)::geography
      ))::int as pickup_distance_m,
      round(ST_Distance(
        dropoff.geom::geography,
        ST_SetSRID(ST_Point($4,$5),4326)::geography
      ))::int as dropoff_distance_m,
      coalesce((
        select sum(s.distance_m)::int
          from trip_segments s
         where s.trip_id=t.id and s.seq>=pickup.seq and s.seq<dropoff.seq
      ),0) as road_distance_m,
      coalesce((
        select sum(s.duration_s)::int
          from trip_segments s
         where s.trip_id=t.id and s.seq>=pickup.seq and s.seq<dropoff.seq
      ),0) as estimated_duration_s,
      p.display_name as driver_display_name
    from trips t
    join trip_stops pickup on pickup.trip_id=t.id
    join trip_stops dropoff on dropoff.trip_id=t.id and dropoff.seq>pickup.seq
    left join profiles p on p.user_id=t.driver_user_id
    where t.province_id=$1
      and t.status='published'
      and t.departure_at >= $6
      and ($7::timestamptz is null or t.departure_at <= $7::timestamptz)
      and ST_DWithin(
        pickup.geom::geography,
        ST_SetSRID(ST_Point($2,$3),4326)::geography,
        $8
      )
      and ST_DWithin(
        dropoff.geom::geography,
        ST_SetSRID(ST_Point($4,$5),4326)::geography,
        $8
      )
    order by t.id,pickup_distance_m+dropoff_distance_m,pickup.seq,dropoff.seq
    limit $9
  `,[
    input.provinceId,
    input.originLongitude,input.originLatitude,
    input.destinationLongitude,input.destinationLatitude,
    after.toISOString(),before?.toISOString() ?? null,radiusM,limit
  ]);

  const results:TripSearchResult[]=[];
  for(const row of candidates.rows){
    if(row.to_seq<=row.from_seq||row.road_distance_m<=0) continue;
    const availableSeats=await availableSeatsForRange(pool,row.trip_id,row.from_seq,row.to_seq);
    if(availableSeats<=0) continue;
    results.push({
      tripId:row.trip_id,
      category:row.category,
      leg:row.leg,
      departureAt:row.departure_at?.toISOString() ?? null,
      fromSegmentSeq:row.from_seq,
      toSegmentSeq:row.to_seq,
      pickupDistanceM:row.pickup_distance_m,
      dropoffDistanceM:row.dropoff_distance_m,
      roadDistanceM:row.road_distance_m,
      estimatedDurationS:row.estimated_duration_s,
      availableSeats,
      driverDisplayName:row.driver_display_name
    });
  }
  return results;
}
