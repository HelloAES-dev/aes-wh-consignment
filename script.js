const $ = (id) => document.getElementById(id);

const ui = {
  ordCard: $('ordCard'),
  scanCard: $('scanCard'),
  listCard: $('listCard'),
  ord: $('ord'),
  ordValue: $('ordValue'),
  lot: $('lot'),
  serial: $('serial'),
  scanState: $('scanState'),
  scanHint: $('scanHint'),
  count: $('count'),
  empty: $('empty'),
  list: $('list'),
  start: $('start'),
  add: $('add'),
  clear: $('clear'),
  newOrd: $('newOrd'),
};

let activeOrd = '';
let scannedItems = [];

function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

function renderItems() {
  const count = scannedItems.length;
  ui.count.textContent = `${count} item${count === 1 ? '' : 's'}`;
  ui.empty.classList.toggle('hidden', count > 0);
  ui.list.innerHTML = scannedItems.map((item, index) => `
    <li><span class="scan-number">${index + 1}</span>
      <div class="scan-values">
        <span><strong>LOT</strong>${escapeHtml(item.lot)}</span>
        <span><strong>SERIAL</strong>${escapeHtml(item.serial)}</span>
      </div>
    </li>`).join('');
}

function readyForLot() {
  ui.serial.disabled = true;
  ui.lot.classList.add('next-field');
  ui.serial.classList.remove('next-field');
  ui.scanState.textContent = 'Ready for lot barcode';
}

function startOrder() {
  const ord = ui.ord.value.trim();
  if (!ord) return ui.ord.focus();
  activeOrd = ord;
  scannedItems = [];
  ui.ordValue.textContent = activeOrd;
  ui.ordCard.classList.add('hidden');
  ui.scanCard.classList.remove('hidden');
  ui.listCard.classList.remove('hidden');
  readyForLot();
  ui.lot.focus();
  renderItems();
}

function updateLotState() {
  const hasLot = Boolean(ui.lot.value.trim());
  ui.serial.disabled = !hasLot;
  ui.lot.classList.toggle('next-field', !hasLot);
  ui.serial.classList.toggle('next-field', hasLot);
  ui.scanState.textContent = hasLot ? 'Lot captured — scan serial barcode' : 'Ready for lot barcode';
}

function saveItem() {
  const lot = ui.lot.value.trim();
  const serial = ui.serial.value.trim();
  if (!lot) return ui.lot.focus();
  if (!serial) return ui.serial.focus();
  scannedItems.unshift({ lot, serial });
  ui.lot.value = '';
  ui.serial.value = '';
  ui.scanHint.textContent = 'Saved. Scan the next lot barcode.';
  readyForLot();
  ui.lot.focus();
  renderItems();
}

function clearFields() {
  ui.lot.value = '';
  ui.serial.value = '';
  readyForLot();
  ui.lot.focus();
}

function finishOrder() {
  activeOrd = '';
  scannedItems = [];
  ui.ord.value = '';
  ui.lot.value = '';
  ui.serial.value = '';
  ui.scanCard.classList.add('hidden');
  ui.listCard.classList.add('hidden');
  ui.ordCard.classList.remove('hidden');
  ui.ord.focus();
}

ui.start.addEventListener('click', startOrder);
ui.ord.addEventListener('keydown', (event) => { if (event.key === 'Enter') startOrder(); });
ui.lot.addEventListener('input', updateLotState);
ui.lot.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && ui.lot.value.trim()) { event.preventDefault(); ui.serial.focus(); }
});
ui.serial.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); saveItem(); }
});
ui.add.addEventListener('click', saveItem);
ui.clear.addEventListener('click', clearFields);
ui.newOrd.addEventListener('click', finishOrder);
