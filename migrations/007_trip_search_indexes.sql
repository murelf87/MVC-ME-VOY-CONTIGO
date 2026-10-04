create index trips_public_search_idx
  on trips(province_id,status,departure_at)
  where status='published';

create index trip_stops_geography_gix
  on trip_stops using gist ((geom::geography));
