// Public frontend configuration. These values identify the application but do
// not grant access; authorization is enforced by the Apps Script backend.
const APP_CONFIG = Object.freeze({
  GOOGLE_CLIENT_ID:
    '527911330380-g9ts5kq4v519vkndkv5lblj1ksjhl4so.apps.googleusercontent.com',
  BACKEND_URL:
    'https://script.google.com/macros/s/AKfycbxu-xiD4nNE0VxzS5hnZNqlOrWWcqch6op4UGbmuDfhNhoX7Mcj0uY_XLgQloY6S9tI/exec'
});

// Return an element by ID using a descriptive helper name.
function getElementById(elementId) {
  return document.getElementById(elementId);
}

// Keep all DOM references together so event handlers can use a clear interface.
const userInterface = {
  authenticationCard: getElementById('authCard'),
  googleSignInButton: getElementById('googleSignInButton'),
  authenticationStatus: getElementById('authStatus'),
  authenticatedUser: getElementById('authenticatedUser'),
  orderCard: getElementById('ordCard'),
  scanCard: getElementById('scanCard'),
  listCard: getElementById('listCard'),
  orderInput: getElementById('ord'),
  orderValue: getElementById('ordValue'),
  lotInput: getElementById('lot'),
  serialInput: getElementById('serial'),
  scanState: getElementById('scanState'),
  scanHint: getElementById('scanHint'),
  itemCount: getElementById('count'),
  emptyMessage: getElementById('empty'),
  itemList: getElementById('list'),
  startButton: getElementById('start'),
  addButton: getElementById('add'),
  clearButton: getElementById('clear'),
  newOrderButton: getElementById('newOrd')
};

// These values represent the current in-browser scanning session.
let activeOrderNumber = '';
let scannedItems = [];

// Display authentication progress and backend rejection messages in one place.
function setAuthenticationStatus(message) {
  userInterface.authenticationStatus.textContent = message;
}

// Initialize the Google button after the external Identity Services script has
// finished loading.
function initializeGoogleSignIn() {
  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    setAuthenticationStatus('Google Sign-In could not load. Refresh and try again.');
    return;
  }

  window.google.accounts.id.initialize({
    client_id: APP_CONFIG.GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential
  });

  window.google.accounts.id.renderButton(userInterface.googleSignInButton, {
    theme: 'outline',
    size: 'large',
    text: 'sign_in_with',
    shape: 'rectangular',
    width: 280
  });
}

