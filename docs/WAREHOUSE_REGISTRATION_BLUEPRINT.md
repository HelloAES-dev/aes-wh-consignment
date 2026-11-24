# Warehouse Registration Section Blueprint

This is a standalone handoff document. Give this file to a builder in another
Codex project; that builder must not assume access to this repository,
`AGENTS.md`, or any other project document.

Build a mobile-first warehouse registration section for a serialized-tire
consignment system. The section registers tires before they leave the company
warehouse. It is not the sugar-mill receiving screen and it is not the
customer withdrawal screen.

## Non-negotiable implementation rules

- Write production-grade, readable code with clear spacing and indentation.
- Keep HTML, CSS, and JavaScript in separate files.
- Add concise comments for logical sections and non-obvious decisions.
- Use descriptive names; do not use cryptic aliases such as `$`.
- Use semantic HTML, accessible labels, and mobile-friendly controls.
- Thai is the primary worker-facing UI language. Technical identifiers and
  source-code comments should remain in English.
- Never place secrets, webhook URLs, OAuth secrets, or spreadsheet IDs in
  frontend source code.
- Do not write directly to Google Sheets from browser JavaScript.
- The browser collects input; the backend validates, resolves, authorizes, and
  writes the data.
- Preserve unrelated existing modules. Do not change receiving, withdrawal,
  Admin-ERP, Google Chat, or account-management behavior unless explicitly
  requested.

Before implementation, inspect the host project's existing authentication,
backend action router, Sheet repository helpers, and deployment structure. Reuse
them instead of creating a second authentication or data-access system. If a
required capability is missing, report it clearly before changing its design.

## Operational purpose

Warehouse staff register each physical tire before shipment. The warehouse
worker scans:

```text
ORD_NUM → LOT_NUM → SERIAL_NUM
```

The same `ORD_NUM` may be used for multiple lot and serial entries. The UI
should keep the order context visible while the worker repeats lot and serial
scans.

## Worker inputs versus backend-managed fields

### Worker may enter or scan

```text
ord_num
lot_num
serial_num
```

The worker must not type or select customer, product, inventory status, user
identity, timestamps, or IDs.

### Backend must generate, resolve, or control

| Column | Owner | Rule |
|---|---|---|
| `consignment_item_id` | Backend | Generate a unique ID. Never accept it from the browser. |
| `ord_num` | Worker + backend | Normalize and validate against curated ERP order data. |
| `customer_id` | Backend | Resolve from the ORD/order-line reference. |
| `customer_name_snapshot` | Backend | Copy the resolved customer name at registration time. |
| `lot_num` | Worker + backend | Normalize and validate against the ORD/LOT relationship. |
| `product_code` | Backend | Resolve from the validated lot/order reference. |
| `product_name_snapshot` | Backend | Copy the resolved product name at registration time. |
| `serial_num` | Worker + backend | Normalize to uppercase and require exactly 10 alphanumeric characters. |
| `inventory_status` | Backend | New records start as `READY_TO_SHIP`. The UI never chooses this value. |
| `shipped_at` | Backend | Leave blank in version one. There is no manual shipped action. |
| `received_at` | Receiving backend | Leave blank until the sugar-mill receiving scan. |
| `received_by_user_id` | Receiving backend | Leave blank during warehouse registration. |
| `received_by_email` | Receiving backend | Leave blank during warehouse registration. |
| `created_at` | Backend | Set when the row is created. |
| `created_by` | Backend | Set from the verified authenticated account. |
| `updated_at` | Backend | Set only when the row is later changed. |
| `updated_by` | Backend | Set from the verified account that changes the row. |

The target Google Sheet is `MAIN : สินค้าฝากขาย` with this exact header:

```text
consignment_item_id
ord_num
customer_id
customer_name_snapshot
lot_num
product_code
product_name_snapshot
serial_num
inventory_status
shipped_at
received_at
received_by_user_id
received_by_email
created_at
created_by
updated_at
updated_by
```

## ERP and master-data dependency

The raw ERP export must be cleaned before it becomes operational reference
data. Do not let the browser search the raw file or trust customer/product
values typed by a worker.

The preferred curated reference is one validated `ORD_NUM + LOT_NUM` row with:

```text
ord_num
customer_id
customer_name
lot_num
product_code
product_name
ordered_quantity
source_import_id
source_row_number
is_active
created_at
updated_at
```

