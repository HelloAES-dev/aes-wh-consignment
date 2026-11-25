# wh-consignment — 2026-11-24

## Summary

Completed the first Google Chat notification milestone and verified it with a
fresh `TEST-003` withdrawal. The withdrawal transaction, Shared Drive photo,
grouped Google Chat card, and Admin-ERP queue now work together. The Admin-ERP
approval acceptance tests were also confirmed and documented.

The day also produced a reusable, standalone warehouse-registration blueprint
for a future WH section.

## Completed work

### Admin-ERP acceptance

- Verified `adminListPendingWithdrawals` returns grouped pending batches.
- Verified `adminApproveWithdrawalBatch` changes a submitted batch to
  `APPROVED`.
- Verified approval records the Admin identity and timestamp.
- Verified repeated approval is idempotent and does not overwrite the original
  approval audit fields.
- Verified the approved batch disappears from the pending queue.
- Marked the relevant Admin-ERP acceptance cases as `PASS` in `TEST_PLAN.md`.
- Updated the Thai success message to:
  `ยืนยันการเปิดออเดอร์ในระบบสำเร็จ`.

### Google Chat notification

- Added `backend/ChatService.js`.
- Sends one grouped Google Chat Card V2 after a new withdrawal batch commits.
- Groups product lines and calculates quantities in the backend.
- Includes customer code/name, product summary, total quantity, timestamp,
  and an Admin-ERP link.
- Excludes photos and serial-level details from the Chat card.
- Stores `SENT`, `FAILED`, or uncertain `PENDING` notification state in the
  withdrawal log.
- Keeps the withdrawal transaction committed when Chat delivery fails.
- Performs one delivery attempt only; automatic retry is intentionally not
  implemented in version one.
- Added Admin-ERP card indicators:
  - green: `แจ้ง Google Chat แล้ว`
  - amber: `รอแจ้ง Google Chat`
  - red: `ส่ง Google Chat ไม่สำเร็จ`
- Added Script Properties documentation for:
  `GOOGLE_CHAT_WEBHOOK_URL` and `ADMIN_ERP_BASE_URL`.

### TEST-003 end-to-end verification

Verified a fresh withdrawal using serial `TYU5578549`:

- `MAIN : สินค้าฝากขาย` changed to `WITHDRAWN`.
- One withdrawal row was created.
- `request_status = SUBMITTED`.
- Photo upload succeeded with `photo_upload_status = UPLOADED`.
- Google Chat accepted exactly one grouped card.
- `chat_notification_status = SENT`.
- `chat_notified_at` was recorded.
- `chat_message_name` was recorded.
- The card contained the Admin-ERP inspection link.

The fallback customer/product labels in the card were caused by blank test
master values, not by a failed notification pipeline.

The older `TEST-001` and `TEST-002` rows remained `PENDING` because they were
created before Chat notification was enabled. They were not resent.

### Roadmap and documentation

- Marked the Admin Chat milestone as complete in the owner-facing roadmap.
- Marked the warehouse workflow boundary as confirmed.
- Added planned roadmap tasks for ERP source cleaning and curated ORD/LOT
  reference data.
- Marked verified Chat test-plan cases as `PASS`.
- Updated `README.md` with the Chat milestone and required Script Properties.
- Updated business rules for one-attempt Chat delivery and visible failure
  states.
- Updated UI design rules for Chat status badges.
- Added `docs/WAREHOUSE_REGISTRATION_BLUEPRINT.md` as a standalone handoff
  document that can be given to a builder in another Codex project.

## Important decisions

1. Google Chat is a notification channel, not the source of truth.
2. The withdrawal Sheet transaction is committed before Chat is called.
3. Chat failure must never undo a successful physical withdrawal.
4. One withdrawal batch produces one grouped Chat card.
5. The Admin link does not grant permission; normal authentication and backend
   authorization still apply.
6. Photos and serial lists remain in the authenticated Admin page.
7. The warehouse section will collect only `ORD_NUM`, `LOT_NUM`, and
   `SERIAL_NUM`; all customer, product, status, identity, and timestamp fields
   are backend-owned.

## Changed files

```text
backend/ChatService.js
backend/WithdrawalService.js
backend/AdminApprovalService.js
backend/Config.js
pages/admin-erp/admin-erp.js
pages/admin-erp/admin-erp.css
README.md
docs/BUSINESS_RULES.md
docs/UI_DESIGN.md
docs/TEST_PLAN.md
docs/project-roadmap/progress-data.js
docs/project-roadmap/script.js
docs/WAREHOUSE_REGISTRATION_BLUEPRINT.md
```

## Verification performed

- Node syntax checks passed for the Chat, withdrawal, Admin-ERP, and roadmap
  JavaScript files.
- `git diff --check` passed.
- Unit-style logic checks passed for grouped product quantities, escaped Chat
  text, Admin links, SENT/FAILED delivery, and batch status priority.
- Repository secret scan found no webhook URL or API key in tracked source.
- Admin-ERP acceptance was verified with live Apps Script requests.
- TEST-003 was verified through the deployed mobile withdrawal page and the
  Google Chat room.

## Open blockers and untested cases

- Multi-product Chat grouping has not been tested with a real batch.
- Chat failure and red Admin-ERP badge behavior have not been tested live.
- Chat-link authentication and batch focusing still need a deployed test.
- Same-request withdrawal retry and true simultaneous withdrawal tests remain
  open.
- The warehouse registration module is not yet implemented.
- The ERP order source and curated reference-sheet design still need to be
  finalized before warehouse registration can be built correctly.

## Next steps

1. Confirm the ERP order source fields and stable reference identifiers.
2. Define the curated order/lot reference data.
3. Build warehouse registration using the standalone blueprint.
4. Complete multi-product, failure, link, and concurrency tests.
5. Perform the final UI, refactoring, documentation, and production-readiness
   pass.