// Send the Google ID token to Apps Script so the backend can verify the account
// and look it up in CONFIG : อีเมลที่ได้รับสิทธิ์.
function handleGoogleCredential(credentialResponse) {
  const idToken = credentialResponse && credentialResponse.credential;

  if (!idToken) {
    setAuthenticationStatus('Google Sign-In did not return a valid credential.');
    return;
  }

  setAuthenticationStatus('Checking your account...');

  fetch(APP_CONFIG.BACKEND_URL, {
    method: 'POST',
    // text/plain keeps this cross-origin request simple and avoids an
    // unsupported OPTIONS preflight in the Apps Script web app.
    headers: {
      'Content-Type': 'text/plain'
    },
    body: JSON.stringify({
      action: 'authCheck',
      idToken
    })
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Backend request failed with status ${response.status}.`);
      }

      return response.json();
    })
    .then((result) => {
      if (!result.success || !result.user) {
        throw new Error(result.message || 'This account is not authorized.');
      }

      showAuthenticatedApplication(result.user);
    })
    .catch((error) => {
      console.error('Authentication request failed:', error);
      setAuthenticationStatus(error.message || 'Sign-in could not be completed.');
    });
}

// Reveal the scanner only after the backend confirms the signed-in account.
function showAuthenticatedApplication(user) {
  userInterface.authenticationCard.classList.add('hidden');
  userInterface.orderCard.classList.remove('hidden');
  userInterface.authenticatedUser.textContent = `Signed in as ${user.email}`;
  userInterface.authenticatedUser.classList.remove('hidden');
  userInterface.orderInput.focus();
}

// Escape scanned values before placing them into the rendered item list.
function escapeHtml(value) {
  const temporaryElement = document.createElement('div');
  temporaryElement.textContent = value;
  return temporaryElement.innerHTML;
}

// Render the current scanned items and update the empty-state message.
function renderScannedItems() {
  const itemCount = scannedItems.length;

  userInterface.itemCount.textContent = `${itemCount} item${
    itemCount === 1 ? '' : 's'
  }`;
  userInterface.emptyMessage.classList.toggle('hidden', itemCount > 0);

  userInterface.itemList.innerHTML = scannedItems
    .map(
      (item, index) => `
        <li>
          <span class="scan-number">${index + 1}</span>
          <div class="scan-values">
            <span>
              <strong>LOT</strong>${escapeHtml(item.lot)}
            </span>
            <span>
              <strong>SERIAL</strong>${escapeHtml(item.serial)}
            </span>
          </div>
        </li>`
    )
    .join('');
}

// Reset the scanner state so the next input is a lot number.
function prepareForLotScan() {
  userInterface.serialInput.disabled = true;
  userInterface.lotInput.classList.add('next-field');
  userInterface.serialInput.classList.remove('next-field');
  userInterface.scanState.textContent = 'Ready for lot barcode';
}

// Start a new scanning session after validating the ORD input.
function startOrder() {
  const orderNumber = userInterface.orderInput.value.trim();

  if (!orderNumber) {
    userInterface.orderInput.focus();
    return;
  }

  activeOrderNumber = orderNumber;
  scannedItems = [];

  userInterface.orderValue.textContent = activeOrderNumber;
  userInterface.orderCard.classList.add('hidden');
  userInterface.scanCard.classList.remove('hidden');
  userInterface.listCard.classList.remove('hidden');

  prepareForLotScan();
  userInterface.lotInput.focus();
  renderScannedItems();
}

// Enable serial scanning only after a lot number has been entered.
function updateLotInputState() {
  const hasLotNumber = Boolean(userInterface.lotInput.value.trim());

  userInterface.serialInput.disabled = !hasLotNumber;
  userInterface.lotInput.classList.toggle('next-field', !hasLotNumber);
  userInterface.serialInput.classList.toggle('next-field', hasLotNumber);
  userInterface.scanState.textContent = hasLotNumber
    ? 'Lot captured — scan serial barcode'
    : 'Ready for lot barcode';
}

// Save one lot and serial pair in the current in-browser list.
function saveItem() {
  const lotNumber = userInterface.lotInput.value.trim();
  const serialNumber = userInterface.serialInput.value.trim();

  if (!lotNumber) {
    userInterface.lotInput.focus();
    return;
  }

  if (!serialNumber) {
    userInterface.serialInput.focus();
    return;
  }

  scannedItems.unshift({
    lot: lotNumber,
    serial: serialNumber
  });

  userInterface.lotInput.value = '';
  userInterface.serialInput.value = '';
  userInterface.scanHint.textContent = 'Saved. Scan the next lot barcode.';

  prepareForLotScan();
  userInterface.lotInput.focus();
  renderScannedItems();
}

// Clear the current lot and serial fields without ending the ORD session.
function clearFields() {
  userInterface.lotInput.value = '';
  userInterface.serialInput.value = '';
  prepareForLotScan();
  userInterface.lotInput.focus();
}

// End the current ORD session and return to the initial input screen.
function finishOrder() {
  activeOrderNumber = '';
  scannedItems = [];

  userInterface.orderInput.value = '';
  userInterface.lotInput.value = '';
  userInterface.serialInput.value = '';
  userInterface.scanCard.classList.add('hidden');
  userInterface.listCard.classList.add('hidden');
  userInterface.orderCard.classList.remove('hidden');
  userInterface.orderInput.focus();
}

// Start the scan session when the user clicks the start button.
function handleStartButtonClick() {
  startOrder();
}

// Barcode scanners commonly submit an input by sending the Enter key.
function handleOrderKeydown(event) {
  if (event.key === 'Enter') {
    startOrder();
  }
}

// Move focus to the serial field when a non-empty lot is submitted.
function handleLotKeydown(event) {
  const hasLotNumber = Boolean(userInterface.lotInput.value.trim());

  if (event.key === 'Enter' && hasLotNumber) {
    event.preventDefault();
    userInterface.serialInput.focus();
  }
}

// Save the item when the serial barcode scanner submits the Enter key.
function handleSerialKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveItem();
  }
}

// Register all event handlers after the page markup has loaded.
window.addEventListener('load', initializeGoogleSignIn);
userInterface.startButton.addEventListener('click', handleStartButtonClick);
userInterface.orderInput.addEventListener('keydown', handleOrderKeydown);
userInterface.lotInput.addEventListener('input', updateLotInputState);
userInterface.lotInput.addEventListener('keydown', handleLotKeydown);
userInterface.serialInput.addEventListener('keydown', handleSerialKeydown);
userInterface.addButton.addEventListener('click', saveItem);
userInterface.clearButton.addEventListener('click', clearFields);
userInterface.newOrderButton.addEventListener('click', finishOrder);
