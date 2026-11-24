const WITHDRAWAL_BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

// Return an element by ID using a descriptive helper name.
function getElementById(elementId) {
  return document.getElementById(elementId);
}

// Keep page elements together so queue and approval handlers stay readable.
const userInterface = {
  accessCard: getElementById('accessCard'),
  accessTitle: getElementById('accessTitle'),
  accessMessage: getElementById('accessMessage'),
  signInLink: getElementById('signInLink'),
  adminErpApplication: getElementById('adminErpApplication'),
  authenticatedEmail: getElementById('authenticatedEmail'),
  refreshQueueButton: getElementById('refreshQueueButton'),
  pendingBatchCount: getElementById('pendingBatchCount'),
  pendingItemCount: getElementById('pendingItemCount'),
  queueStatus: getElementById('queueStatus'),
  pendingBatchList: getElementById('pendingBatchList'),
  emptyQueueState: getElementById('emptyQueueState'),
  approvalDialog: getElementById('approvalDialog'),
  approvalDialogDescription: getElementById('approvalDialogDescription'),
  cancelApprovalButton: getElementById('cancelApprovalButton'),
  confirmApprovalButton: getElementById('confirmApprovalButton')
};

let currentIdToken = '';
let currentUser = null;
let pendingBatches = [];
let selectedApprovalBatchId = '';
let focusedBatchId = readFocusedBatchId();

// Read an optional Chat-provided batch identifier without treating it as
// authorization. Invalid values are ignored before any DOM or API use.
function readFocusedBatchId() {
  const batchId = new URLSearchParams(window.location.search).get('batch');
  const normalizedBatchId = String(batchId || '').trim();

  return WITHDRAWAL_BATCH_ID_PATTERN.test(normalizedBatchId)
    ? normalizedBatchId
    : '';
}

// Authenticate against the backend before revealing any withdrawal details.
async function initializeAdminErpPage() {
  const storedSession = window.authenticationSession.read();

  if (!storedSession) {
    showAccessFailure(
      'ยังไม่ได้ลงชื่อเข้าใช้',
      'กรุณากลับไปลงชื่อเข้าใช้ก่อนเปิดหน้าผู้ดูแลระบบ'
    );
    return;
  }

  currentIdToken = storedSession.idToken;

  try {
    const result = await sendBackendRequest('authCheck');
    const permissions = result.user && result.user.permissions
      ? result.user.permissions
      : {};

    if (!permissions.is_admin) {
      showAccessFailure(
        'ไม่มีสิทธิ์ผู้ดูแลระบบ',
        'บัญชีนี้ไม่ได้รับสิทธิ์ตรวจสอบรายการเปิดออเดอร์ ERP'
      );
      return;
    }

    currentUser = result.user;
    window.authenticationSession.save(currentIdToken, currentUser);
    showAdminErpApplication();
    await loadPendingBatches();
  } catch (error) {
    console.error('Admin ERP authentication failed:', error);
    window.authenticationSession.clear();
    showAccessFailure(
      'เซสชันหมดอายุ',
      error.message || 'กรุณากลับไปลงชื่อเข้าใช้อีกครั้ง'
    );
  }
}

function showAccessFailure(title, message) {
  userInterface.accessTitle.textContent = title;
  userInterface.accessMessage.textContent = message;
  userInterface.accessCard.classList.remove('hidden');
  userInterface.signInLink.classList.remove('hidden');
  userInterface.adminErpApplication.classList.add('hidden');
}

function showAdminErpApplication() {
  userInterface.authenticatedEmail.textContent = currentUser.email;
  userInterface.accessCard.classList.add('hidden');
  userInterface.adminErpApplication.classList.remove('hidden');
}

