// Persist checklist progress locally so the report survives page refreshes.
const STORAGE_KEY = 'wh-consignment-roadmap-progress';

// The separate progress-data.js file is the Codex-maintained baseline. It lets
// project work update progress without mixing status data into UI behavior.
const projectProgressData = window.projectProgress || {
  taskStatus: {}
};

// The roadmap separates the three operational flows from the supporting system
// work underneath them. These tasks are intentionally tool-agnostic.
const roadmapPhases = [
  {
    id: 'flow-warehouse',
    title: 'Flow 1 — Warehouse consignment registration',
    description:
      'Front-line warehouse staff register every tire before the delivery vehicle departs.',
    tasks: [
      {
        id: 'warehouse-scope',
        title: 'Confirm the warehouse workflow and ownership boundary',
        detail:
          'Decide which existing warehouse application screens and users will own this section.'
      },
      {
        id: 'warehouse-input',
        title: 'Build ORD, lot, and serial capture',
        detail:
          'Scan one ORD, then record each lot and serial pair with clear validation feedback.'
      },
      {
        id: 'warehouse-resolution',
        title: 'Resolve customer and product information in the backend',
        detail:
          'Use master data to resolve customer and product values instead of trusting browser input.'
      },
      {
        id: 'warehouse-record',
        title: 'Create one consignment record per tire',
        detail:
          'Generate consignment_item_id and store historical customer and product snapshots.'
      },
      {
        id: 'warehouse-validation',
        title: 'Reject invalid or duplicate serial numbers',
        detail:
          'Prevent the same tire from being registered twice and provide an actionable error.'
      },
      {
        id: 'warehouse-shipment',
        title: 'Register tires as ready for shipment',
        detail:
          'Do not require a driver or warehouse worker to click a shipment status; receiving confirms physical arrival.'
      }
    ]
  },
  {
    id: 'flow-receiving',
    title: 'Flow 2 — Sugar-mill receiving and withdrawal',
    description:
      'Mill workers receive every tire by QR scan, then customers request tires by serial number.',
    tasks: [
      {
        id: 'receiving-auth',
        title: 'Authenticate the receiving checker',
        detail:
          'Allow only active approved accounts to enter continuous receiving mode.'
      },
      {
        id: 'receiving-scan',
        title: 'Build continuous serial QR receiving',
        detail:
          'Keep the USB-C scanner input focused, clear it after every scan, and show the last result.'
      },
      {
        id: 'receiving-transition',
        title: 'Validate and transition received inventory',
        detail:
          'Resolve the serial and change a valid READY_TO_SHIP item to RECEIVED.'
      },
      {
        id: 'receiving-log',
        title: 'Record every receiving attempt',
        detail:
          'Write RECEIVED, DUPLICATE, NOT_FOUND, WRONG_CUSTOMER, or other defined outcomes.'
      },
      {
        id: 'withdrawal-auth',
        title: 'Authenticate the customer before withdrawal',
        detail:
          'Use the verified Google account to determine customer ownership.'
      },
      {
        id: 'withdrawal-submit',
        title: 'Build serial scan and withdrawal submission',
        detail:
          'Customer input is limited to the serial number and required photo.'
      },
      {
        id: 'withdrawal-photo',
        title: 'Upload and verify the withdrawal photo',
        detail:
          'Store the Drive file reference and block submission if the upload fails.'
      },
      {
        id: 'withdrawal-log',
        title: 'Write the withdrawal transaction',
        detail:
          'Resolve ORD, lot, product, and customer values on the backend and create a SUBMITTED record.'
      }
    ]
  },
  {
    id: 'flow-admin',
    title: 'Flow 3 — Admin review, approval, and notification',
    description:
      'The company receives a request notification and an authorized admin completes the final decision.',
    tasks: [
      {
        id: 'admin-bootstrap',
        title: 'Bootstrap the first ADMIN account',
        detail:
          'Seed one trusted admin manually before relying on the admin account-management screen.'
      },
      {
        id: 'admin-accounts',
        title: 'Build searchable approved-account management',
        detail:
          'Search customers by code or name instead of forcing admins to scroll through IDs.'
      },
      {
        id: 'admin-queue',
        title: 'Build the pending withdrawal queue',
        detail:
          'Show customer, serial, product, photo, timestamp, and current request status.'
      },
      {
        id: 'admin-approval',
        title: 'Build secure ERP confirmation action',
        detail:
          'Require is_admin authorization, validate SUBMITTED status, and record the Admin identity after the ERP order is completed.'
      },
      {
        id: 'admin-chat',
        title: 'Send a Google Chat notification with an admin link',
        detail:
          'Notify the company order room without allowing the link itself to approve anything.'
      },
      {
        id: 'admin-audit',
        title: 'Record approval, rejection, and notification history',
        detail:
          'Keep timestamps, actors, reasons, and notification outcomes for auditability.'
      }
    ]
  },
  {
    id: 'iceberg-foundation',
    title: 'Foundation beneath the flows',
    description:
      'The security, data, backend, and operational work that makes the three flows reliable.',
    tasks: [
      {
        id: 'foundation-data',
        title: 'Finalize sheet columns, identifiers, and status values',
        detail:
          'Keep DATA_MODEL.md synchronized with the actual Google Sheet tabs.'
      },
      {
        id: 'foundation-rules',
        title: 'Finalize business rules and allowed state transitions',
        detail:
          'Document what the backend must accept, reject, or mark as VOID/CANCELLED.'
      },
      {
        id: 'foundation-security',
        title: 'Enforce authentication and permission authorization in the backend',
        detail:
          'Never rely on hidden UI controls as the security boundary.'
      },
      {
        id: 'foundation-concurrency',
        title: 'Add locking and idempotency to read-check-write operations',
        detail:
          'Use LockService and client_request_id to prevent duplicate or conflicting updates.'
      },
      {
        id: 'foundation-errors',
        title: 'Define network, timeout, retry, and offline failure behavior',
        detail:
          'Make failures visible and prevent retries from creating duplicate transactions.'
      },
      {
        id: 'foundation-integrations',
        title: 'Configure Drive, Google Chat, OAuth, and Script Properties safely',
        detail:
          'Keep credentials and webhook URLs out of source code.'
      },
      {
        id: 'foundation-testing',
        title: 'Complete the test plan on mobile and desktop',
        detail:
          'Test happy paths, duplicate scans, wrong customers, unauthorized permissions, and failed uploads.'
      },
      {
        id: 'foundation-deploy',
        title: 'Deploy, monitor, document, and prepare recovery steps',
        detail:
          'Confirm GitHub Pages, Apps Script deployment versions, logs, backups, and rollback instructions.'
      },
      {
        id: 'foundation-migration',
        title: 'Record the future migration path to a real database',
        detail:
          'Preserve stable IDs and business rules so Google Sheets can later be replaced safely.'
      }
    ]
  }
];

