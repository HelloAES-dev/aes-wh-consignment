# wh-consignment — 2026-11-23

## Summary

Completed the first working receiving and customer-withdrawal flows, including
mobile scanner input, Google Sheets transactions, Shared Drive photo upload,
and the first successful end-to-end withdrawal. The Apps Script backend was
also split into focused service files, explicit permission flags replaced the
old single-role authorization logic, and the Admin-ERP approval backend was
implemented. Google Chat and the Admin-ERP frontend remain unfinished.

The largest technical challenge was Apps Script OAuth authorization for Drive
and external requests. The manifest appeared correct, but the deployed web app
still lacked the owner-granted Drive scope. The final solution was to declare
the scopes explicitly, force the complete scope set through
`ScriptApp.requireScopes`, authorize from the Apps Script editor as the
deployment owner, and then deploy a new web-app version.

## Completed work

### Authorization model

- Migrated access control from one `role` value to explicit permission flags:

  ```text
  can_withdraw
  can_receive
  is_admin
  is_active
  ```

- Kept one authorization row per email instead of duplicating an email for
  every capability.
- Enforced every permission again on the backend; hiding a frontend module is
  not treated as security.
- Confirmed another active account with receiving permission could use the
  receiving module.

### Inventory and transaction flow

- Confirmed the physical inventory lifecycle:

  ```text
  READY_TO_SHIP -> RECEIVED -> WITHDRAWN
  ```

- Confirmed that Admin ERP completion is a separate transaction lifecycle:

  ```text
  SUBMITTED -> APPROVED
  ```

- Clarified that a customer can use a tire immediately after successful
  withdrawal submission. `APPROVED` only means the internal Admin has finished
  creating the corresponding order in the separate ERP system.
- Confirmed that warehouse registration belongs in
  `MAIN : สินค้าฝากขาย`, sugar-mill receiving history belongs in
  `LOG : รับเข้าสินค้าฝากขาย`, and withdrawal history belongs in
  `LOG : สินค้าที่ถูกขอเบิก`.

### Receiving backend and mobile page

- Built the receiving backend with exact serial lookup, inventory transition,
  receiving history, duplicate handling, authorization, script locking, and
  retry identifiers.
- Built the mobile receiving page under `pages/receiving/` with scanner-first
  input, Thai user feedback, counters, batch state, and automatic refocusing.
- Standardized tire serial validation to exactly 10 uppercase alphanumeric
  characters. A serial may contain letters, digits, or both; it is not required
  to start with a letter or contain a particular number of each type.
- Confirmed a valid scan changes the source inventory row to `RECEIVED` and
  creates a `RECEIVED` receiving log.
- Confirmed rescanning an already received tire returns `DUPLICATE` without
  creating a new inventory item.
- Confirmed the deployed page works on a mobile device with the scanner flow.
- Kept same-request idempotency and true simultaneous-request testing marked
  `NOT_RUN`; two ordinary rescans with two different request IDs correctly
  create two separate `DUPLICATE` audit rows.

### Withdrawal backend and mobile page

- Built batch withdrawal lookup and submission with one log row per serial and
  one shared `withdrawal_batch_id`.
- Enforced customer ownership, `RECEIVED` source status, unique serials,
  uploaded-photo ownership, and all-or-nothing validation before inventory
  changes.
- Added a short script lock around the final re-read and write operation.
- Built the mobile withdrawal page under `pages/withdrawal/`.
- Added browser-side image processing so supported camera/image inputs are
  converted and compressed to JPEG before upload.
- Added separate controls for three different user intentions:

  ```text
  ลบรูป              remove only the current photo
  นำรายการนี้ออก      remove only that tire from the draft
  ยกเลิกรอบเบิก       clear the complete unsent draft batch
  ```

- Uploaded withdrawal photos to the configured company Shared Drive folder.
- Completed the first end-to-end withdrawal test:
  - serial `TN03500014`
  - consignment item `TEST-001`
  - customer `30220-001`
  - authorized user `hello@aesen.co.th`
  - inventory changed to `WITHDRAWN`
  - withdrawal row saved as `SUBMITTED`
  - photo saved with `photo_upload_status = UPLOADED`
  - Chat state remained `PENDING`, as expected before Chat integration
- Confirmed blank customer/product snapshot fields in this test were caused by
  blank source values in `TEST-001`, not by withdrawal mapping failure.

### Apps Script backend refactor

- Moved Apps Script source and `appsscript.json` into `backend/`.
- Kept `.clasp.json` local with `rootDir` set to `backend`.
- Split the original large backend into focused files:

  ```text
  Code.js
  Config.js
  AuthService.js
  AccountService.js
  ReceivingService.js
  WithdrawalService.js
  SheetRepository.js
  DriveService.js
  CoreUtils.js
  AdminApprovalService.js
  ```

- Kept `Code.js` responsible for HTTP entry points and action routing while
  moving business logic into named services.
