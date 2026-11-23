const TIRE_SERIAL_PATTERN = /^[A-Z0-9]{10}$/;
const MAX_PHOTO_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

// Return an element by ID using a descriptive helper name.
function getElementById(elementId) {
  return document.getElementById(elementId);
}

// Keep page elements together so workflow handlers remain easy to follow.
const userInterface = {
  accessCard: getElementById('accessCard'),
  accessTitle: getElementById('accessTitle'),
  accessMessage: getElementById('accessMessage'),
  signInLink: getElementById('signInLink'),
  withdrawalApplication: getElementById('withdrawalApplication'),
  authenticatedEmail: getElementById('authenticatedEmail'),
  customerIdentifier: getElementById('customerIdentifier'),
  batchIdentifier: getElementById('batchIdentifier'),
  newBatchButton: getElementById('newBatchButton'),
  scannerForm: getElementById('scannerForm'),
  serialInput: getElementById('serialInput'),
  scanButton: getElementById('scanButton'),
  scanStatus: getElementById('scanStatus'),
  photoInput: getElementById('photoInput'),
  withdrawalItemList: getElementById('withdrawalItemList'),
  emptyBatchMessage: getElementById('emptyBatchMessage'),
  itemCount: getElementById('itemCount'),
  submitBatchButton: getElementById('submitBatchButton'),
  submissionStatus: getElementById('submissionStatus'),
  submissionRetryPanel: getElementById('submissionRetryPanel'),
  submissionRetryMessage: getElementById('submissionRetryMessage'),
  submissionRetryButton: getElementById('submissionRetryButton'),
  successCard: getElementById('successCard'),
  successMessage: getElementById('successMessage'),
  productSummary: getElementById('productSummary'),
  nextBatchButton: getElementById('nextBatchButton')
};

let currentIdToken = '';
let currentUser = null;
let withdrawalBatchId = '';
let selectedPhotoSerial = '';
let draftItems = new Map();
let pendingSubmission = null;
let isSubmitting = false;

function createRequestIdentifier(prefix) {
  const randomValue = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

  return `${prefix}-${randomValue}`;
}

// Authenticate with the backend before revealing customer or inventory data.
async function initializeWithdrawalPage() {
  const storedSession = window.authenticationSession.read();

  if (!storedSession) {
    showAccessFailure(
      'ยังไม่ได้ลงชื่อเข้าใช้',
      'กรุณากลับไปลงชื่อเข้าใช้ก่อนเปิดหน้าเบิกสินค้า'
    );
    return;
  }

  currentIdToken = storedSession.idToken;

  try {
    const result = await sendBackendRequest('authCheck');
    const permissions = result.user && result.user.permissions
      ? result.user.permissions
      : {};

    if (!permissions.can_withdraw || !result.user.customer_id) {
      showAccessFailure(
        'ไม่มีสิทธิ์เบิกสินค้า',
        'บัญชีนี้ไม่ได้รับสิทธิ์หรือยังไม่ได้ผูกกับรหัสลูกค้า'
      );
      return;
    }

    currentUser = result.user;
    window.authenticationSession.save(currentIdToken, currentUser);
    startWithdrawalBatch();
  } catch (error) {
    console.error('Withdrawal authentication failed:', error);
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
  userInterface.withdrawalApplication.classList.add('hidden');
}

function startWithdrawalBatch() {
  releasePhotoPreviewUrls();
  withdrawalBatchId = createRequestIdentifier('W-BATCH');
  selectedPhotoSerial = '';
  draftItems = new Map();
  pendingSubmission = null;
  isSubmitting = false;

  userInterface.authenticatedEmail.textContent = currentUser.email;
  userInterface.customerIdentifier.textContent = currentUser.customer_id;
  userInterface.batchIdentifier.textContent = getShortIdentifier(
    withdrawalBatchId
  );
  userInterface.accessCard.classList.add('hidden');
  userInterface.withdrawalApplication.classList.remove('hidden');
  userInterface.successCard.classList.add('hidden');
  userInterface.submissionRetryPanel.classList.add('hidden');
  setOperationStatus(userInterface.scanStatus, '');
  setOperationStatus(userInterface.submissionStatus, '');
  renderDraftItems();
  setWorkflowBusy(false);
  focusScannerInput();
}

function getShortIdentifier(identifier) {
  const suffix = identifier.split('-').pop() || identifier;
  return suffix.slice(0, 8).toUpperCase();
}

// Send JSON as text/plain so Apps Script receives the request without a CORS
// preflight. Business validation remains in the backend.
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
    throw createRequestError(
      'NETWORK_ERROR',
      'ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบอินเทอร์เน็ต',
      true
    );
  }

  if (!response.ok) {
    throw createRequestError(
      'HTTP_ERROR',
      `ระบบตอบกลับด้วยสถานะ ${response.status}`,
      response.status >= 500
    );
  }

  let result;

  try {
    result = await response.json();
  } catch (error) {
    throw createRequestError(
      'INVALID_RESPONSE',
      'ระบบส่งผลตอบกลับไม่สมบูรณ์ กรุณาลองอีกครั้ง',
      true
    );
  }

  if (!result.success) {
    const retryableCodes = [
      'LOCK_TIMEOUT',
      'SERVER_ERROR',
      'PHOTO_UPLOAD_FAILED'
    ];

    throw createRequestError(
      result.code || 'BACKEND_ERROR',
      result.message || 'ระบบไม่สามารถดำเนินการได้',
      retryableCodes.includes(result.code)
    );
  }

  return result;
}

