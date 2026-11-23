/**
 * Codex-maintained project progress.
 *
 * Update a task from planned to in_progress, done, or blocked when the real
 * project reaches that milestone. The checklist UI reads this file as its
 * baseline and keeps manual browser checks separately in localStorage.
 */
window.projectProgress = Object.freeze({
  projectName: 'wh-consignment',
  lastReviewed: '2026-11-23',
  taskStatus: Object.freeze({
    'warehouse-scope': 'planned',
    'warehouse-input': 'in_progress',
    'warehouse-resolution': 'planned',
    'warehouse-record': 'planned',
    'warehouse-validation': 'planned',
    'warehouse-shipment': 'planned',

    'receiving-auth': 'done',
    'receiving-scan': 'done',
    'receiving-transition': 'done',
    'receiving-log': 'done',
    'withdrawal-auth': 'done',
    'withdrawal-submit': 'done',
    'withdrawal-photo': 'done',
    'withdrawal-log': 'done',

    'admin-bootstrap': 'done',
    'admin-accounts': 'in_progress',
    'admin-queue': 'in_progress',
    'admin-approval': 'in_progress',
    'admin-chat': 'planned',
    'admin-audit': 'planned',

    'foundation-data': 'done',
    'foundation-rules': 'done',
    'foundation-security': 'in_progress',
    'foundation-concurrency': 'in_progress',
    'foundation-errors': 'in_progress',
    'foundation-integrations': 'in_progress',
    'foundation-testing': 'in_progress',
    'foundation-deploy': 'in_progress',
    'foundation-migration': 'planned'
  })
});
