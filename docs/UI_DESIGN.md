# UI Design

## Design goals

- Mobile-first.
- Thai is the primary user-facing language; English may remain in technical identifiers and optional secondary text.
- Fast for barcode scanning.
- One clear next action.
- Large touch targets.
- Visible success and failure feedback.
- Separate customer, receiving-checker, and admin capabilities.

## Authentication screen

The first screen is a Google sign-in gate. The application must not show customer or admin data before authentication succeeds.

The current prototype renders the Google Identity Services button on the root
page. After Google returns an ID token, the frontend sends an `authCheck`
request to the Apps Script web app. The scanner remains hidden until the
backend confirms that the account is active in `CONFIG : อีเมลที่ได้รับสิทธิ์`.

## Customer withdrawal screen

```text
Google sign-in
    -> Scan serial
    -> Show matched tire
    -> Take photo
    -> Confirm request
    -> Show submitted status
```

After a successful confirmation, the tire is immediately treated as
`WITHDRAWN`. The customer does not wait for the Admin ERP-confirmation step.

Customer input is limited to:

```text
serial_num
photo
```

The email and customer identity are displayed as read-only values from the authenticated account.

The implemented mobile workflow verifies each scanned serial with the backend
before adding it to the draft batch. Selecting or taking a photo automatically
resizes it, converts it to JPEG, and uploads it. The final submit button remains
disabled until every draft item has a verified Drive file ID. An uncertain
network retry reuses the same photo-upload ID or batch request ID.

Withdrawal controls distinguish two cancellation scopes:

- `ลบรูป` clears only the current item's photo so a replacement can be taken.
- `นำรายการนี้ออก` removes only that tire from the unsent withdrawal batch.
- `ยกเลิกรอบเบิก` clears the complete unsent draft batch.

Already-uploaded temporary photos are not deleted automatically by these local
draft actions; the backend keeps uploaded files auditable in the Shared Drive.

## Receiving screen

The receiving screen is continuous scan mode, not a list that requires clicking each item.

```text
Receiving batch
Scanned count
Accepted count
Duplicate count
Error count
Last scan result
Always-focused scanner input
```

The 2D USB-C scanner should be configured to send an Enter suffix after each QR value. After every scan, the input is cleared and refocused.

The page generates one `receiving_batch_id` per receiving session and one
stable `client_request_id` per scan. If the network result is uncertain, the
scanner is paused and the worker retries the same request ID before continuing.
The page displays scanned, accepted, duplicate, and error counts plus the ten
most recent results. Starting a new batch clears only this local display state;
it never deletes Sheet records.

An accepted scan changes the matching inventory item from `READY_TO_SHIP` to
`RECEIVED`. There is no manual shipment button for a driver or warehouse
worker.

## Admin screen

The ADMIN account-management screen shows:

- New-account email input.
- Permission checkboxes for withdrawal, receiving, and internal ADMIN access.
- Searchable customer selector using customer code or name.
- Current authorized accounts with customer names.
- Edit-access action for changing permissions and the linked customer while keeping
  the Google email unchanged.
- Activate or deactivate action; no delete action.
- A larger type scale for headings, labels, form controls, account details, and
  actions so the information remains comfortable to read on laptop screens.

The ERP-confirmation screen shows:

- Pending withdrawal batches.
- Customer code and name.
- Grouped product lines and quantities.
- Submission timestamp.
- A link or detail view for serials and uploaded photos.
- One `APPROVED` button after the Admin checks the separate ERP system.
- Two compact counters for pending batches and total tires.
- Oldest pending batches first.
- Expandable serial details with Drive photo links instead of automatically
  loading every image.
- An optional `?batch=<withdrawal_batch_id>` URL that focuses the batch linked
  from Google Chat after normal authentication succeeds.
- A short confirmation dialog before the approval request is submitted.

After approval succeeds, the card is removed from the pending queue and the
counters update. A backend or network failure leaves the card available for a
safe retry.

The first version does not include an in-app checklist, ERP integration, or
photo attachments in the Google Chat card. The Chat card contains only the
grouped summary and Admin web-app link.

The browser may hide this section for non-admin users, but backend authorization remains mandatory.

## Permission-based home screen

Users do not choose whether they are an admin or worker. The backend returns
the permissions associated with the authenticated email, and the frontend
displays every allowed mode.

```text
is_admin = TRUE
    -> Admin account management
    -> Admin approval

can_receive = TRUE
    -> Receiving

can_withdraw = TRUE
    -> Withdrawal
```

Use large mode cards before introducing a sidebar. Add a sidebar only when the
number of authorized screens makes persistent navigation useful.

## Page organization

The repository-root `index.html` remains the authenticated landing page and
permission-based mode selector. Operational interfaces are organized under
`pages/`, with one directory per page:

```text
pages/receiving/
pages/withdrawal/
pages/admin-accounts/
pages/admin-erp/
```

Each completed page keeps its own readable `index.html`, `<module>.css`, and
`<module>.js`. For example, the receiving page uses
`receiving/index.html`, `receiving/receiving.css`, and `receiving/receiving.js`.
Authentication and backend authorization must still be validated when entering
any operational page; a page URL never grants permission.

The root page keeps the short-lived Google ID token in same-tab
`sessionStorage` for navigation to operational pages. Tokens must never appear
in URLs or `localStorage`. Every operational page calls `authCheck` again before
showing controls, and every business action remains authorized by the backend.

## Google Chat link

New customer requests generate a Chat notification containing a link to the
Admin web app. The link opens the relevant request; the Admin must still
authenticate and confirm the ERP process inside the web app.

## Visual direction

- Use `Kanit` as the primary user-interface font, matching the existing AES
  warehouse application.
- Use shared CSS color tokens, layered light surfaces, subtle borders, compact
  radii, and clear blue focus states from the existing warehouse design
  language.
- Use a calm, high-contrast warehouse interface.
- Keep body text at least 16px.
- Use green for accepted/available, amber for pending, and red for rejected/error.
- Avoid dense tables on mobile; use stacked cards and scan-result rows.
- Keep the scanner control visible without scrolling.
- Keep vertical page scrolling available for long forms and account lists;
  do not copy the 3D application's full-screen `overflow: hidden` rule.

## Open decisions

- Final product name and logo.
- Whether customer users can submit multiple tires in one batch before confirming.
- Whether receiving requires a selected customer/site before scanning.


