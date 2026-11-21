# MMG OQVELA — Store Hours, Holidays and Availability Architecture

Status: approved product direction / design specification. This document is not evidence that the feature has been implemented.

## 1. Purpose

Opening hours are operational rules used by the storefront, checkout, pickup, delivery and booking capabilities. They are not just text shown in a footer. The design must work for shops, pharmacies, clinics, restaurants, bakeries, salons, repair services and multi-branch businesses.

## 2. Separate schedules by scope

A store may define:
- Store/branch public opening hours.
- Customer-service hours.
- Online ordering hours.
- Pickup hours.
- Delivery hours.
- Appointment/booking hours.
- Department/service-specific availability.

A channel may remain available while another is closed. For example, online ordering can accept scheduled orders after the physical shop closes, while delivery slots remain unavailable.

Staff shifts, attendance and employee availability are separate systems. Opening hours do not imply that a specific employee, clinician, room or resource is available.

## 3. Weekly recurring schedule

For each store/branch and schedule channel:
- Select an IANA timezone such as `Asia/Damascus`; do not store only a fixed UTC offset.
- Configure each weekday as closed or with one or more opening intervals.
- Support split shifts and breaks (for example morning and evening service).
- Support overnight intervals crossing midnight.
- Validate malformed, zero-length and conflicting intervals; represent overnight periods explicitly so the next weekday is not accidentally treated as open.
- Allow copying a schedule to selected branches as a starting point, without overwriting branch-specific exceptions later.

## 4. Calendar exceptions and holidays

Support:
- One-off public/religious/cultural holiday closures.
- Annual recurring holidays where the date rule is reliable.
- Store-specific holidays and owner-selected days off.
- Special opening, extended hours and shortened hours.
- Maintenance, inventory count, staff training and emergency closure.
- Temporary service-specific closure (for example delivery paused while walk-in remains open).

An exception must define its local date or date range, affected channel(s), status (closed or special intervals), optional customer-facing message, creator, timestamps and audit history.

Do not hard-code a national holiday calendar as immutable truth. Let the owner review/enable/ignore imported holiday suggestions. Imported sources require reliability and licensing review. The store owner can override a suggested holiday.

When exceptions overlap, apply a documented precedence: emergency/explicit store override, specific dated exception, then recurring weekly schedule. The UI must show which rule is currently controlling availability.

## 5. After-hours policy

Per channel, configure one of:
1. Stop accepting new orders/bookings.
2. Accept an order but queue it for the next opening period.
3. Accept scheduled/pre-orders with a selected future slot.
4. Continue accepting requests for manual confirmation.

The public interface must clearly state the next opening/processing time. Never imply immediate fulfillment while the relevant service is closed.

For delivery and pickup, additionally configure:
- Preparation/packing lead time.
- Order cutoff and minimum advance notice.
- Slot duration and capacity.
- Blackout dates.
- Delivery zones and per-slot capacity.
- Optional buffers between appointments or fulfillment windows.

Checkout and booking endpoints must validate availability server-side and recheck it when committing. Hiding a button in the browser is not sufficient.

## 6. Booking and resource availability

Appointments are a separate capability built on top of opening hours. A bookable slot requires all relevant conditions:
- Store/branch and service are open.
- Selected staff member is working and qualified for the service.
- Required room/equipment/resource is available.
- Service duration and cleanup/buffer fit the slot.
- Existing bookings and capacity limits allow the reservation.
- Holiday, blackout, cancellation and advance-booking rules permit it.

Do not infer clinician or employee availability from store opening hours alone. Confirmed bookings must not be silently deleted by later schedule changes; use cancellation/rescheduling workflows and notify affected customers through configured channels.

## 7. Customer-facing behavior

The storefront may show:
- Open now / closed now.
- Today's opening intervals.
- Next opening time.
- Holiday or temporary closure notice.
- Separate delivery, pickup or appointment availability where enabled.

Display local store time and timezone context when needed. Never expose internal notes, employee shifts or sensitive operational details.

## 8. Administration and permissions

- Owner/admin can configure schedules and emergency closure.
- A delegated manager may receive schedule permissions without receiving unrelated financial or user-management permissions.
- Every change records actor, timestamp, previous value and new value.
- Emergency closure/reopening requires an audit entry and optional public notice.
- Existing confirmed orders/bookings must be reviewed and resolved, not silently removed.
- Staff can receive in-app reminders for upcoming special hours when notifications are enabled.

## 9. Suggested data model (design only)

Keep recurring rules and date exceptions separate:
- `store_schedule_settings`: store/branch, timezone, default behavior and configuration version.
- `store_schedule_rules`: scope/channel, weekday, open/closed and local interval definitions.
- `store_schedule_exceptions`: local date/range, exception type, affected scope/channel, override intervals, public message, recurrence metadata and audit fields.
- `service_availability_policies`: after-hours behavior, lead time, cutoff, slot duration, capacity and buffers.
- Booking/resource calendars belong to the booking capability and must reference the relevant store/branch/service/staff/resource.

This is conceptual only. Before migrations, inspect the current schema and route conventions, choose tenant-safe composite foreign keys, define interval representation and indexes, and test migration rollback. Do not store a single JSON blob as the only queryable source for all schedules.

## 10. Required tests

- All weekdays and closed days.
- Multiple intervals and breaks.
- Overnight hours and midnight boundaries.
- Timezone conversion and daylight-saving changes.
- Leap days and year boundaries.
- Holiday override versus weekly rule.
- Branch-specific override versus copied central schedule.
- Emergency closure and reopening.
- Closed storefront with scheduled online ordering.
- Delivery closed while pickup remains open.
- Concurrent attempts to claim the final booking/delivery slot.
- A schedule edit after an order or appointment has already been confirmed.
- Arabic RTL and English LTR display, mobile and desktop behavior.

## 11. Delivery sequence

1. Add timezone and schedule management with read-only public display.
2. Add date exceptions and customer-facing open/closed state.
3. Enforce after-hours rules on checkout and pickup/delivery.
4. Add slot capacity and scheduled fulfillment.
5. Add appointment booking and staff/resource calendars as a separate capability.
6. Add holiday import integrations only after source reliability and licensing review.

Do not mark any stage complete until APIs, permissions, tests and user interfaces are delivered and verified.
