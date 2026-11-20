# UI Design

## Design goals

- Mobile-first.
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

Customer input is limited to:

```text
serial_num
photo
```

The email and customer identity are displayed as read-only values from the authenticated account.

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

## Admin screen

The admin screen shows:

- Pending requests.
- Customer.
- Serial and product information.
- Uploaded photo.
- Submission timestamp.
- Approve button.
- Reject button with reason.

The browser may hide this section for non-admin users, but backend authorization remains mandatory.

## Google Chat link

New customer requests generate a Chat notification containing a link to the admin web app. The link opens the relevant request; the admin must still authenticate and approve inside the web app.

## Visual direction

- Use a calm, high-contrast warehouse interface.
- Keep body text at least 16px.
- Use green for accepted/available, amber for pending, and red for rejected/error.
- Avoid dense tables on mobile; use stacked cards and scan-result rows.
- Keep the scanner control visible without scrolling.

## Open decisions

- Final product name and logo.
- Thai, English, or bilingual interface text.
- Whether customer users can submit multiple tires in one batch before confirming.
- Whether receiving requires a selected customer/site before scanning.