// Send authenticated JSON as text/plain to avoid an Apps Script preflight.
async function sendBackendRequest(action, requestData = {}) {
  let response;

  try {
    response = await fetch(window.APP_CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify({
        ...requestData,
        action: action,
        idToken: currentIdToken
      })
    });
  } catch (error) {
    throw new Error('ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบอินเทอร์เน็ต');
  }

  if (!response.ok) {
    throw new Error(`ระบบตอบกลับด้วยสถานะ ${response.status}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || 'ระบบไม่สามารถดำเนินการได้');
  }

  return result;
}

// Load the complete pending queue in one request and render grouped cards.
async function loadPendingBatches() {
  setQueueBusy(true);
  setQueueStatus('กำลังโหลดรายการที่รอเปิดออเดอร์...');

  try {
    const result = await sendBackendRequest('adminListPendingWithdrawals');
    pendingBatches = Array.isArray(result.batches) ? result.batches : [];
    renderPendingQueue();

    if (pendingBatches.length === 0) {
      setQueueStatus('ไม่มีรายการรอเปิดออเดอร์', 'success');
    } else {
      setQueueStatus(`พบ ${pendingBatches.length} รอบเบิกที่รอดำเนินการ`);
    }

    focusRequestedBatch();
  } catch (error) {
    console.error('Pending withdrawal queue failed:', error);
    pendingBatches = [];
    renderPendingQueue();
    setQueueStatus(
      error.message || 'ไม่สามารถโหลดรายการได้ กรุณาลองใหม่อีกครั้ง',
      'error'
    );
  } finally {
    setQueueBusy(false);
  }
}

function setQueueBusy(isBusy) {
  userInterface.refreshQueueButton.disabled = isBusy;
  userInterface.refreshQueueButton.textContent = isBusy
    ? 'กำลังโหลด...'
    : 'โหลดรายการใหม่';
}

function setQueueStatus(message, statusType = '') {
  userInterface.queueStatus.textContent = message;
  userInterface.queueStatus.className = 'queue-status';

  if (statusType) {
    userInterface.queueStatus.classList.add(`is-${statusType}`);
  }
}

function renderPendingQueue() {
  userInterface.pendingBatchList.replaceChildren();

  pendingBatches.forEach(function (batch) {
    userInterface.pendingBatchList.append(createPendingBatchCard(batch));
  });

  userInterface.pendingBatchList.classList.toggle(
    'hidden',
    pendingBatches.length === 0
  );
  userInterface.emptyQueueState.classList.toggle(
    'hidden',
    pendingBatches.length > 0
  );

  updateQueueCounters();
}

function updateQueueCounters() {
  const itemCount = pendingBatches.reduce(function (total, batch) {
    return total + getPositiveInteger(batch.item_count);
  }, 0);

  userInterface.pendingBatchCount.textContent = String(pendingBatches.length);
  userInterface.pendingItemCount.textContent = String(itemCount);
}

function createPendingBatchCard(batch) {
  const card = document.createElement('article');
  const headingRow = document.createElement('div');
  const customerInformation = document.createElement('div');
  const customerCode = document.createElement('h3');
  const customerName = document.createElement('p');
  const statusGroup = document.createElement('div');
  const pendingBadge = document.createElement('span');
  const chatStatusBadge = createChatStatusBadge(
    batch.chat_notification_status
  );
  const chatStatus = normalizeChatNotificationStatus(
    batch.chat_notification_status
  );
  const metadata = document.createElement('div');
  const products = document.createElement('div');
  const totalRow = document.createElement('div');
  const totalLabel = document.createElement('strong');
  const totalValue = document.createElement('strong');
  const details = createBatchDetails(batch);
  const approvalButton = document.createElement('button');

  card.className = `admin-batch-card is-chat-${chatStatus.toLowerCase()}`;
  card.dataset.batchId = String(batch.withdrawal_batch_id || '');

  headingRow.className = 'batch-heading-row';
  customerCode.className = 'batch-customer-code';
  customerCode.textContent = getDisplayValue(
    batch.customer_id,
    'ไม่ระบุรหัสลูกค้า'
  );
  customerName.className = 'batch-customer-name';
  customerName.textContent = getDisplayValue(
    batch.customer_name_snapshot,
    'ไม่ระบุชื่อลูกค้า'
  );
  pendingBadge.className = 'pending-badge';
  pendingBadge.textContent = 'รอเปิดออเดอร์';

  customerInformation.append(customerCode, customerName);
  statusGroup.className = 'batch-status-group';
  statusGroup.append(pendingBadge, chatStatusBadge);
  headingRow.append(customerInformation, statusGroup);

  metadata.className = 'batch-metadata';
  metadata.append(
    createMetadataItem('ส่งรายการเมื่อ', formatBangkokDate(batch.submitted_at)),
    createMetadataItem(
      'รหัสรอบเบิก',
      getDisplayValue(batch.withdrawal_batch_id, 'ไม่ระบุ')
    )
  );

  products.className = 'product-lines';
  createProductLines(batch.products).forEach(function (productLine) {
    products.append(productLine);
  });

  totalRow.className = 'batch-total-row';
  totalLabel.textContent = 'รวมทั้งหมด';
  totalValue.textContent = `${getPositiveInteger(batch.item_count)} เส้น`;
  totalRow.append(totalLabel, totalValue);

  approvalButton.type = 'button';
  approvalButton.className = 'approve-batch-button';
  approvalButton.textContent = 'ยืนยันว่าเปิดออเดอร์ใน ERP แล้ว';
  approvalButton.addEventListener('click', function () {
    openApprovalDialog(batch);
  });

  card.append(
    headingRow,
    metadata,
    products,
    totalRow,
    details,
    approvalButton
  );

  return card;
}

// Show notification delivery separately from the ERP approval state. A Chat
// failure must remain visible without blocking the Admin from opening an order.
function createChatStatusBadge(value) {
  const status = normalizeChatNotificationStatus(value);
  const statusLabels = {
    SENT: 'แจ้ง Google Chat แล้ว',
    PENDING: 'รอแจ้ง Google Chat',
    FAILED: 'ส่ง Google Chat ไม่สำเร็จ'
  };
  const badge = document.createElement('span');

  badge.className = `chat-status-badge is-${status.toLowerCase()}`;
  badge.textContent = statusLabels[status];
  return badge;
}

function normalizeChatNotificationStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  return ['SENT', 'FAILED'].includes(status) ? status : 'PENDING';
}

function createMetadataItem(label, value) {
  const container = document.createElement('div');
  const labelElement = document.createElement('span');
  const valueElement = document.createElement('strong');

  labelElement.textContent = label;
  valueElement.textContent = value;
  container.append(labelElement, valueElement);

  return container;
}

function createProductLines(products) {
  const normalizedProducts = Array.isArray(products) && products.length > 0
    ? products
    : [{ product_code: '', product_name_snapshot: '', quantity: 0 }];

  return normalizedProducts.map(function (product) {
    const row = document.createElement('div');
    const information = document.createElement('div');
    const code = document.createElement('span');
    const name = document.createElement('span');
    const quantity = document.createElement('strong');

    row.className = 'product-line';
    code.className = 'product-code';
    code.textContent = getDisplayValue(product.product_code, 'ไม่ระบุรหัสสินค้า');
    name.className = 'product-name';
    name.textContent = getDisplayValue(
      product.product_name_snapshot,
      'ไม่ระบุชื่อสินค้า'
    );
    quantity.className = 'product-quantity';
    quantity.textContent = `${getPositiveInteger(product.quantity)} เส้น`;

    information.append(code, name);
    row.append(information, quantity);

    return row;
  });
}

function createBatchDetails(batch) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const itemList = document.createElement('ul');
  const items = Array.isArray(batch.items) ? batch.items : [];

  details.className = 'batch-details';
  summary.textContent = `ดู Serial และรูปภาพ (${items.length} รายการ)`;
  itemList.className = 'batch-item-list';

  items.forEach(function (item) {
    itemList.append(createBatchItemRow(item));
  });

  if (items.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'batch-item-row';
    emptyItem.textContent = 'ไม่มีรายละเอียด Serial ในรายการนี้';
    itemList.append(emptyItem);
  }

  details.append(summary, itemList);
  return details;
}

function createBatchItemRow(item) {
  const row = document.createElement('li');
  const information = document.createElement('div');
  const serial = document.createElement('strong');
  const product = document.createElement('span');
  const safePhotoUrl = getSafeDrivePhotoUrl(item.photo_drive_url);

  row.className = 'batch-item-row';
  serial.className = 'item-serial';
  serial.textContent = getDisplayValue(item.serial_num, 'ไม่ระบุ Serial');
  product.className = 'item-product';
  product.textContent = createItemProductLabel(item);
  information.append(serial, product);
  row.append(information);

  if (safePhotoUrl) {
    const photoLink = document.createElement('a');
    photoLink.className = 'photo-link';
    photoLink.href = safePhotoUrl;
    photoLink.target = '_blank';
    photoLink.rel = 'noopener noreferrer';
    photoLink.textContent = 'ดูรูปภาพ';
    row.append(photoLink);
  } else {
    const unavailable = document.createElement('span');
    unavailable.className = 'photo-unavailable';
    unavailable.textContent = 'ไม่มีรูปภาพ';
    row.append(unavailable);
  }

  return row;
}

function createItemProductLabel(item) {
  const productCode = getDisplayValue(item.product_code, 'ไม่ระบุรหัสสินค้า');
  const productName = getDisplayValue(item.product_name_snapshot, 'ไม่ระบุชื่อสินค้า');

  return `${productCode} · ${productName}`;
}

// Only company-generated HTTPS Drive links become clickable anchors.
function getSafeDrivePhotoUrl(value) {
  try {
    const photoUrl = new URL(String(value || ''));

    if (photoUrl.protocol !== 'https:' || photoUrl.hostname !== 'drive.google.com') {
      return '';
    }

    return photoUrl.href;
  } catch (error) {
    return '';
  }
}

function getDisplayValue(value, fallback) {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || fallback;
}

function getPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function formatBangkokDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'ไม่ระบุวันและเวลา';
  }

  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok'
  }).format(date);
}

// Scroll a Chat-linked batch into view after authentication and queue loading.
function focusRequestedBatch() {
  if (!focusedBatchId) {
    return;
  }

  const focusedCard = Array.from(
    userInterface.pendingBatchList.querySelectorAll('.admin-batch-card')
  ).find(function (card) {
    return card.dataset.batchId === focusedBatchId;
  });

  if (!focusedCard) {
    setQueueStatus(
      'ไม่พบรายการที่ระบุ อาจได้รับการอนุมัติไปแล้วหรือไม่มีสิทธิ์เข้าถึง',
      'error'
    );
    return;
  }

  focusedCard.classList.add('is-focused');
  focusedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function openApprovalDialog(batch) {
  selectedApprovalBatchId = String(batch.withdrawal_batch_id || '');
  userInterface.approvalDialogDescription.textContent =
    `${getDisplayValue(batch.customer_id, 'ไม่ระบุรหัสลูกค้า')} · ` +
    `${getPositiveInteger(batch.item_count)} เส้น`;

  if (typeof userInterface.approvalDialog.showModal === 'function') {
    userInterface.approvalDialog.showModal();
    return;
  }

  // Older embedded browsers may not support <dialog>; retain the same single
  // confirmation decision through the native browser prompt.
  if (window.confirm('ยืนยันว่าเปิดออเดอร์ใน ERP เรียบร้อยแล้ว')) {
    approveSelectedBatch();
  } else {
    selectedApprovalBatchId = '';
  }
}

function closeApprovalDialog() {
  selectedApprovalBatchId = '';

  if (userInterface.approvalDialog.open) {
    userInterface.approvalDialog.close();
  }
}

async function approveSelectedBatch() {
  if (!WITHDRAWAL_BATCH_ID_PATTERN.test(selectedApprovalBatchId)) {
    closeApprovalDialog();
    setQueueStatus('รหัสรอบเบิกสินค้าไม่ถูกต้อง', 'error');
    return;
  }

  const batchId = selectedApprovalBatchId;
  const batchCard = findBatchCard(batchId);

  if (userInterface.approvalDialog.open) {
    userInterface.approvalDialog.close();
  }

  setApprovalBusy(true, batchCard);

  try {
    const result = await sendBackendRequest('adminApproveWithdrawalBatch', {
      withdrawalBatchId: batchId
    });

    if (!result.approved) {
      throw new Error(result.message || 'ไม่สามารถอนุมัติรายการนี้ได้');
    }

    pendingBatches = pendingBatches.filter(function (batch) {
      return batch.withdrawal_batch_id !== batchId;
    });
    focusedBatchId = focusedBatchId === batchId ? '' : focusedBatchId;
    removeFocusedBatchFromUrl(batchId);
    closeApprovalDialog();
    renderPendingQueue();
    setQueueStatus(
      result.idempotent
        ? 'รายการนี้ได้รับการอนุมัติไว้แล้ว'
        : 'ยืนยันการเปิดออเดอร์ในระบบสำเร็จ',
      'success'
    );
  } catch (error) {
    console.error('Admin ERP approval failed:', error);
    setQueueStatus(
      error.message || 'ไม่สามารถอนุมัติรายการได้ กรุณาลองใหม่อีกครั้ง',
      'error'
    );
  } finally {
    selectedApprovalBatchId = '';
    setApprovalBusy(false, batchCard);
  }
}

function setApprovalBusy(isBusy, batchCard) {
  userInterface.confirmApprovalButton.disabled = isBusy;
  userInterface.cancelApprovalButton.disabled = isBusy;
  userInterface.confirmApprovalButton.textContent = isBusy
    ? 'กำลังบันทึก...'
    : 'ยืนยันว่าเปิดออเดอร์แล้ว';

  if (batchCard) {
    batchCard.classList.toggle('is-processing', isBusy);
    const button = batchCard.querySelector('.approve-batch-button');

    if (button) {
      button.disabled = isBusy;
    }
  }
}

function findBatchCard(batchId) {
  return Array.from(
    userInterface.pendingBatchList.querySelectorAll('.admin-batch-card')
  ).find(function (card) {
    return card.dataset.batchId === batchId;
  }) || null;
}

function removeFocusedBatchFromUrl(batchId) {
  const url = new URL(window.location.href);

  if (url.searchParams.get('batch') !== batchId) {
    return;
  }

  url.searchParams.delete('batch');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

userInterface.refreshQueueButton.addEventListener('click', loadPendingBatches);
userInterface.cancelApprovalButton.addEventListener('click', closeApprovalDialog);
userInterface.confirmApprovalButton.addEventListener('click', approveSelectedBatch);

// Browser cancellation through Escape clears the selected batch safely.
userInterface.approvalDialog.addEventListener('cancel', function () {
  selectedApprovalBatchId = '';
});

initializeAdminErpPage();
