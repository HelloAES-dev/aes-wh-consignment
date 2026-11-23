# Data Model

This is the Google Sheets data model. Names use lowercase `snake_case` for portability to SQL and APIs. The existing tab names are preserved because they are already part of the team's workflow.

## Current sheets

The workbook currently contains:

```text
CONFIG : อีเมลที่ได้รับสิทธิ์
CONFIG : ข้อมูล Master
MAIN : สินค้าฝากขาย
LOG : สินค้าที่ถูกขอเบิก
LOG : รับเข้าสินค้าฝากขาย
MASTER : Customer
MASTER : Stock By Lot
```

## Sheet: `CONFIG : อีเมลที่ได้รับสิทธิ์`

This sheet maps authenticated Google accounts to customers and permissions.

```text
user_id
email
customer_id
role
can_withdraw
can_receive
is_admin
is_active
created_at
created_by
updated_at
updated_by
```

Permission meanings:

```text
can_withdraw = TRUE  -> access the withdrawal module
can_receive = TRUE   -> access the receiving module
is_admin = TRUE      -> access internal ADMIN functions
```

One email remains one row and may have more than one permission. The frontend
must display capabilities returned by the backend instead of asking users to
choose access after sign-in.

The `role` column is temporarily retained for migration compatibility. The
backend prefers explicit permission columns and falls back to `role` only when
all three permission cells are blank. Remove `role` only after every existing
account has been migrated and tested.

## Sheet: `MAIN : สินค้าฝากขาย`

One row represents one physical consigned tire.

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

Recommended first-version `inventory_status` values:

```text
READY_TO_SHIP
RECEIVED
WITHDRAWN
VOID
```

There is no manual `SHIPPED` transition in the first version. Warehouse staff
register the tire as `READY_TO_SHIP`; the receiving scan at the customer site
is the trusted physical-arrival event and changes it to `RECEIVED`.

The existing `shipped_at` column is retained for compatibility with the
current sheet layout, but the first version does not require a user to populate
it or to confirm dispatch manually.

## Sheet: `LOG : สินค้าที่ถูกขอเบิก`

One row represents one withdrawal transaction for one serial number.

```text
withdrawal_id
client_request_id
withdrawal_batch_id
consignment_item_id
ord_num
customer_id
customer_name_snapshot
lot_num
product_code
product_name_snapshot
serial_num
withdrawn_by_user_id
withdrawn_by_email
submitted_at
request_status
approved_by_user_id
approved_by_email
approved_at
rejection_reason
photo_drive_file_id
photo_drive_url
photo_uploaded_at
photo_upload_status
chat_notification_status
chat_notified_at
chat_message_name
admin_notes
updated_at
```

Recommended `request_status` values:

```text
SUBMITTED
APPROVED
REJECTED
CANCELLED
```

`SUBMITTED` means the customer has completed the withdrawal request and the
physical inventory has already changed to `WITHDRAWN`. `APPROVED` means an
internal Admin confirms that the separate ERP order has been created. It is
not permission that the customer must wait for before using the tire.

The existing `approved_by_user_id`, `approved_by_email`, and `approved_at`
columns are retained for this ERP-confirmation event. No additional approval
columns are required for the first version.

Recommended `photo_upload_status` values:

```text
PENDING
UPLOADED
FAILED
```

Recommended `chat_notification_status` values:

```text
PENDING
SENT
FAILED
```

## Sheet: `LOG : รับเข้าสินค้าฝากขาย`

One row represents one arrival scan attempt, including duplicate or invalid scans.

```text
receiving_id
receiving_batch_id
consignment_item_id
serial_num
customer_id
received_by_user_id
received_by_email
received_at
receiving_status
error_code
notes
created_at
```

Recommended `receiving_status` values:

```text
RECEIVED
DUPLICATE
NOT_FOUND
WRONG_CUSTOMER
ALREADY_WITHDRAWN
INVALID
```

## Master data sources

### Sheet: `MASTER : Stock By Lot`

The current stock-by-lot master has these columns:

```text
รหัสสินค้า
ชื่อสินค้า
เลข Lot
วันที่รับเข้า
จำนวนรับเข้า
จำนวนคงเหลือ
อายุสินค้า
```

### Sheet: `MASTER : Customer`

The account manager searches this sheet using these confirmed headers:

```text
รหัสลูกค้า
ชื่อลูกค้า
```

The sheet also includes address, contact, credit, payment, account-owner, and
customer-category fields. Those additional fields are not currently returned
to the account-management screen.

## Inventory and transaction state relationship

The physical inventory state and the administrative withdrawal transaction
state are intentionally separate:

```text
MAIN.inventory_status:
READY_TO_SHIP -> RECEIVED -> WITHDRAWN

LOG withdrawal.request_status:
SUBMITTED -> APPROVED
```

## Key relationships

```text
CONFIG : อีเมลที่ได้รับสิทธิ์.customer_id
    -> MAIN : สินค้าฝากขาย.customer_id
    -> LOG : สินค้าที่ถูกขอเบิก.customer_id

MAIN : สินค้าฝากขาย.consignment_item_id
    -> LOG : รับเข้าสินค้าฝากขาย.consignment_item_id
    -> LOG : สินค้าที่ถูกขอเบิก.consignment_item_id
```

## Open decisions

- Confirm whether the existing warehouse app will write directly into `MAIN : สินค้าฝากขาย`.
- `user_id` is generated by the backend as `USR-<UUID>` when an admin creates
  an account.
- Confirm whether receiving and customer-user data should remain in this same workbook.


