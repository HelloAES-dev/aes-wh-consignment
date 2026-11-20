# Consignment Withdrawal System

## Project status

Planning phase. No production backend or customer workflow has been implemented yet.

## Purpose

Track serialized tires from warehouse shipment through sugar-mill receiving and customer withdrawal.

```text
Warehouse shipment
    -> sugar-mill receiving
    -> customer withdrawal request
    -> admin approval
```

## Users

- Warehouse staff: create consignment item records before shipment.
- Sugar-mill checker: scan every tire QR code when tires arrive.
- Customer user: scan a tire serial number, attach a photo, and submit a withdrawal request.
- Admin: review, approve, or reject withdrawal requests.

## Current technical constraints

- Google Sheets is the first database.
- Google Apps Script is the first backend.
- The frontend is a mobile web app.
- A 2D scanner connects to a phone over USB-C and behaves like a keyboard.
- Tire serial QR content is the primary identifier at the sugar mill and customer site.
- Photos are stored in the company Google Drive or Shared Drive.
- Google Chat receives one-way notifications for new requests.

## Planned lifecycle

```text
READY_TO_SHIP
    -> SHIPPED
    -> AVAILABLE
    -> WITHDRAWAL_SUBMITTED
    -> APPROVED
    -> WITHDRAWN
```

## Documentation map

- `docs/DATA_MODEL.md` — sheets, columns, identifiers, and statuses.
- `docs/BUSINESS_RULES.md` — workflow rules, permissions, and failure behavior.
- `docs/UI_DESIGN.md` — screens and interaction behavior.
- `docs/TEST_PLAN.md` — acceptance scenarios before deployment.
- `AGENTS.md` — coding and Codex working instructions.

## Deliberately postponed

- PostgreSQL or Supabase migration.
- Full offline-first synchronization.
- Interactive Google Chat approval buttons.
- Automated invoice or Postman integration.