function createRequestError(code, message, retryable) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

async function handleScannerSubmit(event) {
  event.preventDefault();

  if (isSubmitting) {
    return;
  }

  const serialNumber = userInterface.serialInput.value.trim().toUpperCase();

  if (!TIRE_SERIAL_PATTERN.test(serialNumber)) {
    setOperationStatus(
      userInterface.scanStatus,
      'หมายเลข Serial ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลข 10 ตัว',
      'error'
    );
    focusScannerInput();
    return;
  }

  if (draftItems.has(serialNumber)) {
    setOperationStatus(
      userInterface.scanStatus,
      'หมายเลข Serial นี้อยู่ในรายการแล้ว',
      'error'
    );
    focusScannerInput();
    return;
  }

  setScannerBusy(true);
  setOperationStatus(userInterface.scanStatus, 'กำลังตรวจสอบสินค้า...');

  try {
    const result = await sendBackendRequest('lookupWithdrawalSerial', {
      serialNum: serialNumber
    });

    if (!result.available) {
      setOperationStatus(
        userInterface.scanStatus,
        result.message || 'สินค้านี้ไม่พร้อมเบิก',
        'error'
      );
      return;
    }

    draftItems.set(serialNumber, {
      ...result.item,
      photoUploadId: '',
      photoFileId: '',
      photoPreviewUrl: '',
      photoBase64: '',
      photoStatus: 'missing',
      photoMessage: 'ยังไม่ได้ถ่ายรูป'
    });
    userInterface.serialInput.value = '';
    setOperationStatus(
      userInterface.scanStatus,
      'พบสินค้า กรุณาถ่ายรูปเพื่อเตรียมส่งรายการ',
      'success'
    );
    renderDraftItems();
    openPhotoPicker(serialNumber);
  } catch (error) {
    console.error('Withdrawal lookup failed:', error);
    handleAccessOrOperationError(error, userInterface.scanStatus);
  } finally {
    setScannerBusy(false);
    focusScannerInput();
  }
}

function openPhotoPicker(serialNumber) {
  const item = draftItems.get(serialNumber);

  if (!item || isSubmitting || item.photoStatus === 'uploading') {
    return;
  }

  selectedPhotoSerial = serialNumber;
  userInterface.photoInput.value = '';
  userInterface.photoInput.click();
}

async function handlePhotoSelection() {
  const item = draftItems.get(selectedPhotoSerial);
  const photoFile = userInterface.photoInput.files[0];

  if (!item || !photoFile) {
    return;
  }

  item.photoStatus = 'processing';
  item.photoMessage = 'กำลังเตรียมรูปภาพ...';
  renderDraftItems();

  try {
    const compressedPhoto = await compressImageToJpeg(photoFile);

    if (item.photoPreviewUrl) {
      URL.revokeObjectURL(item.photoPreviewUrl);
    }

    item.photoPreviewUrl = URL.createObjectURL(compressedPhoto);
    item.photoBase64 = await convertBlobToBase64(compressedPhoto);
    item.photoUploadId = createRequestIdentifier('PHOTO');
    item.photoFileId = '';
    await uploadItemPhoto(item);
  } catch (error) {
    console.error('Photo preparation failed:', error);
    item.photoStatus = 'error';
    item.photoMessage = error.message || 'ไม่สามารถเตรียมรูปภาพได้';
    renderDraftItems();
  }
}

