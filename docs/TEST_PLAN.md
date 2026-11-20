# Test Plan

Test the workflows before production deployment. Status starts as `NOT_RUN`.

## Authentication

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| AUTH-001 | Approved customer signs in | Customer view opens | NOT_RUN |
| AUTH-002 | Unknown email signs in | Access is rejected | NOT_RUN |
| AUTH-003 | Inactive user signs in | Access is rejected | NOT_RUN |
| AUTH-004 | Customer opens admin action | Backend rejects request | NOT_RUN |
| AUTH-005 | Admin signs in | Admin view opens | NOT_RUN |

## Receiving

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| REC-001 | Scan valid SHIPPED serial | Item becomes AVAILABLE | NOT_RUN |
| REC-002 | Scan same serial twice | Second scan is DUPLICATE | NOT_RUN |
| REC-003 | Scan unknown serial | NOT_FOUND result; no inventory change | NOT_RUN |
| REC-004 | Scan another customer serial | WRONG_CUSTOMER result | NOT_RUN |
| REC-005 | Scan already withdrawn serial | ALREADY_WITHDRAWN result | NOT_RUN |
| REC-006 | Scan with USB-C 2D scanner | Input is accepted and refocused | NOT_RUN |

## Customer withdrawal

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| WDR-001 | Customer submits AVAILABLE serial and photo | Request is SUBMITTED | NOT_RUN |
| WDR-002 | Customer submits another customer serial | Request is rejected | NOT_RUN |
| WDR-003 | Customer submits unknown serial | Request is rejected | NOT_RUN |
| WDR-004 | Photo upload succeeds | Drive ID and URL are stored | NOT_RUN |
| WDR-005 | Photo upload fails | Request remains visible with FAILED status | NOT_RUN |
| WDR-006 | Same client request is retried | No duplicate transaction | NOT_RUN |

## Admin approval

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| ADM-001 | Admin opens Chat link | Correct request opens | NOT_RUN |
| ADM-002 | Admin approves SUBMITTED request | Request becomes APPROVED | NOT_RUN |
| ADM-003 | Admin rejects request | REJECTED and reason are recorded | NOT_RUN |
| ADM-004 | Two admins approve simultaneously | Only one approval succeeds | NOT_RUN |
| ADM-005 | Customer calls approve endpoint | Backend rejects request | NOT_RUN |

## Reliability

| ID | Scenario | Expected result | Status |
|---|---|---|---|
| REL-001 | Network timeout during submission | Retry does not duplicate row | NOT_RUN |
| REL-002 | Google Chat notification fails | Transaction remains saved as FAILED notification | NOT_RUN |
| REL-003 | Two users submit at the same time | Both valid records are preserved | NOT_RUN |
| REL-004 | Lock cannot be acquired quickly | User receives retry message | NOT_RUN |


