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

The ADMIN account-management screen shows:

- New-account email input.
- Role selector.
- Searchable customer selector using customer code or name.
- Current authorized accounts with customer names.
- Activate or deactivate action; no delete action.

The later approval screen will show:

- Pending requests.
- Customer.
- Serial and product information.
- Uploaded photo.
- Submission timestamp.
- Approve button.
- Reject button with reason.

The browser may hide this section for non-admin users, but backend authorization remains mandatory.

## Role-based home screen

Users do not choose whether they are an admin or worker. The backend returns
the role associated with the authenticated email, and the frontend displays
only the modes allowed for that role.

```text
ADMIN
    -> Admin account management
    -> Admin approval

RECEIVING_CHECKER
    -> Receiving

CUSTOMER_USER
    -> Withdrawal

CUSTOMER_ADMIN
    -> Withdrawal
```

Use large mode cards before introducing a sidebar. Add a sidebar only when the
number of authorized screens makes persistent navigation useful.

## Google Chat link

New customer requests generate a Chat notification containing a link to the admin web app. The link opens the relevant request; the admin must still authenticate and approve inside the web app.

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