let completedTaskIds = loadCompletedTaskIds();
let activeFilter = 'all';

// Convert Codex-maintained status values into the completed task set used by
// the checklist and water buckets.
function getBaselineCompletedTaskIds() {
  return new Set(
    Object.entries(projectProgressData.taskStatus)
      .filter(([, status]) => status === 'done')
      .map(([taskId]) => taskId)
  );
}

// Read progress defensively because localStorage may be unavailable or contain
// an invalid value after manual browser changes.
function loadCompletedTaskIds() {
  const baselineCompletedTaskIds = getBaselineCompletedTaskIds();

  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    const parsedValue = JSON.parse(storedValue || '[]');

    if (Array.isArray(parsedValue)) {
      parsedValue.forEach((taskId) => baselineCompletedTaskIds.add(taskId));
    }

    return baselineCompletedTaskIds;
  } catch (error) {
    console.warn('Roadmap progress could not be loaded:', error);
    return baselineCompletedTaskIds;
  }
}

// Persist only task IDs so the checklist remains independent of task wording.
function saveCompletedTaskIds() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...completedTaskIds])
    );
  } catch (error) {
    console.warn('Roadmap progress could not be saved:', error);
  }
}

// Return a flat list for progress calculations and filter decisions.
function getAllTasks() {
  return roadmapPhases.flatMap((phase) => phase.tasks);
}

// Calculate completion for one operational flow using its phase task IDs.
function getPhaseCompletionPercentage(phaseId) {
  const phase = roadmapPhases.find((candidate) => candidate.id === phaseId);

  if (!phase || phase.tasks.length === 0) {
    return 0;
  }

  const completedCount = phase.tasks.filter((task) =>
    completedTaskIds.has(task.id)
  ).length;

  return Math.round((completedCount / phase.tasks.length) * 100);
}

// Update one water bucket and optionally animate its wave while filling.
function updateWaterBucket(bucketId, percentage, shouldAnimate) {
  const waterFill = document.querySelector(`[data-water-fill="${bucketId}"]`);
  const percentageOutput = document.querySelector(
    `[data-bucket-percentage="${bucketId}"]`
  );

  if (!waterFill || !percentageOutput) {
    return;
  }

  waterFill.style.height = `${percentage}%`;
  percentageOutput.textContent = `${percentage}%`;

  if (!shouldAnimate) {
    return;
  }

  // Force a layout read so repeated checklist updates restart the animation.
  waterFill.classList.remove('is-filling');
  void waterFill.offsetWidth;
  waterFill.classList.add('is-filling');

  window.setTimeout(() => {
    waterFill.classList.remove('is-filling');
  }, 1200);
}

// Refresh all three operational flow buckets from the checklist state.
function updateWaterBuckets(shouldAnimate = false) {
  const bucketPhaseMap = {
    warehouse: 'flow-warehouse',
    receiving: 'flow-receiving',
    admin: 'flow-admin'
  };

  Object.entries(bucketPhaseMap).forEach(([bucketId, phaseId]) => {
    updateWaterBucket(
      bucketId,
      getPhaseCompletionPercentage(phaseId),
      shouldAnimate
    );
  });
}

