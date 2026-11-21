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
- Always write readable code with clear spacing, line breaks, indentation, and grouping. Never compress or clump HTML, CSS, JavaScript, or Apps Script into difficult-to-read lines.
- Add concise comments for each logical section and for non-obvious functions, decisions, validation rules, and integrations. Comments must explain the purpose or reasoning and remain accurate as the code changes.
- If a file format does not support comments, do not add comments that would make the file invalid; preserve the format's valid syntax instead.
- Use descriptive names; do not use cryptic aliases such as `$` for DOM helpers.
- Keep HTML, CSS, and JavaScript in separate files.
- Prefer small, focused functions with one clear responsibility.
- Avoid unnecessary dependencies for this lightweight prototype.
- Preserve existing behavior unless the requested change requires otherwise.

## Change handoff commands

- After changing code or completing an adjustment, always provide the synchronization commands in two separate blocks.
- Always provide the Git block first:

  ```powershell
  git add .
  git commit -m "Describe the change"
  git push
  ```

- Then provide the Apps Script block:

  ```powershell
  clasp.cmd push
  ```

- Explain that `clasp.cmd push` synchronizes Apps Script files such as `Code.js` and `appsscript.json`, but always include the command so the Apps Script project is not forgotten.

## Frontend standards

- Communicate with the project owner in English for development discussions, explanations, reviews, and handoff instructions.
- Thai is the primary user-facing language because this application is used by workers in Thailand. Use Thai first for labels, buttons, instructions, validation messages, and status feedback.
- Keep Thai limited to worker-facing application UI and other end-user content unless the project owner explicitly requests Thai elsewhere.
- Keep technical identifiers such as database columns, API action names, status codes, and source-code comments in clear English unless a Thai explanation is needed for the user.
- If bilingual text is needed, display Thai first and English second.
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

## Documentation source of truth

- Read the relevant file in `docs/` before changing business logic, data columns, UI behavior, or tests.
- Keep `docs/DATA_MODEL.md`, `docs/BUSINESS_RULES.md`, `docs/UI_DESIGN.md`, and `docs/TEST_PLAN.md` synchronized with implementation changes.
- Keep `README.md` updated when the project scope or setup changes.

## Daily project summaries

- When the user types `SUMMARIZE` at the end of the day, summarize the work completed during that day.
- Save the summary as `docs/project-log/<project_name>_YYYY_MM_DD.md`.
- Include the date, completed work, decisions, changed files, verification performed, blockers, and next steps.
- If the daily log already exists, update that same file instead of creating a duplicate.
- Keep daily summaries as project history; do not treat them as replacement instructions for `AGENTS.md`.

## Implementation Plan

1. Confirm Git repository.
2. Confirm Apps Script / clasp link.
3. Define Google Sheet columns and status values.
4. Build backend authentication.
5. Build authentication UI.
6. Build ORD → LOT → SERIAL scanning.
7. Add status-based “delete”.
8. Test and deploy.
