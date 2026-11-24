# Next Migration: Google Sheets to Supabase

## Purpose

This document records the planned migration path from the current Google
Sheets and Apps Script system to a production-oriented database architecture.
It is a design direction, not an instruction to migrate immediately.

The current project uses Google Sheets because the team already understands it,
master data can be entered quickly, and the first business deadline is short.
The future architecture can be introduced after the workflow is stable and the
team has time to learn SQL and database operations.

## Current architecture

```text
Google Sheets
    ↓
Google Apps Script
    ↓
Mobile web application
```

In the current phase:

- Google Sheets is the operational source of truth.
- Apps Script validates permissions and business rules.
- The web application is the controlled user interface.
- Photos are stored in company Google Drive or Shared Drive.
- Google Chat is a notification destination, not the source of truth.

This architecture is appropriate for the current deadline and team workflow.
It is not a failure to start with Sheets when the system is intentionally
small and the team needs fast adoption.

## Future production architecture

```text
Supabase Postgres
        ↓
Supabase Edge Functions (TypeScript/Deno)
        ↓
Web application

Supabase Storage → photos
Supabase Queues  → retryable background jobs
Google Chat      → notification destination
Google Sheets    → reporting and team visibility
```

Supabase Edge Functions use a Deno-compatible TypeScript runtime. Bun is not a
requirement for this design. A Bun backend could be deployed separately later,
but the application does not need Bun to become production-grade.

## Source-of-truth rule

Every important business record must have one authoritative system.

### Current phase

```text
Google Sheets = source of truth
```

### Future phase

```text
Supabase Postgres = source of truth
Google Sheets = reporting/export surface
```

Do not allow the database and a reporting spreadsheet to become two competing
sources of truth without an explicit import and conflict-resolution process.

## UI-controlled data changes

Production users should normally not edit database tables directly.
Operational changes should follow this path:

```text
User
    ↓
Permission-checked UI
    ↓
Backend validation
    ↓
Database transaction
    ↓
Audit history
```

Direct database editing should be limited to developers, database
administrators, controlled migrations, and carefully documented emergency
support.

The UI should enforce rules such as:

- Required fields.
- Valid customer and product selection.
- Duplicate prevention.
- Allowed status transitions.
- Customer ownership.
- Permission checks.
- Audit identity and timestamps.

## Master-data design

Separate database tables are not "cold data." They are structured source data
that can be joined when the application needs a complete view.

Example normalized tables:

```text
customers
customer_contacts
customer_credit_terms
customer_status_history
customer_care_assignments
products
product_lots
```

The application can query or expose a joined reporting view such as:

```text
customer_master_report
```

That view can contain:

```text
customer_id
customer_name
address
contact_name
contact_email
credit_limit
payment_terms
customer_status
care_taker
```

SQL `JOIN` plays the role that `XLOOKUP` often plays in a spreadsheet, but the
relationship is defined and controlled in the database query layer.

Do not over-normalize without a real business need. Start with clear entities,
stable identifiers, foreign keys, and useful audit fields.

## Google Sheets reporting strategy

When Postgres becomes the source of truth, export joined reporting views to
Google Sheets:

```text
Normalized database tables
        ↓
SQL view or joined query
        ↓
Scheduled or on-demand export
        ↓
Google Sheets reporting tab
```

Recommended usage:

- Daily or 12-hour export for management reporting.
- On-demand or near-real-time export for operational visibility.
- No spreadsheet formulas required for core relationships.
- Keep technical source tables separate in Postgres.
- Present a denormalized, human-friendly table in Sheets.

## If the team must edit through Google Sheets

Use a controlled staging workflow instead of direct silent write-back:

```text
Google Sheet staging area
        ↓
Backend validation
        ↓
Approval or import result
        ↓
Database update
        ↓
Audit log
```

The import process should detect invalid rows, duplicate identifiers,
conflicting updates, missing references, and unauthorized changes. The real
database remains authoritative after import.

## Reliable notifications

External notifications such as Google Chat should not be part of the critical
transaction that saves a withdrawal.

Preferred future flow:

```text
Database transaction:
  save withdrawal
  change inventory
  enqueue Chat notification

Return success to the user

Background worker:
  read queue message
  send Google Chat message
  mark SENT or retry later
```

If Google Chat is unavailable:

```text
Withdrawal remains saved
Admin queue remains visible
Notification job remains retryable
```

This separates business data durability from notification availability.

## Migration phases

### Phase 1 — Current deadline

```text
Google Sheets = source of truth
Apps Script = backend
Web application = controlled UI
```

Finish and stabilize the receiving, withdrawal, Admin approval, and Chat
notification flows.

### Phase 2 — Database learning project

- Learn PostgreSQL basics and SQL joins.
- Design stable identifiers and foreign keys.
- Create a small Supabase development project.
- Recreate customer, product, lot, consignment, receiving, and withdrawal
  entities.
- Add Row-Level Security and role-based policies.
- Keep the production Sheets system unchanged while experimenting.

### Phase 3 — Dual-read validation

- Import a copy of historical Sheets data into Supabase.
- Compare totals, statuses, serial counts, and customer ownership.
- Build joined reporting views.
- Export those views to a separate test Google Sheet.
- Do not switch production writes yet.

### Phase 4 — Controlled cutover

- Freeze the final Sheets migration snapshot.
- Import and reconcile data.
- Switch the application backend to Supabase Edge Functions.
- Keep Sheets as a read-only reporting destination.
- Monitor errors, retries, audit records, and user workflows.

### Phase 5 — Production hardening

- Add durable notification queues.
- Add background retry workers.
- Add database backups and recovery procedures.
- Add monitoring and alerting.
- Add load and concurrency tests.
- Document rollback procedures.

## Decision summary

- Starting with Google Sheets is a pragmatic delivery decision.
- A production database should become the source of truth later.
- Users should edit through controlled UI, not raw database tables.
- Normalized master tables should remain separate internally.
- SQL views and joins should create human-friendly reporting outputs.
- Google Sheets should become a reporting or controlled staging surface.
- Supabase Queues or an equivalent durable queue should handle Chat retries.
- The migration should be staged; do not rewrite the working application blindly.
