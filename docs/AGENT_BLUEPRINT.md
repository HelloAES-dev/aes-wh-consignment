# Agent Blueprint

## Purpose

This file is a reusable, tool-agnostic starting blueprint for new projects. It
explains the purpose of each planning document and gives Codex an interview
checklist to complete before implementation begins.

`AGENT_BLUEPRINT.md` is a planning template. `AGENTS.md` contains the active,
project-specific instructions that Codex must follow.

## Core project documentation

| File or folder | Purpose | Questions to answer first |
| --- | --- | --- |
| `AGENTS.md` | Active Codex and developer working rules: code style, file organization, verification commands, safety rules, and implementation plan. | What rules must always be followed in this project? |
| `AGENT_BLUEPRINT.md` | Reusable project-start template and interview checklist. | What information must be collected before building a new project? |
| `README.md` | Project overview and scope: what the system does, who uses it, version-one scope, setup, and postponed work. | What does the system do, who uses it, and what is deliberately excluded? |
| `DATA_MODEL.md` | Data structure: tables or sheets, columns, identifiers, statuses, and relationships. | What data exists, what is unique, and how are records related? |
| `BUSINESS_RULES.md` | System logic and guardrails: permissions, validation, state transitions, duplicate handling, and deletion rules. | What must always be true, what is forbidden, and who may perform each action? |
| `UI_DESIGN.md` | User experience: screens, navigation, theme, accessibility, responsive behavior, and device interaction. | What does each user see, what is the next action, and how should errors appear? |
| `TEST_PLAN.md` | Release verification: normal scenarios, failure cases, permissions, device checks, and acceptance criteria. | How will we prove the system works before deployment? |
| `DECISIONS.md` (optional) | Important architectural decisions and their reasons. | Which choices may need to be remembered or revisited later? |
| `docs/project-log/` (optional) | Daily summaries requested with `SUMMARIZE`. | What was completed today, what changed, what was verified, and what remains? |

The core documents are tool-independent. Add implementation files only after
the interview confirms the chosen stack. For example, a project may use HTML,
CSS, and JavaScript; a different project may use React, Python, SQL, Supabase,
Apps Script, or another stack. Do not assume `clasp`, GitHub Actions, Google
Sheets, or any other tool unless the project actually needs it.

## Required interview before implementation

### 1. Project purpose and scope

- What real-world problem does the project solve?
- Who are the user types?
- What is explicitly in scope for the first release?
- What is explicitly postponed?
- What is the smallest useful end-to-end workflow?

### 2. Data and ownership

- What are the source tables, sheets, or collections?
- What is the unique identifier for each record?
- Which values are entered by users?
- Which values must be resolved by the backend?
- Which values should be stored as historical snapshots?
- Which records must never be physically deleted?

### 3. Statuses and workflow

- What are the valid statuses?
- Which status transitions are allowed?
- What happens when the same request is submitted twice?
- What happens when a barcode is unknown, duplicated, or already processed?
- Which actions require idempotency or locking?

### 4. Authentication and authorization

- How do users sign in?
- Which accounts, domains, or roles are allowed?
- What is the difference between authentication and authorization in this project?
- Which actions are customer-only, staff-only, or admin-only?
- What must the backend verify even if the browser hides the UI?

### 5. User interface and devices

- Which screens are required for each role?
- Is the interface mobile-first?
- Does a scanner behave like a keyboard and send an Enter suffix?
- Are photos, camera access, or file uploads required?
- What should the user see during loading, success, failure, and offline conditions?
- Which languages and labels are required?

### 6. Backend and integrations

- Which backend platform will be used first?
- Which data source is temporary, and what is the planned migration path?
- Which external services are required, such as Drive, Chat, email, or OAuth?
- Where are environment variables, secrets, and service credentials stored?
- Which frontend-to-backend calls require a same-origin design or a CORS-safe transport?
- What is the fallback plan if a chosen service cannot support the required integration?

### 7. Deployment and repository

- Which files are deployed, and by which tool?
- Is deployment manual, automated, or both?
- What branch, environment, or release event triggers deployment?
- What are the local verification and synchronization commands?
- What is the rollback or recovery procedure?

### 8. Testing and release

- What is the happy-path acceptance test?
- What are the most dangerous failure cases?
- Which permission combinations must be tested?
- Which mobile widths and browsers must be checked?
- What evidence is required before calling the release ready?

## New-project startup sequence

1. Confirm the repository, branch, hosting, and backend project.
2. Complete the interview above and record the answers in the documentation files.
3. Define identifiers, columns, statuses, roles, and state transitions.
4. Confirm the deployment boundary for frontend and backend files.
5. Build and test authentication before business transactions.
6. Build one end-to-end workflow at a time.
7. Run the test plan and update the README before deployment.

## Daily summary convention

When the user types `SUMMARIZE`, create or update:

```text
docs/project-log/<project_name>_YYYY_MM_DD.md
```

Each log should contain:

- Date
- Completed work
- Decisions and reasons
- Files changed
- Verification performed
- Blockers or known risks
- Next steps
