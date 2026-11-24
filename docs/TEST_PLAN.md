# Test Plan

Test the workflows before production deployment. Status starts as `NOT_RUN`.

## Authentication

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| AUTH-001 | Approved customer signs in | Customer view opens | NOT_RUN |
| AUTH-002 | Unknown email signs in | Access is rejected | NOT_RUN |
| AUTH-003 | Inactive user signs in | Access is rejected | NOT_RUN |
| AUTH-004 | Account with `is_admin = FALSE` opens admin action | Backend rejects request | NOT_RUN |
| AUTH-005 | Account with `is_admin = TRUE` signs in | Admin view opens | NOT_RUN |
| AUTH-006 | Account has withdrawal and receiving permissions | Both operational modes appear | NOT_RUN |
| AUTH-007 | Permission cells are blank but legacy role exists | Legacy fallback grants the expected mode | NOT_RUN |
| AUTH-008 | Another active account has `can_receive = TRUE` | Account can enter receiving and submit a scan | PASS |

## Receiving

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| REC-001 | Scan valid READY_TO_SHIP serial | Item becomes RECEIVED | PASS |
| REC-002 | Scan same serial twice | Second scan is DUPLICATE | PASS |
| REC-003 | Scan unknown serial | NOT_FOUND result; no inventory change | PASS |
| REC-004 | Scan another customer serial | WRONG_CUSTOMER result | NOT_RUN |
| REC-005 | Scan already withdrawn serial | ALREADY_WITHDRAWN result | NOT_RUN |
| REC-006 | Scan with USB-C 2D scanner | Input is accepted and refocused | PASS |
| REC-007 | Scan lowercase `tn05200154` | Serial is normalized and accepted as `TN05200154` | NOT_RUN |
| REC-008 | Scan a value outside the 10-character uppercase alphanumeric pattern | INVALID result; no inventory change | NOT_RUN |
| REC-013 | Scan valid serials with different letter positions | `D001000955` and `TN05200154` are accepted | NOT_RUN |
| REC-019 | Scan a valid 10-letter or 10-digit serial | Value is accepted by format validation | NOT_RUN |
| REC-009 | Retry the same client request ID | Original result returns; no second log row | NOT_RUN |
| REC-010 | Two receiving requests target the same serial | Only one changes inventory to RECEIVED | NOT_RUN |
| REC-011 | Internal admin with receiving permission scans any customer | Scan is evaluated without customer restriction | PASS |
| REC-012 | Reuse a client request ID for another user, batch, or serial | IDEMPOTENCY_KEY_CONFLICT; no data is disclosed or changed | NOT_RUN |
| REC-014 | Network response is lost after submitting a scan | Scanner pauses and retry reuses the same client request ID | NOT_RUN |
| REC-015 | Open receiving URL without a valid same-tab session | Controls remain hidden and sign-in link appears | NOT_RUN |
| REC-016 | Signed-in user lacks receiving permission | Controls remain hidden; access is rejected | NOT_RUN |
| REC-017 | Start a new receiving batch | Local counters/history reset; existing Sheet records remain unchanged | NOT_RUN |
| REC-018 | Complete a scan on mobile width | Result is readable and scanner input refocuses | PASS |
| REC-020 | Normal receiving account scans an item assigned to its customer | Item is received and the customer ID is preserved | PASS |

The receiving and authentication tests marked `PASS` were manually verified on
2026-11-23 using the Google Sheets backend, multiple authorized accounts, and
the deployed mobile receiving page. The remaining reliability tests must be
completed before production deployment.

## Customer withdrawal

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| WDR-001 | Customer submits RECEIVED serial and photo | Item becomes WITHDRAWN and request is SUBMITTED | PASS |
| WDR-002 | Customer submits another customer serial | Request is rejected | NOT_RUN |
| WDR-003 | Customer submits unknown serial | Request is rejected | NOT_RUN |
| WDR-004 | Photo upload succeeds | Drive ID and URL are stored | PASS |
| WDR-005 | Photo upload fails | Request remains visible with FAILED status | NOT_RUN |
| WDR-006 | Same client request is retried | No duplicate transaction or second inventory transition | NOT_RUN |
| WDR-007 | Customer submits valid request | Customer can use tire without waiting for Admin | PASS |
| WDR-008 | Customer submits a second request for withdrawn serial | Backend rejects request | NOT_RUN |
| WDR-009 | Customer submits multiple tires together | One batch ID groups one row per serial | NOT_RUN |
| WDR-010 | Ten-tire withdrawal batch is saved | Rows are written efficiently and one Chat notification is generated | NOT_RUN |
| WDR-011 | One item in a batch fails validation | Entire batch is rejected; no inventory status changes | NOT_RUN |
| WDR-012 | Photo file is missing, not an image, or outside the configured folder | Batch is rejected before inventory changes | NOT_RUN |
| WDR-013 | Same photo upload ID is retried after an uncertain response | Existing Drive file is returned; no duplicate image is created | NOT_RUN |
| WDR-014 | Browser provides invalid JPEG data or a decoded file over 5 MB | Upload is rejected; batch cannot be submitted | NOT_RUN |
| WDR-015 | Signed-in user lacks withdrawal permission or customer assignment | Withdrawal controls remain hidden; backend rejects actions | NOT_RUN |
| WDR-016 | Mobile camera image is selected | Browser compresses to JPEG and Shared Drive upload succeeds | PASS |
| WDR-017 | User scans the same serial twice in one draft batch | Second scan is rejected locally; only one draft item remains | NOT_RUN |
| WDR-018 | User clicks `ลบรูป` on one draft item | Only that photo reference is cleared; the tire remains in the batch | NOT_RUN |
| WDR-019 | User clicks `นำรายการนี้ออก` | Only that tire is removed from the unsent batch | NOT_RUN |
| WDR-020 | User clicks `ยกเลิกรอบเบิก` | The complete unsent draft batch is cleared | NOT_RUN |

