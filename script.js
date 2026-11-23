// These mode definitions provide Thai labels without allowing the browser to
// decide authorization. Backend permission checks remain authoritative.
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
    description: 'เพิ่มบัญชี กำหนดสิทธิ์ และเปิดหรือปิดการใช้งาน'
  })
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
  accountFormTitle: getElementById('accountFormTitle'),
  accountFormDescription: getElementById('accountFormDescription'),
  accountEmail: getElementById('accountEmail'),
  permissionWithdraw: getElementById('permissionWithdraw'),
  permissionReceive: getElementById('permissionReceive'),
  permissionAdmin: getElementById('permissionAdmin'),
  customerSelector: getElementById('customerSelector'),
  customerSearch: getElementById('customerSearch'),
  customerSearchResults: getElementById('customerSearchResults'),
  selectedCustomer: getElementById('selectedCustomer'),
  cancelAccountEditButton: getElementById('cancelAccountEditButton'),
  createAccountButton: getElementById('createAccountButton'),
  adminFormStatus: getElementById('adminFormStatus'),
  refreshUsersButton: getElementById('refreshUsersButton'),
  userListStatus: getElementById('userListStatus'),
  authorizedUserList: getElementById('authorizedUserList')
};

// Authentication and form state stay in memory. The short-lived token is also
// copied to sessionStorage so an authorized user can open an operational page
// in the same browser tab without placing credentials in a URL.
let currentIdToken = '';
let currentUser = null;
let selectedCustomer = null;
let editingUserId = '';
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

// Reveal only the application modes allowed by backend-provided permissions.
function showAuthenticatedApplication(user) {
  currentUser = {
    ...user,
    permissions: getNormalizedUserPermissions(user)
  };
  window.authenticationSession.save(currentIdToken, currentUser);
  userInterface.authenticationCard.classList.add('hidden');
  userInterface.authenticatedUser.textContent = currentUser.email;
  userInterface.authenticatedUser.classList.remove('hidden');
  userInterface.pageDescription.textContent = getPermissionSummary(
    currentUser.permissions
  );

  renderModeCards();
  showHomeScreen();
}

// Create mode cards with DOM methods so no dynamic value is inserted as HTML.
function renderModeCards() {
  const allowedModes = getAllowedModes(currentUser.permissions);
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
  const allowedModes = getAllowedModes(currentUser.permissions);

  if (!allowedModes.includes(modeKey)) {
    return;
  }

  if (modeKey === 'adminAccounts') {
    showAdminAccountManager();
    return;
  }

  if (modeKey === 'receiving') {
    window.location.assign('pages/receiving/');
    return;
  }

  showModulePlaceholder(modeKey);
}

// Restore a same-tab session when returning from an operational page. The
// backend revalidates the token before any application mode is displayed.
async function initializeApplication() {
  const storedSession = window.authenticationSession.read();

  if (!storedSession) {
    initializeGoogleSignIn();
    return;
  }

  currentIdToken = storedSession.idToken;
  setAuthenticationStatus('กำลังตรวจสอบเซสชัน...');

  try {
    const result = await sendBackendRequest('authCheck');
    showAuthenticatedApplication(result.user);
  } catch (error) {
    console.error('Stored authentication session failed:', error);
    currentIdToken = '';
    window.authenticationSession.clear();
    setAuthenticationStatus('กรุณาลงชื่อเข้าใช้อีกครั้ง');
    initializeGoogleSignIn();
  }
}

function getAllowedModes(permissions = {}) {
  const allowedModes = [];

  if (permissions.can_receive) {
    allowedModes.push('receiving');
  }

  if (permissions.can_withdraw) {
    allowedModes.push('withdrawal');
  }

  if (permissions.is_admin) {
    allowedModes.push('adminAccounts');
  }

  return allowedModes;
}

function getPermissionSummary(permissions = {}) {
  const labels = [];

  if (permissions.is_admin) {
    labels.push('ผู้ดูแลระบบ');
  }

  if (permissions.can_receive) {
    labels.push('ผู้ตรวจรับสินค้า');
  }

  if (permissions.can_withdraw) {
    labels.push('ผู้เบิกสินค้า');
  }

  return labels.length > 0 ? labels.join(' · ') : 'ผู้ใช้งานระบบ';
}

