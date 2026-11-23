# Application Pages

The repository root remains the authenticated landing page and permission-based
mode selector. Each operational page keeps its HTML, CSS, and JavaScript inside
one focused directory under `pages/`.

```text
pages/
├── receiving/       Sugar-mill tire receiving
├── withdrawal/      Customer tire withdrawal
├── admin-accounts/  Authorized-account management
└── admin-erp/       ERP confirmation queue
```

The receiving module is implemented and its core workflow has passed the first
manual Google Sheets tests. The other folders are reserved so future modules
have a stable location. Build and connect one module at a time; do not place
Apps Script backend files here.

Each completed module follows this naming convention:

```text
<module>/
├── index.html
├── <module>.css
└── <module>.js
```

Examples:

```text
receiving/index.html
receiving/receiving.css
receiving/receiving.js
```

The folder supplies the page context, so names such as `receivingIndex.html`
are unnecessary.