// Resize camera images before upload to reduce mobile data usage and Apps
// Script processing time. Every upload uses a predictable JPEG format.
async function compressImageToJpeg(file) {
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('กรุณาเลือกไฟล์รูปภาพ');
  }

  const imageSource = await loadImageSource(file);
  const scale = Math.min(
    1,
    MAX_PHOTO_DIMENSION / Math.max(imageSource.width, imageSource.height)
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(imageSource.width * scale));
  canvas.height = Math.max(1, Math.round(imageSource.height * scale));

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('อุปกรณ์นี้ไม่สามารถเตรียมรูปภาพได้');
  }

  context.drawImage(imageSource, 0, 0, canvas.width, canvas.height);

  if (typeof imageSource.close === 'function') {
    imageSource.close();
  }

  const jpegBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(
        new Error('ไม่สามารถแปลงรูปภาพเป็น JPEG ได้')
      ),
      'image/jpeg',
      JPEG_QUALITY
    );
  });

  if (jpegBlob.size > 5 * 1024 * 1024) {
    throw new Error('รูปภาพมีขนาดใหญ่เกิน 5 MB กรุณาถ่ายใหม่');
  }

  return jpegBlob;
}

async function loadImageSource(file) {
  if (window.createImageBitmap) {
    try {
      return await window.createImageBitmap(file);
    } catch (error) {
      console.warn('createImageBitmap failed, using image fallback:', error);
    }
  }

  return loadHtmlImage(file);
}

function loadHtmlImage(file) {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error('ไม่สามารถอ่านรูปภาพนี้ได้ กรุณาถ่ายใหม่'));
    };
    image.src = imageUrl;
  });
}

function convertBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      resolve(dataUrl.split(',')[1] || '');
    };
    reader.onerror = () => reject(
      new Error('ไม่สามารถอ่านข้อมูลรูปภาพได้')
    );
    reader.readAsDataURL(blob);
  });
}

async function uploadItemPhoto(item) {
  if (!item.photoBase64 || !item.photoUploadId) {
    return;
  }

  item.photoStatus = 'uploading';
  item.photoMessage = 'กำลังอัปโหลดรูปภาพ...';
  renderDraftItems();

  try {
    const result = await sendBackendRequest('uploadWithdrawalPhoto', {
      serialNum: item.serial_num,
      photoUploadId: item.photoUploadId,
      photoMimeType: 'image/jpeg',
      photoBase64: item.photoBase64
    });

    if (!result.uploaded) {
      item.photoStatus = 'error';
      item.photoMessage = result.message || 'อัปโหลดรูปภาพไม่สำเร็จ';
      renderDraftItems();
      return;
    }

    item.photoFileId = result.photo.file_id;
    item.photoBase64 = '';
    item.photoStatus = 'uploaded';
    item.photoMessage = result.idempotent
      ? 'รูปภาพนี้ถูกบันทึกไว้แล้ว'
      : 'อัปโหลดรูปภาพสำเร็จ';
    renderDraftItems();
  } catch (error) {
    console.error('Photo upload failed:', error);
    item.photoStatus = 'error';
    item.photoMessage = error.retryable
      ? `${error.message} กดปุ่มลองอัปโหลดอีกครั้ง`
      : error.message;
    renderDraftItems();
  }
}

// Remove only the local photo selection from an item. The tire remains in the
// draft batch so the worker can attach a replacement image immediately.
function clearItemPhoto(serialNumber) {
  const item = draftItems.get(serialNumber);

  if (!item || isSubmitting || item.photoStatus === 'uploading') {
    return;
  }

  if (item.photoPreviewUrl) {
    URL.revokeObjectURL(item.photoPreviewUrl);
  }

  item.photoUploadId = '';
  item.photoFileId = '';
  item.photoPreviewUrl = '';
  item.photoBase64 = '';
  item.photoStatus = 'missing';
  item.photoMessage = 'ยังไม่ได้ถ่ายรูป';
  pendingSubmission = null;
  renderDraftItems();
}

// Remove the complete tire item from the unsent withdrawal batch.
function removeDraftItem(serialNumber) {
  const item = draftItems.get(serialNumber);

  if (!item || isSubmitting || item.photoStatus === 'uploading') {
    return;
  }

  if (item.photoPreviewUrl) {
    URL.revokeObjectURL(item.photoPreviewUrl);
  }

  draftItems.delete(serialNumber);
  pendingSubmission = null;
  renderDraftItems();
  focusScannerInput();
}

// Render scanned values with DOM methods so no backend data becomes HTML.
function renderDraftItems() {
  userInterface.withdrawalItemList.replaceChildren();

  if (draftItems.size === 0) {
    userInterface.withdrawalItemList.append(userInterface.emptyBatchMessage);
  } else {
    draftItems.forEach((item) => {
      userInterface.withdrawalItemList.append(createDraftItemCard(item));
    });
  }

  userInterface.itemCount.textContent = `${draftItems.size} เส้น`;
  updateSubmitAvailability();
}