// Decide whether a task should be visible under the selected filter.
function shouldShowTask(task) {
  const isCompleted = completedTaskIds.has(task.id);

  if (activeFilter === 'completed') {
    return isCompleted;
  }

  if (activeFilter === 'remaining') {
    return !isCompleted;
  }

  return true;
}

// Create one accessible checklist item without inserting untrusted HTML.
function createTaskElement(task) {
  const listItem = document.createElement('li');
  const label = document.createElement('label');
  const checkbox = document.createElement('input');
  const title = document.createElement('span');
  const detail = document.createElement('p');
  const isCompleted = completedTaskIds.has(task.id);

  listItem.className = 'task-item';
  if (isCompleted) {
    listItem.classList.add('is-completed');
  }

  label.className = 'task-label';
  checkbox.className = 'task-checkbox';
  checkbox.type = 'checkbox';
  checkbox.checked = isCompleted;
  checkbox.setAttribute('aria-label', `Complete: ${task.title}`);
  checkbox.addEventListener('change', () => {
    updateTaskCompletion(task.id, checkbox.checked);
  });

  title.className = 'task-title';
  title.textContent = task.title;

  detail.className = 'task-detail';
  detail.textContent = task.detail;

  label.append(checkbox, title);
  listItem.append(label, detail);

  return listItem;
}

// Create one phase card and show its visible task count.
function createPhaseElement(phase) {
  const card = document.createElement('article');
  const header = document.createElement('header');
  const headingGroup = document.createElement('div');
  const title = document.createElement('h2');
  const description = document.createElement('p');
  const progress = document.createElement('span');
  const taskList = document.createElement('ul');
  const visibleTasks = phase.tasks.filter(shouldShowTask);
  const phaseCompletedCount = phase.tasks.filter((task) =>
    completedTaskIds.has(task.id)
  ).length;

  card.className = 'phase-card';
  header.className = 'phase-header';
  headingGroup.className = 'heading-group';
  title.className = 'phase-title';
  title.textContent = phase.title;
  description.className = 'phase-description';
  description.textContent = phase.description;
  progress.className = 'phase-progress';
  progress.textContent = `${phaseCompletedCount}/${phase.tasks.length}`;
  taskList.className = 'task-list';

  header.append(headingGroup, progress);
  headingGroup.append(title, description);
  card.append(header, taskList);

  if (visibleTasks.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'phase-empty-state';
    emptyMessage.textContent =
      activeFilter === 'completed'
        ? 'No completed tasks in this phase yet.'
        : 'No remaining tasks in this phase.';
    taskList.append(emptyMessage);
  } else {
    visibleTasks.forEach((task) => {
      taskList.append(createTaskElement(task));
    });
  }

  return card;
}

// Render all phase cards and refresh the summary after every change.
function renderRoadmap({ animateWater = false } = {}) {
  const roadmapList = document.getElementById('roadmapList');
  roadmapList.replaceChildren();

  roadmapPhases.forEach((phase) => {
    roadmapList.append(createPhaseElement(phase));
  });

  updateProgressSummary();
  updateWaterBuckets(animateWater);
}

// Update one task, persist it, and redraw the affected checklist state.
function updateTaskCompletion(taskId, isCompleted) {
  if (isCompleted) {
    completedTaskIds.add(taskId);
  } else {
    completedTaskIds.delete(taskId);
  }

  saveCompletedTaskIds();
  renderRoadmap({ animateWater: true });
}

// Update the progress bar and counts shown at the top of the report.
function updateProgressSummary() {
  const allTasks = getAllTasks();
  const completedCount = allTasks.filter((task) =>
    completedTaskIds.has(task.id)
  ).length;
  const totalCount = allTasks.length;
  const percentage = totalCount === 0
    ? 0
    : Math.round((completedCount / totalCount) * 100);

  document.getElementById('overallProgress').value = percentage;
  document.getElementById('overallProgress').textContent =
    `${percentage}% complete`;
  document.getElementById('progressPercentage').textContent = `${percentage}%`;
  document.getElementById('progressSummary').textContent =
    `${completedCount} of ${totalCount} checklist items completed`;
}

// Mark the selected filter button and rerender the visible tasks.
function setActiveFilter(nextFilter) {
  activeFilter = nextFilter;

  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.filter === activeFilter);
  });

  renderRoadmap();
}

// Clear the saved checklist only after an explicit confirmation.
function resetProgress() {
  const shouldReset = window.confirm(
    'Reset all roadmap progress on this browser?'
  );

  if (!shouldReset) {
    return;
  }

  completedTaskIds = getBaselineCompletedTaskIds();
  saveCompletedTaskIds();
  renderRoadmap({ animateWater: true });
}

// Bind controls after the page has loaded.
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveFilter(button.dataset.filter);
    });
  });

  document.getElementById('printButton').addEventListener('click', () => {
    window.print();
  });

  document
    .getElementById('resetProgressButton')
    .addEventListener('click', resetProgress);

  renderRoadmap();
});
