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

The receiving module is implemented and its core workflow has passed manual
Google Sheets and mobile tests. The withdrawal module includes serial lookup,
camera-photo compression and upload, and batch submission; its first complete
end-to-end test has passed. The Admin ERP module contains the authenticated
pending queue and approval interface and still requires deployed acceptance
testing. Account management currently remains embedded in the root application.
Do not place Apps Script backend files here.

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