// Accept the legacy single-role response during the deployment transition so
// the frontend and backend can be updated without an avoidable lockout window.
function getNormalizedUserPermissions(user = {}) {
  if (user.permissions && typeof user.permissions === 'object') {
    return {
      can_withdraw: Boolean(user.permissions.can_withdraw),
      can_receive: Boolean(user.permissions.can_receive),
      is_admin: Boolean(user.permissions.is_admin)
    };
  }

  return {
    can_withdraw: ['CUSTOMER_USER', 'CUSTOMER_ADMIN'].includes(user.role),
    can_receive: user.role === 'RECEIVING_CHECKER',
    is_admin: user.role === 'ADMIN'
  };
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

// Customer selection is mandatory for customer operational permissions. An
// internal ADMIN account is intentionally not tied to a customer record.
function updateCustomerSelectorVisibility() {
  const hasOperationalPermission =
    userInterface.permissionWithdraw.checked ||
    userInterface.permissionReceive.checked;
  const customerRequired =
    hasOperationalPermission && !userInterface.permissionAdmin.checked;

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
  const permissions = getAccountFormPermissions();
  const hasAnyPermission =
    permissions.canWithdraw || permissions.canReceive || permissions.isAdmin;
  const customerRequired =
    (permissions.canWithdraw || permissions.canReceive) &&
    !permissions.isAdmin;

  if (!editingUserId && !userInterface.accountEmail.validity.valid) {
    setFormStatus('กรุณากรอกอีเมลให้ถูกต้อง', 'error');
    userInterface.accountEmail.focus();
    return;
  }

  if (!hasAnyPermission) {
    setFormStatus('กรุณาเลือกสิทธิ์อย่างน้อยหนึ่งรายการ', 'error');
    userInterface.permissionWithdraw.focus();
    return;
  }

  if (customerRequired && !selectedCustomer) {
    setFormStatus('กรุณาค้นหาและเลือกลูกค้าจากรายการ', 'error');
    userInterface.customerSearch.focus();
    return;
  }

  setAdminFormLoading(true);
  setFormStatus(
    editingUserId ? 'กำลังบันทึกการแก้ไข...' : 'กำลังเพิ่มบัญชี...'
  );

  try {
    const userAccess = {
      permissions,
      customerId: selectedCustomer ? selectedCustomer.customer_id : ''
    };
    const result = editingUserId
      ? await sendBackendRequest('adminUpdateUserAccess', {
          userId: editingUserId,
          user: userAccess
        })
      : await sendBackendRequest('adminCreateUser', {
          user: {
            ...userAccess,
            email
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
    : editingUserId
      ? 'บันทึกการแก้ไข'
      : 'เพิ่มบัญชี';
  userInterface.cancelAccountEditButton.disabled = isLoading;
}

function resetAdminAccountForm() {
  editingUserId = '';
  userInterface.adminAccountForm.reset();
  userInterface.accountEmail.disabled = false;
  userInterface.accountFormTitle.textContent = 'เพิ่มบัญชีที่ได้รับสิทธิ์';
  userInterface.accountFormDescription.textContent =
    'เพิ่มอีเมล กำหนดสิทธิ์ และผูกบัญชีกับลูกค้า';
  userInterface.createAccountButton.textContent = 'เพิ่มบัญชี';
  userInterface.cancelAccountEditButton.classList.add('hidden');
  clearSelectedCustomer();
  updateCustomerSelectorVisibility();
}

function getAccountFormPermissions() {
  return {
    canWithdraw: userInterface.permissionWithdraw.checked,
    canReceive: userInterface.permissionReceive.checked,
    isAdmin: userInterface.permissionAdmin.checked
  };
}

// Reuse the account form for editing while keeping the Google email immutable.
function startEditingUserAccess(user) {
  editingUserId = user.user_id;
  setFormStatus('');
  clearSelectedCustomer();

  userInterface.accountFormTitle.textContent = 'แก้ไขสิทธิ์ผู้ใช้งาน';
  userInterface.accountFormDescription.textContent =
    'แก้ไขสิทธิ์และลูกค้าที่ผูกกับบัญชี โดยไม่เปลี่ยนอีเมล';
  userInterface.accountEmail.value = user.email;
  userInterface.accountEmail.disabled = true;
  userInterface.permissionWithdraw.checked =
    Boolean(user.permissions.can_withdraw);
  userInterface.permissionReceive.checked =
    Boolean(user.permissions.can_receive);
  userInterface.permissionAdmin.checked = Boolean(user.permissions.is_admin);
  userInterface.createAccountButton.textContent = 'บันทึกการแก้ไข';
  userInterface.cancelAccountEditButton.classList.remove('hidden');

  updateCustomerSelectorVisibility();

  if (user.customer_id) {
    selectCustomer({
      customer_id: user.customer_id,
      customer_name: user.customer_name || 'ไม่พบชื่อลูกค้า'
    });
  }

  userInterface.adminAccountForm.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
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
    const normalizedUser = {
      ...user,
      permissions: getNormalizedUserPermissions(user)
    };

    userInterface.authorizedUserList.append(
      createAuthorizedUserCard(normalizedUser)
    );
  });
}

function createAuthorizedUserCard(user) {
  const card = document.createElement('article');
  const information = document.createElement('div');
  const email = document.createElement('strong');
  const metadata = document.createElement('p');
  const customer = document.createElement('p');
  const actions = document.createElement('div');
  const editButton = document.createElement('button');
  const activeStatusButton = document.createElement('button');
  const permissionSummary = getPermissionSummary(user.permissions);
  const isCurrentUser = user.user_id === currentUser.user_id;

  card.className = `account-item ${user.is_active ? '' : 'is-inactive'}`.trim();
  information.className = 'account-information';
  email.textContent = user.email;
  metadata.className = 'account-metadata';
  metadata.textContent =
    `${permissionSummary} · ${user.is_active ? 'ใช้งานอยู่' : 'ปิดสิทธิ์'}`;
  customer.className = 'account-customer';
  customer.textContent = user.customer_id
    ? `${user.customer_id} — ${user.customer_name || 'ไม่พบชื่อลูกค้า'}`
    : 'ไม่ผูกกับลูกค้า';

  actions.className = 'account-actions';

  editButton.type = 'button';
  editButton.className = 'outline-button';
  editButton.textContent = 'แก้ไขสิทธิ์';
  editButton.disabled = isCurrentUser;
  editButton.title = isCurrentUser
    ? 'ไม่สามารถแก้ไขสิทธิ์บัญชีที่กำลังใช้งานอยู่'
    : '';
  editButton.addEventListener('click', () => {
    startEditingUserAccess(user);
  });

  activeStatusButton.type = 'button';
  activeStatusButton.className = user.is_active
    ? 'danger-outline-button'
    : 'success-outline-button';
  activeStatusButton.textContent = user.is_active ? 'ปิดสิทธิ์' : 'เปิดสิทธิ์';
  activeStatusButton.disabled = isCurrentUser;
  activeStatusButton.title = activeStatusButton.disabled
    ? 'ไม่สามารถปิดสิทธิ์บัญชีที่กำลังใช้งานอยู่'
    : '';
  activeStatusButton.addEventListener('click', () => {
    confirmAndSetUserActive(user, !user.is_active);
  });

  information.append(email, metadata, customer);
  actions.append(editButton, activeStatusButton);
  card.append(information, actions);
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
window.addEventListener('load', initializeApplication);
userInterface.placeholderBackButton.addEventListener('click', showHomeScreen);
userInterface.adminBackButton.addEventListener('click', showHomeScreen);
userInterface.permissionWithdraw.addEventListener(
  'change',
  updateCustomerSelectorVisibility
);
userInterface.permissionReceive.addEventListener(
  'change',
  updateCustomerSelectorVisibility
);
userInterface.permissionAdmin.addEventListener(
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
userInterface.cancelAccountEditButton.addEventListener(
  'click',
  resetAdminAccountForm
);
userInterface.refreshUsersButton.addEventListener('click', loadAuthorizedUsers);
