# wh-consignment — 2026-11-21

## Summary

Built and deployed the first working ADMIN account-management flow. The
frontend now uses backend-controlled access, the Admin can manage authorized
Google accounts through the web UI, and confirmed tests successfully updated
the Google Sheet. The session also established the AES visual style and
clarified the next authorization-model improvement for users who need more
than one operational permission.

## Completed work

### Authentication and role-based navigation

- Added a role-based home screen after Google Sign-In.
- Removed any requirement for workers to choose their own role.
- Kept the backend as the authorization source of truth.
- Displayed only the module allowed by the authenticated account.
- Added placeholders for the future receiving and withdrawal modules.

### ADMIN account management

- Added an ADMIN-only authorized-account screen.
- Added customer search by code or name from `MASTER : Customer`.
- Added authorized-account creation with email, role, and customer validation.
- Added active/inactive account management without deleting rows.
- Added **แก้ไขสิทธิ์** for changing an existing account's role and linked
  customer.
- Kept the Google email immutable during access editing.
- Prevented an Admin from deactivating or changing the access of their own
  signed-in account.
- Added backend audit updates using `updated_at` and `updated_by`.
- Added `LockService` protection around account writes.
- Confirmed through user testing that the UI can update the Google Sheet.

### Backend actions

Implemented or extended these authenticated Apps Script actions:

```text
authCheck
adminListUsers
adminSearchCustomers
adminCreateUser
adminUpdateUserAccess
adminSetUserActive
```

Every ADMIN action verifies the Google ID token, active authorized account,
and ADMIN permission again on the backend.

### Language and UI standards

- Recorded in `AGENTS.md` that development discussions and technical handoffs
  use English.
- Kept Thai as the primary language only for worker-facing application UI.
- Added `Kanit` as the main application font.
- Adapted the visual language from the existing `wh-location3D` project.
- Switched the final interface from the initial dark palette to a light theme.
- Increased the Admin panel typography for comfortable laptop use.
- Preserved vertical page scrolling instead of copying the 3D application's
  full-screen `overflow: hidden` behavior.

### Clasp and repository safety

- Found that `.claspignore` pattern `*` did not recursively exclude nested
  JavaScript and HTML files.
- Changed the rule to `**/*` and explicitly allowed only `Code.js` and
  `appsscript.json`.
- Verified `clasp status` tracks only those two Apps Script files.
- Confirmed `.clasp.json` remains ignored and untracked.
- Confirmed `Code.js` contains Script Property names but no property values,
  keys, webhook URLs, or private credentials.
- Confirmed GitHub Pages publishes only `index.html`, `style.css`, and
  `script.js`.

## Decisions

### Navigation

- Do not add a sidebar yet.
- Use large role-controlled mode cards while the application has few modules.
- Add persistent navigation only when the number of finished modules requires
  it.

### Account deletion

- Never delete authorization rows as a normal operation.
- Use `is_active` to revoke or restore access.

### Multiple permissions per email

The current single `role` value cannot represent a customer account that both
receives and withdraws stock. The final direction discussed today is to keep
one row per email in `CONFIG : อีเมลที่ได้รับสิทธิ์` and introduce explicit
permission columns:

```text
can_withdraw
can_receive
is_admin
```

This avoids duplicated emails and customers in the same sheet and is simpler
for the current fixed set of capabilities. Keep the existing `role` column
during migration and remove it only after the new backend and UI are tested.

`CUSTOMER_ADMIN` is postponed because no customer-administration module or
required permission set currently exists.

## Changed files

```text
AGENTS.md
Code.js
README.md
index.html
script.js
style.css
docs/BUSINESS_RULES.md
docs/DATA_MODEL.md
docs/UI_DESIGN.md
docs/TEST_PLAN.md
docs/project-roadmap/progress-data.js
.claspignore
```

## Verification performed

- Ran `node --check script.js`.
- Ran `node --check Code.js`.
- Verified every JavaScript DOM reference matches an HTML ID.
- Verified there are no duplicate HTML IDs.
- Verified CSS opening and closing braces are balanced.
- Ran `git diff --check` after changes.
- Verified `.clasp.json` is ignored and not tracked.
- Scanned tracked source for private-key and Google API-key patterns.
- Verified the deployed GitHub Pages HTML loads the Kanit font.
- Verified the deployed GitHub Pages CSS contained the latest theme rules.
- User pushed the files, deployed the backend, tested access by email, and
  confirmed that ADMIN UI actions update Google Sheets.

## Blockers

- No active blocker.
- Multiple permissions per account are designed but not implemented.
- Receiving and withdrawal transaction modules remain future work.

## Next steps

1. Add `can_withdraw`, `can_receive`, and `is_admin` columns to
   `CONFIG : อีเมลที่ได้รับสิทธิ์` while retaining `role` temporarily.
2. Update the data model and business rules for permission-based access.
3. Refactor the backend to return and enforce multiple permissions.
4. Replace the single role selector in the ADMIN UI with permission
   checkboxes.
5. Migrate and test every existing authorized email.
6. Remove the legacy `role` column only after migration verification.
7. Continue with the receiving module, followed by withdrawal.