function createDraftItemCard(item) {
  const card = document.createElement('article');
  const information = document.createElement('div');
  const serial = document.createElement('strong');
  const product = document.createElement('span');
  const lot = document.createElement('span');
  const photoStatus = document.createElement('span');
  const actions = document.createElement('div');
  const photoButton = document.createElement('button');
  const clearPhotoButton = document.createElement('button');
  const removeButton = document.createElement('button');

  card.className = `withdrawal-item is-${item.photoStatus}`;
  serial.className = 'item-serial';
  serial.textContent = item.serial_num;
  product.className = 'item-product';
  product.textContent = `${item.product_code || '—'} · ` +
    `${item.product_name_snapshot || 'ไม่ระบุชื่อสินค้า'}`;
  lot.className = 'item-product';
  lot.textContent = `Lot: ${item.lot_num || '—'}`;
  photoStatus.className = 'item-photo-status';
  photoStatus.textContent = item.photoMessage;

  if (item.photoStatus === 'error') {
    photoStatus.classList.add('is-error');
  }

  information.append(serial, product, lot, photoStatus);
  actions.className = 'item-actions';

  if (item.photoPreviewUrl) {
    const preview = document.createElement('img');
    preview.className = 'photo-preview';
    preview.src = item.photoPreviewUrl;
    preview.alt = `รูปยาง ${item.serial_num}`;
    actions.append(preview);
  }

  photoButton.type = 'button';
  photoButton.className = 'photo-button';
  photoButton.disabled = isSubmitting || item.photoStatus === 'uploading';

  if (item.photoStatus === 'error' && item.photoBase64) {
    photoButton.textContent = 'ลองอัปโหลดอีกครั้ง';
    photoButton.addEventListener('click', () => uploadItemPhoto(item));
  } else {
    photoButton.textContent = item.photoFileId ? 'ถ่ายรูปใหม่' : 'ถ่ายรูป';
    photoButton.addEventListener('click', () => {
      openPhotoPicker(item.serial_num);
    });
  }

  clearPhotoButton.type = 'button';
  clearPhotoButton.className = 'clear-photo-button';
  clearPhotoButton.textContent = 'ลบรูป';
  clearPhotoButton.disabled = isSubmitting ||
    item.photoStatus === 'uploading' ||
    (!item.photoFileId && !item.photoBase64 && !item.photoPreviewUrl);
  clearPhotoButton.addEventListener('click', () => {
    clearItemPhoto(item.serial_num);
  });

  removeButton.type = 'button';
  removeButton.className = 'remove-item-button';
  removeButton.textContent = 'นำรายการนี้ออก';
  removeButton.disabled = isSubmitting || item.photoStatus === 'uploading';
  removeButton.addEventListener('click', () => {
    removeDraftItem(item.serial_num);
  });

  actions.append(photoButton, clearPhotoButton, removeButton);
  card.append(information, actions);
  return card;
}

function updateSubmitAvailability() {
  const items = Array.from(draftItems.values());
  const allPhotosUploaded = items.length > 0 && items.every((item) => {
    return item.photoStatus === 'uploaded' && item.photoFileId;
  });

  userInterface.submitBatchButton.disabled =
    isSubmitting || !allPhotosUploaded;
  userInterface.newBatchButton.disabled = isSubmitting;
}

function handleBatchSubmission() {
  if (isSubmitting || draftItems.size === 0) {
    return;
  }

  if (!pendingSubmission) {
    pendingSubmission = {
      clientRequestId: createRequestIdentifier('WDR-REQ'),
      withdrawalBatchId: withdrawalBatchId,
      items: Array.from(draftItems.values()).map((item) => ({
        serialNum: item.serial_num,
        photoDriveFileId: item.photoFileId
      }))
    };
  }

  submitPendingBatch();
}

