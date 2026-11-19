# Project Instructions

## Project purpose

This project is a mobile-first warehouse scanning application. The scan flow is:

1. Scan one `ORD_NUM` to start an order session.
2. Scan a `LOT_NUM`.
3. Scan a `SERIAL_NUM`.
4. Save the lot and serial pair.
5. Repeat steps 2–4 for the same order.

## Code quality

- Write production-grade, maintainable code.
- Use descriptive names; do not use cryptic aliases such as `$` for DOM helpers.
- Keep HTML, CSS, and JavaScript in separate files.
- Prefer small, focused functions with one clear responsibility.
- Avoid unnecessary dependencies for this lightweight prototype.
- Preserve existing behavior unless the requested change requires otherwise.

## Frontend standards

- Use semantic HTML and accessible labels for form controls.
- Keep the interface usable on mobile screens and with barcode scanners.
- Validate all user input before saving it.
- Escape user-provided values before inserting them into the DOM.
- Keep styling in `style.css` and behavior in `script.js`; do not add inline CSS or inline JavaScript.
- Use clear UI feedback for the current scanning step and validation errors.

## Verification

- Run `node --check script.js` after JavaScript changes.
- Check the scan flow manually after changes: ORD → LOT → SERIAL → save → next item.
- Verify that empty and invalid fields cannot be saved.
- Check the layout at mobile and desktop widths.

## Implementation Plan

1. Confirm Git repository.
2. Confirm Apps Script / clasp link.
3. Define Google Sheet columns and status values.
4. Build backend authentication.
5. Build authentication UI.
6. Build ORD → LOT → SERIAL scanning.
7. Add status-based “delete”.
8. Test and deploy.