At registration time the backend must confirm that the scanned lot is valid
for the scanned order. A lot lookup alone is insufficient if the same lot can
appear in more than one order or customer.

## Required scan behavior

1. Authenticate the user before showing operational controls.
2. Start with an empty ORD field and focus it for the scanner.
3. After a valid ORD, keep the order summary visible and focus LOT.
4. After a valid LOT, focus SERIAL and show the resolved product.
5. Normalize serial input to uppercase before validation.
6. Require exactly 10 English letters or digits for `serial_num`.
7. Reject duplicate serials already present in the consignment inventory.
8. Reject a serial already registered in the current local draft.
9. Reject an ORD/LOT combination not found in the curated ERP reference.
10. Show a clear Thai success or error state after every scan.
11. Keep the scanner input focused after a successful item and prepare the
    next LOT → SERIAL pair.
12. Never silently discard a failed scan.

## Save strategy

Prefer collecting a small local draft and sending one backend request for the
warehouse batch. This reduces one-Sheet-write-per-scan latency.

The backend must validate the complete batch before writing any rows. A valid
batch creates one `MAIN` row per serial. If one item is invalid, reject the
batch without partially writing the remaining items.

If the existing application requires immediate save per item, preserve the
same validation and idempotency rules; do not bypass the backend for speed.

The backend action should have a descriptive name such as
`registerConsignmentBatch`. If an equivalent action already exists, reuse its
contract instead of creating a duplicate action. The request must include a
stable client request ID so an uncertain retry cannot create duplicate rows.

## Backend response contract

Return a structured response that the UI can render without guessing:

```javascript
{
  success: true,
  accepted: true,
  idempotent: false,
  message: 'บันทึกข้อมูลสำเร็จ',
  item_count: 2,
  items: [
    {
      consignment_item_id: 'generated-by-backend',
      ord_num: 'ORD2604058',
      customer_id: '30220-001',
      customer_name_snapshot: 'Customer name',
      lot_num: '2604587',
      product_code: 'PRODUCT-001',
      product_name_snapshot: 'Product name',
      serial_num: 'TN05200154',
      inventory_status: 'READY_TO_SHIP'
    }
  ]
}
```

The response may include display metadata, but the browser must treat the
backend response as authoritative. It must not fabricate `consignment_item_id`
or `READY_TO_SHIP` locally.

## UI requirements

- Thai-first labels and messages.
- Large scanner-friendly fields and buttons.
- One obvious next action at each step.
- Visible current ORD context.
- Visible current lot/product context.
- Draft item count and list of accepted serials.
- Clear `READY_TO_SHIP` confirmation after save.
- Disable submit while a request is in progress.
- Preserve the same request ID when retrying an uncertain request.
- Use semantic labels and accessible focus states.
- Escape all backend values before inserting them into the DOM.
- Keep HTML, CSS, and JavaScript in separate files under the warehouse page.

## Acceptance tests

The builder must test at least:

| Scenario | Expected result |
|---|---|
| Valid ORD → LOT → SERIAL | One `READY_TO_SHIP` row is created. |
| Multiple serials for one lot | One row per serial, one batch response. |
| Invalid serial length | Browser/backend rejects it; no row is written. |
| Lowercase serial input | Backend normalizes it to uppercase. |
| Duplicate existing serial | Backend rejects it; no duplicate row. |
| Duplicate serial in current draft | UI rejects it before submission. |
| Unknown ORD | No customer or product is invented. |
| LOT not valid for ORD | Backend rejects the relationship. |
| Same request ID retry | Existing result returns; no new rows. |
| Unauthorized account | Backend rejects the action even if the page is opened directly. |
| Network timeout | Retry is safe and cannot create duplicate inventory. |
| Mobile scanner input | Enter suffix advances the flow and retains focus. |

## Explicit non-goals

Do not implement in this section:

- Sugar-mill receiving scans.
- Customer withdrawal or photo upload.
- Admin ERP approval.
- Google Chat notifications.
- Manual `SHIPPED` confirmation.
- Direct Sheet edits from the browser.
- Formula-driven `XLOOKUP` dependencies for historical transactions.

## Definition of done

The warehouse section is complete only when the UI, backend action, Sheet row
mapping, authentication, idempotency, mobile scanner behavior, and acceptance
tests all pass. If the host project has documentation files, synchronize its
data model, business rules, UI specification, test plan, README, and roadmap
after verification. This blueprint remains the portable implementation
contract even when those files are unavailable.