- Updated `.claspignore` and verified clasp tracks the complete backend folder
  without pushing frontend or documentation files.

### Drive and OAuth authorization

- Enabled the Google Drive API in the linked Google Cloud project.
- Added the Apps Script Advanced Drive service using Drive API v3.
- Added the configured Shared Drive folder ID through the Script Property
  `WITHDRAWAL_PHOTO_FOLDER_ID`.
- Added explicit Drive, Sheets, external-request, and ScriptApp scopes to
  `appsscript.json`.
- Added `authorizeBackendServices()` to verify Sheets, external request, and
  configured Drive-folder access from the deployment owner's account.
- Added `ScriptApp.requireScopes()` so granular OAuth cannot silently leave out
  a required Drive scope.
- Added an Advanced Drive upload path with Shared Drive support and a DriveApp
  folder fallback.
- Confirmed the authorization diagnostic returned all required scopes and the
  correct withdrawal-photo folder.
- Confirmed a photo was finally uploaded successfully and its Drive file ID and
  URL were written into the withdrawal log.

### Admin ERP backend

- Added the authenticated `adminListPendingWithdrawals` action.
- Added the authenticated `adminApproveWithdrawalBatch` action.
- Grouped pending rows by `withdrawal_batch_id` and grouped product quantities
  for the future Admin page and Chat message.
- Restricted both actions to active users with `is_admin = TRUE`.
- Added a script lock around approval.
- Confirmed an entire batch can move only from `SUBMITTED` to `APPROVED`.
- Added approval audit updates:

  ```text
  approved_by_user_id
  approved_by_email
  approved_at
  updated_at
  ```

- Made repeated approval idempotent so the original Admin identity and
  timestamp are preserved.
- Rejected mixed-status batches without changing any row.
- Used one grouped Sheet write for the approval span to reduce partial-update
  risk.
- Confirmed the live pending-record lookup finds the submitted test withdrawal.
- Did not yet run the live approval transition; its frontend is not built.

### Documentation and progress tracking

- Updated the data model, business rules, UI design, test plan, README, and
  owner-facing roadmap as workflows became concrete.
- Recorded successful receiving, mobile, photo-upload, and withdrawal tests.
- Kept untested reliability and concurrency cases clearly marked `NOT_RUN`.
- Marked receiving and withdrawal core flows complete in the roadmap.
- Marked the Admin queue and approval modules `in_progress` because the backend
  exists but the UI and live acceptance tests remain.

## Challenges, causes, and lessons

### 1. A valid-looking scan was rejected as an invalid serial

The first scanned value had only nine characters, while the intended format is
exactly ten. The earlier rule also unnecessarily required both a letter and a
digit.

**Resolution:** simplify the rule to `^[A-Z0-9]{10}$` and normalize input to
uppercase.

**Lesson:** validate the actual business identifier length first. Do not add
format assumptions that the business has not confirmed.

### 2. A valid serial returned `NOT_FOUND`

After correcting the format, the backend correctly progressed from format
validation to registry lookup. The source Sheet initially lacked the matching
record or required receiving columns.

**Resolution:** align `MAIN : สินค้าฝากขาย` with the documented headers and add
the exact test serial. The next scan found the item and transitioned it.

**Lesson:** `INVALID`, `NOT_FOUND`, and `DUPLICATE` are different successful
backend decisions, not Apps Script execution failures. Execution can show
`Completed` while the business result is a rejection.

### 3. Duplicate receiving logs looked like failed idempotency

Two rescans created two `DUPLICATE` log rows. They used different
`client_request_id` values, so they represented two real scan attempts.

**Resolution:** distinguish duplicate business events from a network retry of
the same request. Only the same `client_request_id` must return the existing
result without adding a row.

**Lesson:** an idempotency key identifies one request attempt; it does not erase
the audit history of separate user actions.

### 4. Authentication failed after the backend refactor

The deployed backend began calling services that required explicit external
request authorization. Apps Script completed the function but returned an
authorization error from `UrlFetchApp.fetch`.

**Resolution:** declare the external-request scope, authorize backend services
as the deployment owner, push the manifest, and deploy a new web-app version.

**Lesson:** moving code between Apps Script files does not change execution
semantics, but adding a newly scoped service changes the authorization contract
of the deployment.

### 5. Drive upload failed although Drive API was enabled

Enabling the Google Cloud Drive API and adding the Advanced Drive service were
necessary but did not grant the Apps Script deployment owner's OAuth token the
Drive scope. Both `Drive.Files.create` and `DriveApp.Folder.createFile` failed,
which proved the problem was authorization rather than image extension or one
specific Drive API method.

**Resolution:** add explicit scopes, run `ScriptApp.requireScopes()` from the
Apps Script editor, verify the authorized scope list, and deploy a new version.

**Lesson:** three separate layers must agree:

1. the Google Cloud API is enabled;
2. Apps Script declares the scope/service;
3. the deployment owner actually grants that scope.

