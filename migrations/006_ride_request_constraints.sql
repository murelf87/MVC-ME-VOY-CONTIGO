create unique index ride_requests_open_exact_uidx
  on ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq)
  where status in ('pending','accepted','payment_pending','confirmed');
