// Public frontend configuration. These identifiers do not grant access;
// authorization is enforced by the Apps Script backend for every request.
const APP_CONFIG = Object.freeze({
  GOOGLE_CLIENT_ID:
    '527911330380-g9ts5kq4v519vkndkv5lblj1ksjhl4so.apps.googleusercontent.com',
  BACKEND_URL:
    'https://script.google.com/macros/s/AKfycbxu-xiD4nNE0VxzS5hnZNqlOrWWcqch6op4UGbmuDfhNhoX7Mcj0uY_XLgQloY6S9tI/exec',
  CUSTOMER_BOUND_ROLES: Object.freeze([
    'CUSTOMER_USER',
    'CUSTOMER_ADMIN',
    'RECEIVING_CHECKER'
  ])
});

// These mode definitions provide Thai labels without allowing the browser to
// decide authorization. The backend role remains the source of truth.
const APPLICATION_MODES = Object.freeze({
  receiving: Object.freeze({
    eyebrow: 'ตรวจรับสินค้า',
    title: 'รับเข้าสินค้าฝากขาย',
    description: 'สแกน Serial ของยางที่มาถึงคลังลูกค้า',
    placeholder: 'โมดูลตรวจรับสินค้าจะพัฒนาในขั้นตอนถัดไป'
  }),
  withdrawal: Object.freeze({
    eyebrow: 'เบิกสินค้า',
    title: 'ขอเบิกสินค้าฝากขาย',
    description: 'สแกน Serial และส่งรูปถ่ายเพื่อขอเบิกสินค้า',
    placeholder: 'โมดูลเบิกสินค้าจะพัฒนาในขั้นตอนถัดไป'
  }),
  adminAccounts: Object.freeze({
    eyebrow: 'ผู้ดูแลระบบ',
    title: 'จัดการบัญชีผู้ใช้งาน',
    description: 'เพิ่มบัญชี กำหนดบทบาท และเปิดหรือปิดสิทธิ์'
  })
});

const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: Object.freeze(['adminAccounts']),
  RECEIVING_CHECKER: Object.freeze(['receiving']),
  CUSTOMER_ADMIN: Object.freeze(['withdrawal']),
  CUSTOMER_USER: Object.freeze(['withdrawal'])
});

const ROLE_LABELS = Object.freeze({
  ADMIN: 'ผู้ดูแลระบบ',
  RECEIVING_CHECKER: 'ผู้ตรวจรับสินค้า',
  CUSTOMER_ADMIN: 'ผู้ดูแลฝั่งลูกค้า',
  CUSTOMER_USER: 'ผู้เบิกสินค้า'
});

// Return an element by ID using a descriptive helper name.
function getElementById(elementId) {
  return document.getElementById(elementId);
}

// Keep all DOM references together so event handlers use a clear interface.
const userInterface = {
  authenticationCard: getElementById('authCard'),
  googleSignInButton: getElementById('googleSignInButton'),
  authenticationStatus: getElementById('authStatus'),
  authenticatedUser: getElementById('authenticatedUser'),
  pageDescription: getElementById('pageDescription'),
  homeCard: getElementById('homeCard'),
  modeGrid: getElementById('modeGrid'),
  modulePlaceholder: getElementById('modulePlaceholder'),
  placeholderBackButton: getElementById('placeholderBackButton'),
  placeholderEyebrow: getElementById('placeholderEyebrow'),
  placeholderTitle: getElementById('placeholderTitle'),
  placeholderMessage: getElementById('placeholderMessage'),
  adminAccountSection: getElementById('adminAccountSection'),
  adminBackButton: getElementById('adminBackButton'),
  adminAccountForm: getElementById('adminAccountForm'),
  accountEmail: getElementById('accountEmail'),
  accountRole: getElementById('accountRole'),
  customerSelector: getElementById('customerSelector'),
  customerSearch: getElementById('customerSearch'),
  customerSearchResults: getElementById('customerSearchResults'),
  selectedCustomer: getElementById('selectedCustomer'),
  createAccountButton: getElementById('createAccountButton'),
  adminFormStatus: getElementById('adminFormStatus'),
  refreshUsersButton: getElementById('refreshUsersButton'),
  userListStatus: getElementById('userListStatus'),
  authorizedUserList: getElementById('authorizedUserList')
};

// Authentication and form state stay in memory and are never persisted to
// localStorage. A page refresh therefore requires a fresh Google credential.
let currentIdToken = '';
let currentUser = null;
let selectedCustomer = null;
let customerSearchTimer = null;
let latestCustomerSearchId = 0;

function setAuthenticationStatus(message) {
  userInterface.authenticationStatus.textContent = message;
}

function setFormStatus(message, statusType = '') {
  userInterface.adminFormStatus.textContent = message;
  userInterface.adminFormStatus.className = 'form-status';

  if (statusType) {
    userInterface.adminFormStatus.classList.add(`is-${statusType}`);
  }
}