// Keep the same request object across an uncertain failure so the backend's
// idempotency check prevents duplicate rows and inventory transitions.
async function submitPendingBatch() {
  if (!pendingSubmission) {
    return;
  }

  setWorkflowBusy(true);
  userInterface.submissionRetryPanel.classList.add('hidden');
  setOperationStatus(
    userInterface.submissionStatus,
    'กำลังบันทึกรายการเบิกสินค้า...'
  );

  try {
    const result = await sendBackendRequest(
      'submitWithdrawalBatch',
      pendingSubmission
    );

    if (!result.accepted) {
      const firstIssue = result.issues && result.issues[0];
      pendingSubmission = null;
      setWorkflowBusy(false);
      setOperationStatus(
        userInterface.submissionStatus,
        firstIssue ? firstIssue.message : result.message,
        'error'
      );
      return;
    }

    showSubmissionSuccess(result);
  } catch (error) {
    console.error('Withdrawal submission failed:', error);

    if (handleAccessFailure(error)) {
      return;
    }

    setWorkflowBusy(false);
    setOperationStatus(
      userInterface.submissionStatus,
      error.message,
      'error'
    );

    if (error.retryable) {
      userInterface.submissionRetryMessage.textContent =
        `${error.message} ระบบจะใช้รหัสคำขอเดิมเมื่อส่งอีกครั้ง`;
      userInterface.submissionRetryPanel.classList.remove('hidden');
    } else {
      pendingSubmission = null;
    }
  }
}

function showSubmissionSuccess(result) {
  const batch = result.batch || {};
  userInterface.successMessage.textContent =
    `บันทึก ${batch.item_count || draftItems.size} เส้นแล้ว ` +
    'สามารถนำสินค้าไปใช้งานได้';
  userInterface.productSummary.replaceChildren();

  (batch.products || []).forEach((product) => {
    const row = document.createElement('div');
    const name = document.createElement('span');
    const quantity = document.createElement('strong');

    row.className = 'product-summary-row';
    name.textContent = `${product.product_code || '—'} · ` +
      `${product.product_name_snapshot || 'ไม่ระบุชื่อสินค้า'}`;
    quantity.textContent = `${product.quantity} เส้น`;
    row.append(name, quantity);
    userInterface.productSummary.append(row);
  });

  setWorkflowBusy(false);
  userInterface.submissionRetryPanel.classList.add('hidden');
  userInterface.successCard.classList.remove('hidden');
  userInterface.successCard.scrollIntoView({ behavior: 'smooth' });
  userInterface.submitBatchButton.disabled = true;
}

function setScannerBusy(isBusy) {
  userInterface.serialInput.disabled = isBusy;
  userInterface.scanButton.disabled = isBusy;
  userInterface.scanButton.textContent = isBusy
    ? 'กำลังตรวจสอบ...'
    : 'ตรวจสอบ';
}

function setWorkflowBusy(busy) {
  isSubmitting = busy;
  setScannerBusy(busy);
  renderDraftItems();
}

function setOperationStatus(element, message, statusType = '') {
  element.textContent = message;
  element.className = 'operation-status';

  if (statusType) {
    element.classList.add(`is-${statusType}`);
  }
}

function handleAccessOrOperationError(error, statusElement) {
  if (handleAccessFailure(error)) {
    return;
  }

  setOperationStatus(statusElement, error.message, 'error');
}

function handleAccessFailure(error) {
  const accessFailureCodes = [
    'AUTHENTICATION_REQUIRED',
    'ACCESS_DENIED',
    'WITHDRAWAL_PERMISSION_REQUIRED',
    'WITHDRAWAL_CUSTOMER_REQUIRED'
  ];

  if (!accessFailureCodes.includes(error.code)) {
    return false;
  }

  window.authenticationSession.clear();
  showAccessFailure('ไม่สามารถเบิกสินค้าได้', error.message);
  return true;
}

function focusScannerInput() {
  window.setTimeout(() => {
    if (!userInterface.serialInput.disabled) {
      userInterface.serialInput.focus();
    }
  }, 50);
}

function releasePhotoPreviewUrls() {
  draftItems.forEach((item) => {
    if (item.photoPreviewUrl) {
      URL.revokeObjectURL(item.photoPreviewUrl);
    }
  });
}

function confirmNewBatch() {
  const confirmed = draftItems.size === 0 || window.confirm(
    'ยกเลิกรอบเบิกนี้และล้างรายการทั้งหมดบนหน้าจอหรือไม่?\n' +
    'ข้อมูลที่ส่งสำเร็จแล้วจะไม่ถูกลบ'
  );

  if (confirmed) {
    startWithdrawalBatch();
  }
}

window.addEventListener('load', initializeWithdrawalPage);
window.addEventListener('beforeunload', releasePhotoPreviewUrls);
userInterface.scannerForm.addEventListener('submit', handleScannerSubmit);
userInterface.photoInput.addEventListener('change', handlePhotoSelection);
userInterface.submitBatchButton.addEventListener('click', handleBatchSubmission);
userInterface.submissionRetryButton.addEventListener('click', submitPendingBatch);
userInterface.newBatchButton.addEventListener('click', confirmNewBatch);
userInterface.nextBatchButton.addEventListener('click', startWithdrawalBatch);