The first complete withdrawal test was manually verified on 2026-11-23 using
the deployed mobile page and the Google Sheets backend. Test serial `TN03500014`
belonged to customer `30220-001` and was submitted by the authorized account
`hello@aesen.co.th`. The result was one `SUBMITTED` withdrawal row, one
`WITHDRAWN` inventory transition, one `UPLOADED` photo record in the configured
Shared Drive folder, and `chat_notification_status = PENDING`. The source test
row did not contain ORD or product snapshot values, so those fields remained
blank as expected. Retry, multi-item, rejection, and Chat tests remain open.

## Admin ERP confirmation

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| ADM-001 | Admin opens grouped Chat link | Correct withdrawal batch opens | NOT_RUN |
| ADM-002 | Admin clicks APPROVED for a SUBMITTED request | Request becomes APPROVED and Admin identity is recorded | PASS |
| ADM-003 | ERP order is not ready | Request remains SUBMITTED; no approval occurs | NOT_RUN |
| ADM-004 | Two admins confirm ERP simultaneously | Only one confirmation succeeds | NOT_RUN |
| ADM-005 | Customer calls ERP-confirmation endpoint | Backend rejects request | NOT_RUN |
| ADM-006 | Batch contains multiple product codes | Chat card shows grouped products and calculated quantities | NOT_RUN |
| ADM-007 | Withdrawal batch includes photos | Chat card excludes photos; Admin page can show them | NOT_RUN |
| ADM-008 | Admin repeats approval for an APPROVED batch | Existing approval returns safely; original audit identity is not overwritten | PASS |
| ADM-009 | Batch rows contain mixed or non-SUBMITTED statuses | Entire approval is rejected; no row is changed | NOT_RUN |
| ADM-010 | Admin opens ERP page without a valid same-tab session | Queue remains hidden and sign-in link appears | NOT_RUN |
| ADM-011 | Non-admin opens the ERP page URL | Queue remains hidden; frontend and backend reject access | NOT_RUN |
| ADM-012 | Approval request fails or times out | Batch card remains visible and can be retried safely | NOT_RUN |
| ADM-013 | Admin opens a valid `?batch=` URL | Matching pending card is focused after authentication | NOT_RUN |
| ADM-014 | Admin approves a batch from the queue | Card disappears and pending counters update | NOT_RUN |

## Authorized-account management

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| ACC-001 | Admin searches by customer code | Matching customer code and name appear | NOT_RUN |
| ACC-002 | Admin searches by customer name | Matching customer code and name appear | NOT_RUN |
| ACC-003 | Admin assigns operational permission without customer | Frontend and backend reject request | NOT_RUN |
| ACC-004 | Admin creates a valid account | One active row with audit fields is appended | NOT_RUN |
| ACC-005 | Admin submits a duplicate email | Backend rejects duplicate without appending | NOT_RUN |
| ACC-006 | Non-admin calls account action | Backend rejects request | NOT_RUN |
| ACC-007 | Admin deactivates another account | `is_active` becomes FALSE; row remains | NOT_RUN |
| ACC-008 | Admin tries to deactivate own account | Backend rejects request | NOT_RUN |
| ACC-009 | Two admins add same email simultaneously | Only one account is created | NOT_RUN |
| ACC-010 | Admin changes withdrawal permission to receiving | Permission and audit fields update; email remains unchanged | NOT_RUN |
| ACC-011 | Admin changes customer permissions without selecting customer | Frontend and backend reject request | NOT_RUN |
| ACC-012 | Admin enables internal ADMIN permission | `is_admin` updates and customer ID is cleared | NOT_RUN |
| ACC-013 | Admin tries to change own access | Backend rejects request | NOT_RUN |
| ACC-014 | Admin selects no permission | Frontend and backend reject request | NOT_RUN |
| ACC-015 | Admin selects withdrawal and receiving | Both permissions are stored on one email row | NOT_RUN |

## Reliability

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| REL-001 | Network timeout during submission | Retry does not duplicate row | NOT_RUN |
| REL-002 | Google Chat notification fails | Transaction remains saved as FAILED notification | NOT_RUN |
| REL-003 | Two users submit at the same time | Both valid records are preserved | NOT_RUN |
| REL-004 | Lock cannot be acquired quickly | User receives retry message | NOT_RUN |