// Initialize the Google button after Identity Services has loaded.
function initializeGoogleSignIn() {
  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    setAuthenticationStatus(
      'ไม่สามารถโหลด Google Sign-In ได้ กรุณารีเฟรชหน้าแล้วลองใหม่'
    );
    return;
  }

  window.google.accounts.id.initialize({
    client_id: APP_CONFIG.GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential
  });

  window.google.accounts.id.renderButton(userInterface.googleSignInButton, {
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    width: 280,
    locale: 'th'
  });
}

// Send one authenticated request to Apps Script. text/plain avoids an OPTIONS
// preflight that Apps Script web apps do not handle like a typical REST API.
async function sendBackendRequest(action, requestData = {}) {
  if (!currentIdToken) {
    throw new Error('เซสชันหมดอายุ กรุณารีเฟรชหน้าและลงชื่อเข้าใช้อีกครั้ง');
  }

  const response = await fetch(APP_CONFIG.BACKEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: JSON.stringify({
      ...requestData,
      action,
      idToken: currentIdToken
    })
  });

  if (!response.ok) {
    throw new Error(`ระบบตอบกลับด้วยสถานะ ${response.status}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.message || 'ระบบไม่สามารถดำเนินการได้');
  }

  return result;
}

// Authenticate first, then retain the credential only for this browser tab so
// later ADMIN operations can be verified by the backend.
async function handleGoogleCredential(credentialResponse) {
  const idToken = credentialResponse && credentialResponse.credential;

  if (!idToken) {
    setAuthenticationStatus('Google Sign-In ไม่ได้ส่งข้อมูลยืนยันตัวตนกลับมา');
    return;
  }

  currentIdToken = idToken;
  setAuthenticationStatus('กำลังตรวจสอบสิทธิ์...');

  try {
    const result = await sendBackendRequest('authCheck');
    showAuthenticatedApplication(result.user);
  } catch (error) {
    console.error('Authentication request failed:', error);
    currentIdToken = '';
    setAuthenticationStatus(error.message || 'ไม่สามารถลงชื่อเข้าใช้ได้');
  }
}

// Reveal only the application modes returned by the role-to-permission map.
function showAuthenticatedApplication(user) {
  currentUser = user;
  userInterface.authenticationCard.classList.add('hidden');
  userInterface.authenticatedUser.textContent = user.email;
  userInterface.authenticatedUser.classList.remove('hidden');
  userInterface.pageDescription.textContent =
    ROLE_LABELS[user.role] || 'ผู้ใช้งานระบบ';

  renderModeCards();
  showHomeScreen();
}

// Create mode cards with DOM methods so no dynamic value is inserted as HTML.
function renderModeCards() {
  const allowedModes = ROLE_PERMISSIONS[currentUser.role] || [];
  userInterface.modeGrid.replaceChildren();

  allowedModes.forEach((modeKey) => {
    const mode = APPLICATION_MODES[modeKey];
    const button = document.createElement('button');
    const eyebrow = document.createElement('span');
    const title = document.createElement('strong');
    const description = document.createElement('span');
    const arrow = document.createElement('span');

    button.type = 'button';
    button.className = 'mode-card';
    button.dataset.mode = modeKey;

    eyebrow.className = 'mode-eyebrow';
    eyebrow.textContent = mode.eyebrow;
    title.textContent = mode.title;
    description.className = 'mode-description';
    description.textContent = mode.description;
    arrow.className = 'mode-arrow';
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');

    button.append(eyebrow, title, description, arrow);
    button.addEventListener('click', () => openMode(modeKey));
    userInterface.modeGrid.append(button);
  });

  if (allowedModes.length === 0) {
    const unavailableMessage = document.createElement('p');
    unavailableMessage.className = 'empty-state';
    unavailableMessage.textContent = 'บัญชีนี้ยังไม่มีเมนูที่สามารถใช้งานได้';
    userInterface.modeGrid.append(unavailableMessage);
  }
}

function hideApplicationSections() {
  userInterface.homeCard.classList.add('hidden');
  userInterface.modulePlaceholder.classList.add('hidden');
  userInterface.adminAccountSection.classList.add('hidden');
}

function showHomeScreen() {
  hideApplicationSections();
  userInterface.homeCard.classList.remove('hidden');
}

function openMode(modeKey) {
  const allowedModes = ROLE_PERMISSIONS[currentUser.role] || [];

  if (!allowedModes.includes(modeKey)) {
    return;
  }

  if (modeKey === 'adminAccounts') {
    showAdminAccountManager();
    return;
  }

  showModulePlaceholder(modeKey);
}

function showModulePlaceholder(modeKey) {
  const mode = APPLICATION_MODES[modeKey];

  hideApplicationSections();
  userInterface.placeholderEyebrow.textContent = mode.eyebrow;
  userInterface.placeholderTitle.textContent = mode.title;
  userInterface.placeholderMessage.textContent = mode.placeholder;
  userInterface.modulePlaceholder.classList.remove('hidden');
}

async function showAdminAccountManager() {
  hideApplicationSections();
  userInterface.adminAccountSection.classList.remove('hidden');
  updateCustomerSelectorVisibility();
  await loadAuthorizedUsers();
}

// Customer selection is mandatory for operational roles, but a system ADMIN
// is intentionally not tied to a customer record.
function updateCustomerSelectorVisibility() {
  const customerRequired = APP_CONFIG.CUSTOMER_BOUND_ROLES.includes(
    userInterface.accountRole.value
  );

  userInterface.customerSelector.classList.toggle('hidden', !customerRequired);

  if (!customerRequired) {
    clearSelectedCustomer();
  }
}

function clearSelectedCustomer() {
  selectedCustomer = null;
  userInterface.customerSearch.value = '';
  userInterface.selectedCustomer.textContent = '';
  userInterface.selectedCustomer.classList.add('hidden');
  userInterface.customerSearchResults.replaceChildren();
  userInterface.customerSearchResults.classList.add('hidden');
}

// Delay customer searches briefly so normal typing does not create a backend
// request for every keystroke.
function handleCustomerSearchInput() {
  const query = userInterface.customerSearch.value.trim();

  selectedCustomer = null;
  userInterface.selectedCustomer.classList.add('hidden');
  window.clearTimeout(customerSearchTimer);

  if (query.length < 2) {
    userInterface.customerSearchResults.replaceChildren();
    userInterface.customerSearchResults.classList.add('hidden');
    return;
  }

  customerSearchTimer = window.setTimeout(() => {
    searchCustomers(query);
  }, 350);
}

async function searchCustomers(query) {
  const searchId = latestCustomerSearchId + 1;
  latestCustomerSearchId = searchId;
  showCustomerSearchMessage('กำลังค้นหา...');

  try {
    const result = await sendBackendRequest('adminSearchCustomers', { query });

    // Ignore a slow response when the user has already started another search.
    if (searchId !== latestCustomerSearchId) {
      return;
    }

    renderCustomerSearchResults(result.customers || []);
  } catch (error) {
    if (searchId === latestCustomerSearchId) {
      showCustomerSearchMessage(error.message);
    }
  }
}

function showCustomerSearchMessage(message) {
  const status = document.createElement('p');
  status.className = 'search-message';
  status.textContent = message;
  userInterface.customerSearchResults.replaceChildren(status);
  userInterface.customerSearchResults.classList.remove('hidden');
}

function renderCustomerSearchResults(customers) {
  userInterface.customerSearchResults.replaceChildren();

  if (customers.length === 0) {
    showCustomerSearchMessage('ไม่พบลูกค้าที่ตรงกับคำค้นหา');
    return;
  }

  customers.forEach((customer) => {
    const option = document.createElement('button');
    const customerName = document.createElement('strong');
    const customerId = document.createElement('span');

    option.type = 'button';
    option.className = 'search-result-option';
    option.setAttribute('role', 'option');
    customerName.textContent = customer.customer_name || 'ไม่ระบุชื่อลูกค้า';
    customerId.textContent = customer.customer_id;
    option.append(customerName, customerId);
    option.addEventListener('click', () => selectCustomer(customer));
    userInterface.customerSearchResults.append(option);
  });

  userInterface.customerSearchResults.classList.remove('hidden');
}

function selectCustomer(customer) {
  selectedCustomer = customer;
  userInterface.customerSearch.value = '';
  userInterface.customerSearchResults.replaceChildren();
  userInterface.customerSearchResults.classList.add('hidden');
  userInterface.selectedCustomer.textContent =
    `${customer.customer_id} — ${customer.customer_name}`;
  userInterface.selectedCustomer.classList.remove('hidden');
}

async function handleAdminAccountSubmit(event) {
  event.preventDefault();

  const email = userInterface.accountEmail.value.trim();
  const role = userInterface.accountRole.value;
  const customerRequired = APP_CONFIG.CUSTOMER_BOUND_ROLES.includes(role);

  if (!userInterface.accountEmail.validity.valid) {
    setFormStatus('กรุณากรอกอีเมลให้ถูกต้อง', 'error');
    userInterface.accountEmail.focus();
    return;
  }

  if (customerRequired && !selectedCustomer) {
    setFormStatus('กรุณาค้นหาและเลือกลูกค้าจากรายการ', 'error');
    userInterface.customerSearch.focus();
    return;
  }

  setAdminFormLoading(true);
  setFormStatus('กำลังเพิ่มบัญชี...');

  try {
    const result = await sendBackendRequest('adminCreateUser', {
      user: {
        email,
        role,
        customerId: selectedCustomer ? selectedCustomer.customer_id : ''
      }
    });

    setFormStatus(result.message, 'success');
    resetAdminAccountForm();
    await loadAuthorizedUsers();
  } catch (error) {
    setFormStatus(error.message, 'error');
  } finally {
    setAdminFormLoading(false);
  }
}

function setAdminFormLoading(isLoading) {
  userInterface.createAccountButton.disabled = isLoading;
  userInterface.createAccountButton.textContent = isLoading
    ? 'กำลังบันทึก...'
    : 'เพิ่มบัญชี';
}

function resetAdminAccountForm() {
  userInterface.adminAccountForm.reset();
  clearSelectedCustomer();
  updateCustomerSelectorVisibility();
}

async function loadAuthorizedUsers() {
  userInterface.refreshUsersButton.disabled = true;
  userInterface.userListStatus.textContent = 'กำลังโหลดบัญชี...';

  try {
    const result = await sendBackendRequest('adminListUsers');
    renderAuthorizedUsers(result.users || []);
    userInterface.userListStatus.textContent =
      `ทั้งหมด ${result.users.length} บัญชี`;
  } catch (error) {
    userInterface.authorizedUserList.replaceChildren();
    userInterface.userListStatus.textContent = error.message;
  } finally {
    userInterface.refreshUsersButton.disabled = false;
  }
}

function renderAuthorizedUsers(users) {
  userInterface.authorizedUserList.replaceChildren();

  if (users.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'empty-state';
    emptyMessage.textContent = 'ยังไม่มีบัญชีในระบบ';
    userInterface.authorizedUserList.append(emptyMessage);
    return;
  }

  users.forEach((user) => {
    userInterface.authorizedUserList.append(createAuthorizedUserCard(user));
  });
}

function createAuthorizedUserCard(user) {
  const card = document.createElement('article');
  const information = document.createElement('div');
  const email = document.createElement('strong');
  const metadata = document.createElement('p');
  const customer = document.createElement('p');
  const actionButton = document.createElement('button');
  const roleLabel = ROLE_LABELS[user.role] || user.role;

  card.className = `account-item ${user.is_active ? '' : 'is-inactive'}`.trim();
  information.className = 'account-information';
  email.textContent = user.email;
  metadata.className = 'account-metadata';
  metadata.textContent = `${roleLabel} · ${user.is_active ? 'ใช้งานอยู่' : 'ปิดสิทธิ์'}`;
  customer.className = 'account-customer';
  customer.textContent = user.customer_id
    ? `${user.customer_id} — ${user.customer_name || 'ไม่พบชื่อลูกค้า'}`
    : 'ไม่ผูกกับลูกค้า';

  actionButton.type = 'button';
  actionButton.className = user.is_active
    ? 'danger-outline-button'
    : 'success-outline-button';
  actionButton.textContent = user.is_active ? 'ปิดสิทธิ์' : 'เปิดสิทธิ์';
  actionButton.disabled = user.user_id === currentUser.user_id;
  actionButton.title = actionButton.disabled
    ? 'ไม่สามารถปิดสิทธิ์บัญชีที่กำลังใช้งานอยู่'
    : '';
  actionButton.addEventListener('click', () => {
    confirmAndSetUserActive(user, !user.is_active);
  });

  information.append(email, metadata, customer);
  card.append(information, actionButton);
  return card;
}

async function confirmAndSetUserActive(user, nextIsActive) {
  const actionLabel = nextIsActive ? 'เปิดสิทธิ์' : 'ปิดสิทธิ์';
  const confirmed = window.confirm(
    `ยืนยันการ${actionLabel}บัญชี ${user.email} หรือไม่?`
  );

  if (!confirmed) {
    return;
  }

  userInterface.userListStatus.textContent = `กำลัง${actionLabel}บัญชี...`;

  try {
    const result = await sendBackendRequest('adminSetUserActive', {
      userId: user.user_id,
      isActive: nextIsActive
    });

    userInterface.userListStatus.textContent = result.message;
    await loadAuthorizedUsers();
  } catch (error) {
    userInterface.userListStatus.textContent = error.message;
  }
}

// Register event handlers after the page markup is available.
window.addEventListener('load', initializeGoogleSignIn);
userInterface.placeholderBackButton.addEventListener('click', showHomeScreen);
userInterface.adminBackButton.addEventListener('click', showHomeScreen);
userInterface.accountRole.addEventListener(
  'change',
  updateCustomerSelectorVisibility
);
userInterface.customerSearch.addEventListener(
  'input',
  handleCustomerSearchInput
);
userInterface.adminAccountForm.addEventListener(
  'submit',
  handleAdminAccountSubmit
);
userInterface.refreshUsersButton.addEventListener('click', loadAuthorizedUsers);
