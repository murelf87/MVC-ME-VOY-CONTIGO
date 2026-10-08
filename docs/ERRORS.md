# Códigos de error de la API

Generado con `npm run errors` a partir del código; no editar a mano.

Todas las respuestas de error tienen la forma `{ "error": { "code", "message", "details"? }, "requestId" }`.
La app decide qué mostrar por `code`, que es estable; `message` es para depuración y puede cambiar.
Cada código va siempre con el mismo estado HTTP (lo comprueba `tests/error-catalog.test.ts`).

## Capa HTTP

| Código | HTTP | Significado |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body, query or params do not match the schema |
| `RATE_LIMITED` | 429 | Too many requests |
| `HTTP_ERROR` | 400 | Other 4xx raised by Fastify (malformed JSON, unsupported media type…) |
| `INTERNAL_ERROR` | 500 | Internal server error |

## Dominio (209 códigos)

| Código | HTTP | Mensaje | Dónde |
|---|---|---|---|
| `ACCOUNT_NOT_ACTIVE` | 403 | Account is not active | auth/service.ts, auth/session.ts |
| `ALREADY_ON_TRIP` | 409 | You already have an open request on this trip | services/route-change-service.ts |
| `AUTH_CHALLENGE_ALREADY_USED` | 409 | Verification challenge has already been used | auth/service.ts |
| `AUTH_CHALLENGE_NOT_APPROVED` | 409 | Verification challenge is not approved | auth/service.ts |
| `AUTH_CHALLENGE_NOT_FOUND` | 404 | Verification challenge not found | auth/service.ts |
| `AUTH_CHALLENGE_NOT_READY` | 409 | Verification challenge is not ready | auth/service.ts |
| `AUTH_CODE_INVALID_OR_EXPIRED` | 401 | Verification code is invalid or expired | auth/provider.ts, auth/service.ts |
| `AUTH_FORBIDDEN` | 403 | Insufficient permissions | auth/session.ts |
| `AUTH_INVALID` | 401 | Invalid authentication token | auth/session.ts |
| `AUTH_INVALID_OR_EXPIRED` | 401 | Session is invalid or expired | auth/session.ts |
| `AUTH_PROVIDER_MISMATCH` | 409 | Verification provider mismatch | auth/service.ts |
| `AUTH_REQUIRED` | 401 | Authentication required | auth/session.ts |
| `AUTH_RESEND_TOO_SOON` | 429 | Wait before requesting another verification code | auth/service.ts |
| `AUTH_TOO_MANY_ATTEMPTS` | 429 | Too many verification attempts | auth/service.ts |
| `BLOCK_SELF_FORBIDDEN` | 400 | Cannot block yourself | chat/chat-service.ts |
| `BOOKING_NOT_FOUND` | 404 | Booking not found | services/feedback-service.ts, services/trip-execution-service.ts |
| `BOOKING_NOT_OWNED` | 403 | Only the booked passenger may generate the pickup code | services/trip-execution-service.ts |
| `BOOKING_NOT_PARTICIPANT` | 403 | Only the trip participants can rate this booking | services/feedback-service.ts |
| `BOOKING_NOT_PICKUP_ELIGIBLE` | 409 | Booking is not eligible for pickup verification | services/trip-execution-service.ts |
| `CANCEL_AFTER_PICKUP` | 409 | You are already on board | services/cancellation-service.ts |
| `CANCEL_REASON_REQUIRED` | 400 | Tell passengers why the trip is cancelled | services/cancellation-service.ts |
| `CHAT_BLOCKED` | 403 | Chat is unavailable because one participant blocked the other | chat/chat-service.ts |
| `CHAT_FORBIDDEN` | 403 | Trip chat is only available between the driver and a confirmed passenger | chat/chat-service.ts |
| `CHAT_IDEMPOTENCY_CONFLICT` | 409 | clientMessageId was already used for different content | chat/chat-service.ts |
| `CHAT_SELF_FORBIDDEN` | 400 | Cannot open a trip chat with yourself | chat/chat-service.ts |
| `CODE` | 400 | message | contracts/error-catalog.ts |
| `DEPARTURE_TIME_IN_PAST` | 422 | Departure time cannot be in the past | services/trip-draft-service.ts |
| `DETOUR_NOT_ALLOWED` | 409 | The driver does not accept detours on this trip | services/route-change-service.ts |
| `DETOUR_TOO_LONG` | 422 | The detour exceeds the maximum the driver accepts | services/route-change-service.ts |
| `DOCUMENT_NOT_FOUND` | 404 | Document not found | documents/document-service.ts, documents/private-upload-service.ts |
| `DOCUMENT_STORAGE_MISMATCH` | 409 | Document storage provider mismatch | documents/private-upload-service.ts |
| `DOCUMENT_VEHICLE_MISMATCH` | 400 | This document kind cannot be attached to a vehicle | documents/document-service.ts |
| `DRIVER_CANNOT_REQUEST_OWN_TRIP` | 409 | Driver cannot request a seat on their own trip | services/request-service.ts, services/route-change-service.ts |
| `DRIVER_IDENTITY_REQUIRED` | 400 | Verified driver identity is required | services/trip-service.ts |
| `DRIVER_PUBLIC_PHOTO_REQUIRED` | 400 | Approved public profile photo is required | services/trip-service.ts |
| `DUPLICATE_OPEN_REQUEST` | 409 | An open request already exists for this segment range | services/request-service.ts |
| `DUPLICATE_OPEN_ROUTE_CHANGE` | 409 | You already asked this driver for a detour | services/route-change-service.ts |
| `GEOCODING_PROVIDER_BAD_RESPONSE` | 502 | Geocoding provider returned an incomplete result / Geocoding provider returned invalid JSON | maps/google-maps-provider.ts |
| `GEOCODING_PROVIDER_ERROR` | 502 | Geocoding provider returned an error | maps/google-maps-provider.ts |
| `GEOCODING_PROVIDER_RATE_LIMITED` | 429 | Geocoding provider is temporarily rate limited | maps/google-maps-provider.ts |
| `INSURANCE_DOCUMENT_NOT_FOUND` | 404 | Insurance document not found | documents/document-service.ts |
| `INSURANCE_EXPIRY_NOT_DETECTED` | 400 | Successful insurance analysis requires a detected expiry date | documents/document-service.ts |
| `INSURANCE_EXPIRY_REVIEW_REQUIRED` | 400 | Insurance expiry must be detected with sufficient confidence or manually verified | documents/document-service.ts |
| `INSURANCE_OCR_EMPTY` | 422 | No readable text was detected in the insurance image | documents/insurance-ocr-provider.ts |
| `INSURANCE_OCR_NOT_CONFIGURED` | 503 | Automatic insurance OCR is not configured | documents/insurance-ocr-provider.ts |
| `INSURANCE_OCR_PROVIDER_ERROR` | 502 | Insurance OCR provider returned an error / Insurance OCR provider rejected the image | documents/insurance-ocr-provider.ts |
| `INSURANCE_OCR_UNSUPPORTED_TYPE` | 422 | Automatic insurance OCR currently requires an image file | documents/insurance-ocr-provider.ts |
| `INVALID_ANALYSIS_CONFIDENCE` | 400 | Analysis confidence must be between 0 and 1 | documents/document-service.ts |
| `INVALID_CHAT_LIMIT` | 400 | Chat limit must be between 1 and 100 | chat/chat-service.ts |
| `INVALID_CHAT_MESSAGE` | 400 | Message must contain 1 to 2000 characters | chat/chat-service.ts |
| `INVALID_DECISION` | 400 | Decision must be accept or reject | services/route-change-service.ts |
| `INVALID_DEPARTURE_TIME` | 400 | departureAt must be a valid ISO timestamp | services/trip-draft-service.ts |
| `INVALID_DISPLAY_NAME` | 400 | Display name must contain 2 to 80 characters | profiles/profile-service.ts |
| `INVALID_DOCUMENT_CONTENT_TYPE` | 400 | Document content type is invalid | documents/document-service.ts |
| `INVALID_DOCUMENT_SHA256` | 400 | Document SHA-256 is invalid | documents/document-service.ts |
| `INVALID_DOCUMENT_SIZE` | 400 | Document size must be between 1 byte and 20 MiB | documents/document-service.ts |
| `INVALID_END_DATE` | 400 | endsOn must be YYYY-MM-DD | services/recurring-service.ts |
| `INVALID_FLEXIBILITY` | 400 | Flexibility must be between 0 and 60 minutes | services/trip-draft-service.ts |
| `INVALID_GEOCODE_QUERY` | 400 | Address must contain between 3 and 500 characters | maps/google-maps-provider.ts |
| `INVALID_HOLD_TTL` | 400 | Seat hold TTL must be between 30 and 3600 seconds | services/request-service.ts, services/reservation-service.ts |
| `INVALID_INSURANCE_EXPIRY` | 400 | Insurance expiry must use YYYY-MM-DD format / Insurance expiry date is invalid | vehicles/compliance-service.ts |
| `INVALID_LATITUDE` | 400 | Latitude must be between -90 and 90 | maps/google-maps-provider.ts |
| `INVALID_LEGAL_DOCUMENT` | 400 | Title and text are required | services/legal-service.ts |
| `INVALID_LOCATION_EVENT` | 400 | … must be a UUID / … is outside its valid range / recordedAt must be a valid ISO timestamp | live/tracking-service.ts |
| `INVALID_LONGITUDE` | 400 | Longitude must be between -180 and 180 | maps/google-maps-provider.ts |
| `INVALID_MAX_DETOUR` | 400 | Maximum detour is invalid | services/trip-draft-service.ts |
| `INVALID_MONTH` | 400 | Month must be YYYY-MM | services/payments-service.ts |
| `INVALID_OFFERED_SEATS` | 400 | Offered seats must be between 1 and 8 | services/trip-draft-service.ts |
| `INVALID_PASSENGER_SEATS` | 400 | Passenger seats must be between 1 and 8 | vehicles/vehicle-service.ts |
| `INVALID_PAYMENT_AMOUNT` | 400 | Payment amount must be exact integer cents | services/reservation-service.ts |
| `INVALID_PHONE_E164` | 400 | Phone number must be supplied in E.164 format, for example +34600111222 | auth/phone.ts |
| `INVALID_PICKUP_CODE` | 400 | Pickup code must contain exactly 6 digits | services/trip-execution-service.ts |
| `INVALID_POLICY_RULES` | 400 | … must be an integer between 0 and 10000 / … is required / Rules must be an object / passenger must list 1 to 10 tiers / passenger[…].minMinutesBeforeDeparture must be a non-negative integer / passenger tiers must include one with minMinutesBeforeDeparture 0 | domain/cancellation-policy.ts |
| `INVALID_PRIVATE_OBJECT` | 400 | Private object reference is invalid | documents/document-service.ts |
| `INVALID_RATING` | 400 | Score must be an integer between 1 and 5 / Comment must be at most 500 characters | services/feedback-service.ts |
| `INVALID_REPORT` | 400 | Unknown report category / Description must contain 10 to 2000 characters / You cannot report yourself | services/feedback-service.ts |
| `INVALID_ROLE` | 400 | Unknown staff role | services/admin-service.ts |
| `INVALID_ROUTE_CHANGE_POINT` | 400 | … is not a valid coordinate | services/route-change-service.ts |
| `INVALID_SEARCH_COORDINATE` | 400 | … is outside its valid range | services/trip-search-service.ts |
| `INVALID_SEARCH_DATE` | 400 | … is invalid | services/trip-search-service.ts |
| `INVALID_SEARCH_LIMIT` | 400 | Search limit must be between 1 and 100 | services/trip-search-service.ts |
| `INVALID_SEARCH_RADIUS` | 400 | Search radius must be between 100 and 50000 meters | services/trip-search-service.ts |
| `INVALID_SEARCH_WINDOW` | 400 | departureBefore must be after departureAfter | services/trip-search-service.ts |
| `INVALID_SEGMENT_RANGE` | 400 | Requested segment range is not contiguous / Segment range is invalid | services/request-service.ts, services/reservation-service.ts, services/tariff-service.ts |
| `INVALID_SELF_SERVICE_ROLES` | 400 | roles must be an array / Select passenger, driver, or both / Only passenger and driver roles may be requested during self-service registration | auth/phone.ts |
| `INVALID_STALE_THRESHOLD` | 400 | staleAfterSeconds must be between 5 and 3600 | live/tracking-service.ts |
| `INVALID_TARIFF` | 400 | … must be an integer between … and … / sharedCostCapCents must be a non-negative integer | services/tariff-service.ts |
| `INVALID_VEHICLE_FIELD` | 400 | … is invalid | vehicles/vehicle-service.ts |
| `INVALID_VEHICLE_PLATE` | 400 | Vehicle plate is invalid | vehicles/vehicle-service.ts |
| `INVALID_VERIFICATION_CODE` | 400 | Verification code must contain 4 to 10 characters | auth/provider.ts |
| `INVALID_WEEK` | 400 | weekStart must be YYYY-MM-DD | services/recurring-service.ts |
| `INVALID_WEEKDAYS` | 400 | Weekdays must be ISO numbers 1 (Monday) to 7 (Sunday) | services/recurring-service.ts |
| `LEGAL_ACCEPTANCE_REQUIRED` | 409 | Current terms must be accepted first | services/legal-service.ts |
| `LEGAL_DOCUMENT_NOT_CURRENT` | 409 | Only the current published version can be accepted | services/legal-service.ts |
| `LEGAL_DOCUMENT_NOT_DRAFT` | 409 | Only drafts can be published | services/legal-service.ts |
| `LEGAL_DOCUMENT_NOT_FOUND` | 404 | Legal document not found | services/legal-service.ts |
| `LEGAL_DOCUMENT_REQUIRED` | 400 | At least one document is required | services/legal-service.ts |
| `LIVE_POSITION_STALE` | 409 | The car's position is not recent enough to accept a pickup while moving | services/route-change-service.ts, services/trip-progress-service.ts |
| `LOCATION_EVENT_FROM_FUTURE` | 422 | GPS timestamp is too far in the future | live/tracking-service.ts |
| `LOCATION_EVENT_TOO_OLD` | 422 | GPS event is older than 24 hours | live/tracking-service.ts |
| `LOCATION_FORBIDDEN` | 403 | Only the trip driver may publish location | live/tracking-service.ts |
| `MAPS_PROVIDER_NOT_CONFIGURED` | 503 | Geocoding provider is not configured | routes/geocoding-routes.ts |
| `MAPS_PROVIDER_UNAVAILABLE` | 503 | A real routing provider is not configured | services/route-change-service.ts, services/trip-draft-service.ts |
| `MVC_ROUTE_UNVERIFIED` | 400 | Verified routed geometry and distance are required | services/trip-service.ts |
| `MVC_STOP_OUTSIDE_PROVINCE` | 400 | One or more stops are outside the trip province | services/trip-service.ts |
| `NO_CAPACITY_ON_SEGMENT` | 409 | No seat capacity on at least one affected segment | services/request-service.ts, services/reservation-service.ts, services/route-change-service.ts |
| `NO_ROUTE_WITHIN_PROVINCE` | 422 | No provider route candidate remains entirely inside the selected province / At least one requested leg has no driving route that remains inside the selected province / Combined route does not remain inside the selected province | maps/province-route-service.ts |
| `OFFERED_SEATS_EXCEED_VEHICLE` | 422 | Offered seats exceed vehicle capacity | services/trip-draft-service.ts, services/trip-service.ts |
| `PAYMENT_AMOUNT_MISMATCH` | 409 | Paid amount differs from the agreed quote | services/reservation-service.ts |
| `PAYMENT_EVENT_NOT_FOUND` | 404 | Payment event not found | services/payments-service.ts |
| `PAYMENTS_PROVIDER_UNAVAILABLE` | 503 | No payment provider is configured | routes/payment-routes.ts |
| `PAYOUT_AMOUNT_MISMATCH` | 409 | Provider payout amount differs | services/payments-service.ts |
| `PAYOUT_PERIOD_NOT_CLOSED` | 409 | Payouts can only be prepared for a month that has ended | services/payments-service.ts |
| `PICKUP_ALREADY_PASSED` | 409 | The car has already gone past this pickup point / The car has already passed every possible pickup point / The car has already passed this pickup point | services/route-change-service.ts, services/trip-progress-service.ts |
| `PICKUP_ATTEMPTS_EXCEEDED` | 429 | Maximum pickup code attempts exceeded | services/trip-execution-service.ts |
| `PICKUP_CODE_INVALID` | 401 | Pickup code is invalid | services/trip-execution-service.ts |
| `PICKUP_CODE_NOT_GENERATED` | 409 | Passenger has not generated a pickup code | services/trip-execution-service.ts |
| `POLICY_NOT_DRAFT` | 409 | Only draft policies can be activated | services/cancellation-service.ts |
| `POLICY_NOT_FOUND` | 404 | Policy not found | services/cancellation-service.ts |
| `PRIVATE_STORAGE_NOT_CONFIGURED` | 503 | Private file storage is not configured | storage/provider.ts |
| `PRIVATE_UPLOAD_SIZE_INVALID` | 422 | File size must be between 1 byte and 20 MiB | documents/private-upload-service.ts |
| `PRIVATE_UPLOAD_TYPE_NOT_ALLOWED` | 422 | File type is not allowed for this upload | documents/private-upload-service.ts |
| `PROFILE_NOT_FOUND` | 404 | Profile not found | profiles/profile-service.ts |
| `PROVINCE_DATA_ALREADY_IMPORTED` | 409 | This exact province dataset has already been imported | geo/province-import.ts |
| `PROVINCE_DATA_DUPLICATE_CODE` | 400 | Duplicate province code … | geo/province-import.ts |
| `PROVINCE_DATA_INVALID` | 400 | … must be a non-empty string / Province dataset must be a GeoJSON FeatureCollection / Province dataset must contain at least one GeoJSON feature | geo/province-import.ts |
| `PROVINCE_DATA_INVALID_CODE` | 400 | Expected a two-digit province code, received "…" / Invalid BDLJE NATCODE "…" | geo/province-import.ts |
| `PROVINCE_DATA_INVALID_CODE_MODE` | 400 | codeMode must be two-digit or natcode | geo/province-import.ts |
| `PROVINCE_DATA_INVALID_DATE` | 400 | sourceDate must use YYYY-MM-DD | geo/province-import.ts |
| `PROVINCE_DATA_INVALID_FEATURE` | 400 | Feature … is incomplete | geo/province-import.ts |
| `PROVINCE_DATA_INVALID_GEOMETRY` | 400 | Feature … must be Polygon or MultiPolygon / Province … has unusable geometry | geo/province-import.ts |
| `PROVINCE_DATA_INVALID_SHA256` | 400 | Dataset SHA-256 must contain 64 hexadecimal characters | geo/province-import.ts |
| `PROVINCE_DATA_INVALID_URL` | 400 | sourceUrl must be a valid HTTPS URL / sourceUrl must use HTTPS | geo/province-import.ts |
| `PROVINCE_NOT_FOUND` | 404 | Province not found / No province boundary contains the supplied point | maps/province-route-service.ts, routes/province-routes.ts |
| `RATING_ALREADY_SUBMITTED` | 409 | You already rated this booking | services/feedback-service.ts |
| `RATING_NOT_AVAILABLE` | 409 | Ratings open once the trip is completed | services/feedback-service.ts |
| `REASON_REQUIRED` | 400 | A reason is required | services/admin-service.ts |
| `RECURRING_TRIP_NOT_READY` | 409 | Recurring trip scheduling is not implemented yet | services/trip-draft-service.ts |
| `REFUND_AMOUNT_MISMATCH` | 409 | Refunded amount differs from the policy amount | services/payments-service.ts |
| `REPORT_CLOSED` | 409 | Report is already closed | services/feedback-service.ts |
| `REPORT_NOT_FOUND` | 404 | Report not found | services/feedback-service.ts |
| `REPORT_RATE_LIMITED` | 429 | Too many reports in the last 24 hours | services/feedback-service.ts |
| `REPORTED_USER_NOT_IN_TRIP` | 400 | The reported person was not on this trip / Passengers can only report the driver | services/feedback-service.ts |
| `REQUEST_NOT_ACCEPTED` | 400 | Driver must accept the request before payment hold | services/reservation-service.ts |
| `REQUEST_NOT_CANCELLABLE` | 409 | Booking cannot be cancelled / Trip already completed / This request can no longer be cancelled | services/cancellation-service.ts |
| `REQUEST_NOT_FOUND` | 404 | Ride request not found | services/cancellation-service.ts, services/request-service.ts, services/reservation-service.ts |
| `REQUEST_NOT_OWNED` | 403 | Not your request | services/cancellation-service.ts |
| `REQUEST_NOT_PENDING` | 409 | Only pending requests can be decided | services/request-service.ts |
| `RESOLUTION_NOTE_REQUIRED` | 400 | Closing a report requires a note | services/feedback-service.ts |
| `REVIEW_REASON_REQUIRED` | 400 | A rejection reason is required | documents/document-service.ts, services/admin-service.ts, vehicles/vehicle-service.ts |
| `REVIEW_REASON_TOO_LONG` | 400 | Review reason is too long | documents/document-service.ts, vehicles/vehicle-service.ts |
| `ROUTE_CHANGE_NOT_ASKED` | 403 | This change does not need your answer | services/route-change-service.ts |
| `ROUTE_CHANGE_NOT_FOUND` | 404 | Route change not found | services/route-change-service.ts |
| `ROUTE_CHANGE_NOT_PENDING` | 409 | This detour request is no longer waiting for you / This change is no longer waiting for your answer | services/route-change-service.ts |
| `ROUTE_NOT_FOUND` | 404 | No driving route was found | maps/google-maps-provider.ts |
| `ROUTE_POINT_OUTSIDE_PROVINCE` | 422 | Origin, destination and every intermediate stop must be inside the selected province | maps/province-route-service.ts |
| `ROUTING_PROVIDER_BAD_RESPONSE` | 502 | Routing provider returned an invalid duration / Routing provider returned no route geometry / Routing provider returned an invalid GeoJSON LineString / Invalid route coordinate at index … / Routing provider returned invalid JSON / Routing provider returned an invalid distance / Segmented route produced no usable geometry | maps/google-maps-provider.ts, maps/province-route-service.ts |
| `ROUTING_PROVIDER_ERROR` | 502 | Routing provider returned an error | maps/google-maps-provider.ts |
| `ROUTING_PROVIDER_RATE_LIMITED` | 429 | Routing provider is temporarily rate limited | maps/google-maps-provider.ts |
| `SEGMENT_CAPACITY_INVALID` | 400 | Segment capacity exceeds offered seats | services/trip-service.ts |
| `SELF_DEMOTION_FORBIDDEN` | 403 | You cannot remove your own admin role | services/admin-service.ts |
| `SELF_REVIEW_FORBIDDEN` | 403 | You cannot review your own profile | services/admin-service.ts |
| `SELF_SUSPEND_FORBIDDEN` | 403 | You cannot change your own status | services/admin-service.ts |
| `SERIES_NOT_FOUND` | 404 | Series not found / Series not found or already ended | services/recurring-service.ts |
| `SMS_PROVIDER_BAD_RESPONSE` | 502 | SMS provider returned an invalid verification identifier | auth/provider.ts |
| `SMS_PROVIDER_ERROR` | 502 | SMS verification provider returned an error | auth/provider.ts |
| `SMS_PROVIDER_UNAVAILABLE` | 503 | SMS verification provider is not configured | auth/provider.ts |
| `SMS_RATE_LIMITED` | 429 | SMS verification is temporarily rate limited | auth/provider.ts |
| `TARIFF_HAS_NO_RATE` | 409 | Tariff has no rate | services/tariff-service.ts |
| `TARIFF_NOT_DRAFT` | 409 | Only draft tariffs can be approved | services/tariff-service.ts |
| `TARIFF_NOT_FOUND` | 404 | Tariff not found | services/tariff-service.ts |
| `TOO_MANY_STOPS` | 400 | A trip can contain at most 10 intermediate stops | services/trip-draft-service.ts |
| `TRIP_ALREADY_IN_SERIES` | 409 | This trip already repeats | services/recurring-service.ts |
| `TRIP_ALREADY_STARTED` | 409 | A trip in progress cannot be cancelled; finish it instead | services/cancellation-service.ts |
| `TRIP_ETA_FORBIDDEN` | 403 | Only the driver and confirmed passengers can see this trip's ETA | services/trip-progress-service.ts |
| `TRIP_NOT_BOOKABLE` | 409 | Trip is not bookable | services/request-service.ts, services/reservation-service.ts, services/route-change-service.ts |
| `TRIP_NOT_CANCELLABLE` | 409 | Trip cannot be cancelled | services/cancellation-service.ts |
| `TRIP_NOT_COMPLETABLE` | 409 | Only an active trip may be completed | services/trip-execution-service.ts |
| `TRIP_NOT_DRAFT` | 400 | Only draft trips can be published | services/trip-service.ts |
| `TRIP_NOT_FOUND` | 404 | Trip not found | chat/chat-service.ts, live/tracking-service.ts, services/cancellation-service.ts, services/feedback-service.ts, services/recurring-service.ts, services/request-service.ts, services/route-change-service.ts, services/trip-draft-service.ts, services/trip-execution-service.ts, services/trip-progress-service.ts, services/trip-service.ts |
| `TRIP_NOT_LIVE` | 409 | Location may only be published for an active trip / Pickup code is available only while the trip is active / Pickup may only be verified during an active trip | live/tracking-service.ts, services/trip-execution-service.ts |
| `TRIP_NOT_OWNED` | 403 | Only the driver can cancel this trip / Only the driver can repeat this trip / Not your trips / Only the trip driver can view its requests / Only the trip driver can decide this request / Only the trip driver can decide this detour / Only the trip driver can view detour requests / Only the trip driver may publish it / Only the trip driver may start it / Only the trip driver may verify pickup / Only the trip driver may complete it | services/cancellation-service.ts, services/recurring-service.ts, services/request-service.ts, services/route-change-service.ts, services/trip-draft-service.ts, services/trip-execution-service.ts |
| `TRIP_NOT_PARTICIPANT` | 403 | Only trip participants can report on it | services/feedback-service.ts |
| `TRIP_NOT_REPEATABLE` | 409 | Only an upcoming trip with a departure time can repeat | services/recurring-service.ts |
| `TRIP_NOT_STARTABLE` | 409 | Only a published trip may be started | services/trip-execution-service.ts |
| `TRIP_ROUTE_INCOMPLETE` | 409 | Trip has no complete stop and segment plan | services/route-change-service.ts |
| `TRIP_SEGMENTS_REQUIRED` | 400 | At least one route segment is required | services/trip-service.ts |
| `UPLOAD_INTENT_EXPIRED` | 410 | Upload intent has expired | documents/private-upload-service.ts |
| `UPLOAD_INTENT_NOT_FOUND` | 404 | Upload intent not found | documents/private-upload-service.ts |
| `UPLOAD_STORAGE_MISMATCH` | 409 | Upload storage provider mismatch | documents/private-upload-service.ts |
| `UPLOADED_FILE_SIZE_MISMATCH` | 422 | Uploaded file size does not match the declared size / Uploaded file byte count is invalid | documents/private-upload-service.ts |
| `UPLOADED_FILE_TYPE_MISMATCH` | 422 | Uploaded file content type does not match the declared type | documents/private-upload-service.ts |
| `USER_NOT_FOUND` | 404 | User not found | chat/chat-service.ts, routes/me-routes.ts, services/admin-service.ts |
| `VEHICLE_DOCUMENT_REQUIRES_VEHICLE` | 400 | Vehicle document requires a vehicle | documents/document-service.ts |
| `VEHICLE_INSURANCE_EXPIRED` | 409 | Expired insurance cannot be approved / Vehicle insurance has expired. Upload and validate the renewal before driving | documents/document-service.ts, vehicles/compliance-service.ts |
| `VEHICLE_INSURANCE_EXPIRY_REQUIRED` | 409 | Insurance expiry date must be verified before driving | vehicles/compliance-service.ts |
| `VEHICLE_INSURANCE_REQUIRED` | 409 | Approved vehicle insurance is required before driving | vehicles/compliance-service.ts |
| `VEHICLE_NOT_APPROVED` | 400 | Vehicle and documentation must be approved | services/trip-service.ts |
| `VEHICLE_NOT_FOUND` | 404 | Vehicle not found | documents/document-service.ts, documents/private-upload-service.ts, services/trip-draft-service.ts, vehicles/compliance-service.ts, vehicles/vehicle-service.ts |
| `VEHICLE_NOT_OWNED` | 403 | You cannot attach a document to another user's vehicle / You cannot upload files for another user's vehicle / Only the vehicle owner may create a trip with it / You cannot modify another user's vehicle | documents/document-service.ts, documents/private-upload-service.ts, services/trip-draft-service.ts, vehicles/vehicle-service.ts |
| `VEHICLE_PHOTO_REQUIRED` | 409 | An approved vehicle photo is required before driving | vehicles/compliance-service.ts |
| `VEHICLE_PLATE_ALREADY_EXISTS` | 409 | Vehicle plate already exists | vehicles/vehicle-service.ts |
| `WEBHOOK_CURRENCY_UNSUPPORTED` | 400 | Only EUR is supported | payments/stripe-adapter.ts |
| `WEBHOOK_PAYLOAD_INVALID` | 400 | Amount is not integer cents / Not a Stripe event / Body is not JSON / Payment has no requestId metadata | payments/stripe-adapter.ts, routes/payment-routes.ts, services/payments-service.ts |
| `WEBHOOK_SIGNATURE_EXPIRED` | 400 | Webhook timestamp outside tolerance | payments/stripe-adapter.ts |
| `WEBHOOK_SIGNATURE_INVALID` | 400 | Malformed Stripe-Signature header / Stripe signature does not match | payments/stripe-adapter.ts |
| `WEBHOOK_SIGNATURE_MISSING` | 400 | Missing Stripe-Signature header | payments/stripe-adapter.ts |
| `WEEK_NOT_BOOKABLE` | 409 | No occurrence of that week could be requested | services/recurring-service.ts |
| `WEEKLY_GROUP_NOT_FOUND` | 404 | No pending requests in that week | services/recurring-service.ts |