### 6. Different deployment IDs caused confusion

Editor executions and deployed web-app executions displayed different service
or deployment identifiers in logs.

**Resolution:** verify failures against the deployment ID used by the current
`/exec` URL and update that existing deployment to the newest version.

**Lesson:** `clasp push` updates project source, but it does not automatically
move a versioned web-app deployment to that source.

### 7. Image upload and unreliable mill internet

Original camera files could have varying formats and large sizes, increasing
upload time and failure risk.

**Resolution:** convert and compress images to JPEG in the browser, show clear
retry feedback, preserve stable upload IDs, and keep transaction retries
idempotent.

**Lesson:** optimize before sending data over a weak connection and separate a
failed upload attempt from the business transaction that has not yet been
submitted.

### 8. One remove button performed two different actions

The original `นำออก` control removed the complete tire entry when the user only
wanted to replace its photo.

**Resolution:** separate photo removal, item removal, and complete-draft
cancellation into clearly named controls.

**Lesson:** destructive UI controls should represent one precise scope and use
labels that match that scope.

### 9. Pending-list output looked different from the public API shape

The observed array was the raw result of the Sheet repository lookup. The
public `listPendingWithdrawalBatches()` service wraps and groups those records
as `{ success, batches }`.

**Resolution:** identify the difference between a repository helper, a service
function, and the HTTP action routed by `Code.js`.

**Lesson:** layered backend design intentionally exposes different shapes at
different levels; frontend code should call the routed API action, not internal
repository helpers.

## Changed files

Major files added or changed today include:

```text
AGENTS.md
README.md
.claspignore
.github/workflows/pages.yml
assets/app-config.js
assets/auth-session.js
backend/appsscript.json
backend/Code.js
backend/Config.js
backend/AuthService.js
backend/AccountService.js
backend/ReceivingService.js
backend/WithdrawalService.js
backend/SheetRepository.js
backend/DriveService.js
backend/CoreUtils.js
backend/AdminApprovalService.js
index.html
script.js
style.css
pages/receiving/index.html
pages/receiving/receiving.css
pages/receiving/receiving.js
pages/withdrawal/index.html
pages/withdrawal/withdrawal.css
pages/withdrawal/withdrawal.js
docs/BUSINESS_RULES.md
docs/DATA_MODEL.md
docs/UI_DESIGN.md
docs/TEST_PLAN.md
docs/project-roadmap/progress-data.js
```

## Verification performed

- Ran syntax checks for frontend and backend JavaScript after implementation.
- Parsed `backend/appsscript.json` successfully.
- Ran `git diff --check` during implementation.
- Verified clasp tracks all intended files in `backend/`.
- Verified receiving with the deployed Google Sheets backend.
- Verified receiving on mobile.
- Verified duplicate receiving behavior.
- Verified receiving with another authorized email.
- Verified customer ID preservation.
- Verified the configured Shared Drive folder and OAuth scope list.
- Verified JPEG photo upload to Shared Drive.
- Verified the first complete withdrawal transaction and inventory transition.
- Verified Admin grouping, quantity calculation, approval-state evaluation,
  idempotent retry behavior, mixed-state rejection, and grouped Sheet-write
  logic with local pure-logic checks.
- Verified the live pending lookup returns the submitted test withdrawal.

## Remaining tests and risks

- Receiving same-request retry is still `NOT_RUN`.
- True simultaneous receiving requests are still `NOT_RUN`.
- Multi-item withdrawal and all-or-nothing rejection tests are still
  `NOT_RUN`.
- Withdrawal retry, simultaneous submission, and weak-network recovery remain
  `NOT_RUN`.
- Admin approval has not yet been exercised through the deployed HTTP action.
- Two-Admin simultaneous approval remains `NOT_RUN`.
- Google Chat delivery and retry behavior are not implemented.
- UI visual polish remains intentionally postponed until the core modules work.
- The test source row lacks product/customer snapshot data; realistic production
  fixtures are still needed before final Admin-card verification.

## Blockers

- No active technical blocker.
- The next modules require implementation and acceptance testing rather than a
  missing credential or unresolved platform issue.

## Next steps

1. Deploy the latest Admin-ERP backend version if it has not already been
   deployed after the final clasp push.
2. Test `adminListPendingWithdrawals` through the authenticated HTTP action.
3. Test `adminApproveWithdrawalBatch` on the submitted test batch.
4. Repeat the same approval and confirm the original audit fields remain
   unchanged.
5. Confirm a non-Admin account receives `ADMIN_REQUIRED`.
6. Build `pages/admin-erp/` with grouped pending cards and one Thai approval
   action.
7. Add Admin-only navigation to the ERP queue.
8. Build one grouped Google Chat notification per withdrawal batch, without
   embedding photos.
9. Link the Chat card to the authenticated Admin page.
10. Complete concurrency, retry, multi-item, and weak-network tests before
    production sign-off.
