# Consignment Withdrawal System

## Project status

Foundation phase. GitHub Pages deployment, Google Sign-In, permission-based home
navigation, and the first ADMIN account-management module are implemented. The
receiving backend and mobile scanning interface are implemented; deployment and
end-to-end testing with real Sheet rows and scanner hardware are still pending.

## Purpose

Track serialized tires from warehouse shipment through sugar-mill receiving and customer withdrawal.

```text
Warehouse shipment
    -> sugar-mill receiving
    -> customer withdrawal request
    -> admin ERP confirmation
```

## Users

- Warehouse staff: create consignment item records before shipment.
- Sugar-mill checker: scan every tire QR code when tires arrive.
- Customer user: scan a tire serial number, attach a photo, and submit a withdrawal request.
- Admin: manage accounts and confirm completed ERP orders for withdrawals.

## Current technical constraints

- Google Sheets is the first database.
- Google Apps Script is the first backend.
- The frontend is a mobile web app.
- A 2D scanner connects to a phone over USB-C and behaves like a keyboard.
- Tire serial QR content is the primary identifier at the sugar mill and customer site.
- The current tire serial format is exactly 10 uppercase English letters or
  digits, such as `D001000955` or `TN05200154`.
- Photos are stored in the company Google Drive or Shared Drive.
- Google Chat receives one-way notifications for new requests.

## Current authentication and access management

- Google Identity Services renders the sign-in button on the root page.
- A short-lived ID token is kept in same-tab `sessionStorage` so an authorized
  user can open an operational page without placing credentials in a URL.
- Apps Script verifies the Google ID token and checks
  `CONFIG : อีเมลที่ได้รับสิทธิ์`.
- Backend permissions determine which application modes are visible; workers
  do not select their own permissions.
- An active account with `is_admin = TRUE` can search the customer master, add
  authorized accounts, and activate or deactivate accounts without deleting
  rows.
- Thai is the primary user-facing language.

## Planned lifecycle

```text
READY_TO_SHIP
    -> RECEIVED
    -> WITHDRAWN
```

The withdrawal transaction has a separate administrative lifecycle:

```text
SUBMITTED
    -> APPROVED
```

The customer can use the tire immediately after a successful withdrawal
submission. `APPROVED` records that an internal Admin completed the separate
ERP order; it is not a pre-withdrawal permission.

## Documentation map

- `docs/AGENT_BLUEPRINT.md` — reusable project-start blueprint and interview checklist.
- `docs/DATA_MODEL.md` — sheets, columns, identifiers, and statuses.
- `docs/BUSINESS_RULES.md` — workflow rules, permissions, and failure behavior.
- `docs/UI_DESIGN.md` — screens and interaction behavior.
- `docs/TEST_PLAN.md` — acceptance scenarios before deployment.
- `docs/project-roadmap/` — owner-facing HTML progress checklist for the three operational flows and supporting foundation work.
- `docs/project-log/` — daily project summaries created with `SUMMARIZE`.
- `AGENTS.md` — coding and Codex working instructions.

## Frontend structure

The authenticated landing page stays at the repository root because it is the
public application entry point. Operational pages are organized separately:

```text
index.html
style.css
script.js
pages/
├── receiving/
├── withdrawal/
├── admin-accounts/
└── admin-erp/
```

GitHub Actions publishes the root entry files and the complete `pages/` and
`assets/` directories, plus the owner-facing project roadmap at
`docs/project-roadmap/`. Backend files and the remaining project documentation
are not included in the GitHub Pages artifact.

## Deliberately postponed

- PostgreSQL or Supabase migration.
- Full offline-first synchronization.
- Interactive Google Chat approval buttons.
- Automated invoice or Postman integration.
