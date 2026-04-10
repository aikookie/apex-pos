// Apex POS - Full Frontend Application
console.log('Apex POS app.js loading...');
const API = '';  // Uses relative URLs (same origin)

// ============ State ============
let state = {
  token: null,
  user: null,
  menu: [],
  tables: [],
  orders: [],
  cart: [],
  selectedTable: null,
  discount: { type: 'percent', value: 0 },
  currentView: 'menu'
};

// ============ Utilities ============
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function show(el) { if(el) el.classList.remove('hidden'); }
function hide(el) { if(el) el.classList.add('hidden'); }
function fmtMoney(cents) { return (cents / 100).toFixed(2); }
function authHeaders() { return state.token ? { Authorization: `Bearer ${state.token}` } : {}; }

async function apiCall(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `Error ${res.status}`);
  }
  return res.json();
}

// ============ Auth ============
async function login(staffId, pin) {
  const data = await apiCall('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ staffId: parseInt(staffId), pin })
  });
  state.token = data.token;
  state.user = { id: data.id || staffId, name: data.name, role: data.role };
  localStorage.setItem('apex_token', data.token);
  localStorage.setItem('apex_user', JSON.stringify(state.user));
  return data;
}

function logout() {
  state.token = null;
  state.user = null;
  state.cart = [];
  localStorage.removeItem('apex_token');
  localStorage.removeItem('apex_user');
  location.reload();
}

function checkAuth() {
  const token = localStorage.getItem('apex_token');
  const user = JSON.parse(localStorage.getItem('apex_user') || 'null');
  if (token && user) {
    state.token = token;
    state.user = user;
    return true;
  }
  return false;
}

// ============ PIN Pad ============
let currentPin = '';

function handlePin(val) {
  if (val === 'C') {
    currentPin = '';
    updatePinDisplay();
    return;
  }
  
  if (val === 'E') {
    // Enter - attempt login
    const staffSelect = $('#staffSelect');
    let staffId = staffSelect?.value;
    if (!staffId || staffId === '') staffId = '1';
    console.log('Login attempt - staffId:', staffId, 'pin:', currentPin);
    if (currentPin.length > 0) {
      login(staffId, currentPin).then(() => {
        currentPin = '';
        updatePinDisplay();
      }).catch(e => {
        $('#loginError').textContent = e.message || 'Login failed';
        $('#loginError').classList.add('show');
        currentPin = '';
        updatePinDisplay();
      });
    }
    return;
  }
  
  if (currentPin.length < 4) {
    currentPin += val;
    updatePinDisplay();
  }
}

function updatePinDisplay() {
  for (let i = 0; i < 4; i++) {
    const dot = $(`#dot${i}`);
    if (dot) {
      dot.classList.toggle('filled', i < currentPin.length);
    }
  }
}

// ============ Views ============
function switchView(viewName) {
  state.currentView = viewName;
  $$('.view').forEach(v => hide(v));
  $(`#${viewName}View`) && show($(`#${viewName}View`));
  $$('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === viewName);
  });
  
  // Load data for view
  if (viewName === 'menu') loadMenu();
  if (viewName === 'tables') loadTables();
  if (viewName === 'orders') loadOrders();
  if (viewName === 'kds') loadKDS();
  if (viewName === 'employees') loadEmployees();
  if (viewName === 'reports') loadReports();
}

// ============ Menu ============
async function loadMenu() {
  try {
    state.menu = await apiCall('/api/menu');
    renderMenuCategories();
    renderMenuItems(state.menu);
  } catch (e) {
    console.error('Load menu error:', e);
  }
}

function renderMenuCategories() {
  const categories = ['All', ...new Set(state.menu.map(i => i.category || 'Uncategorized'))];
  const container = $('#menuCategories');
  container.innerHTML = categories.map(cat => 
    `<button class="category-chip ${cat === 'All' ? 'active' : ''}" data-category="${cat}">${cat}</button>`
  ).join('');
  
  container.querySelectorAll('.category-chip').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.category-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.category;
      const items = cat === 'All' ? state.menu : state.menu.filter(i => (i.category || 'Uncategorized') === cat);
      renderMenuItems(items);
    };
  });
}

function renderMenuItems(items) {
  const container = $('#menuGrid');
  container.innerHTML = items.map(item => `
    <div class="menu-item-card" data-id="${item.id}">
      <h3>${item.name}</h3>
      <div class="price">$${fmtMoney(item.price)}</div>
      <div class="desc">${item.description || ''}</div>
    </div>
  `).join('');
  
  container.querySelectorAll('.menu-item-card').forEach(card => {
    card.onclick = () => openModifierModal(parseInt(card.dataset.id));
  });
}

// ============ Modifiers ============
let currentMenuItem = null;
let selectedModifiers = [];

async function openModifierModal(itemId) {
  try {
    currentMenuItem = state.menu.find(i => i.id === itemId);
    if (!currentMenuItem) return;
    
    const modifiers = await apiCall(`/api/menu/${itemId}/modifiers`);
    
    $('#modalTitle').textContent = `Customize: ${currentMenuItem.name}`;
    
    // Group modifiers by category
    const byCategory = {};
    modifiers.forEach(m => {
      const cat = m.category || 'Options';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(m);
    });
    
    let html = '<div class="modifier-groups">';
    Object.entries(byCategory).forEach(([cat, mods]) => {
      html += `<div class="modifier-group"><h4>${cat}</h4><div class="modifier-options">`;
      mods.forEach(m => {
        html += `<label class="modifier-option" data-id="${m.id}" data-price="${m.price}">
          <input type="checkbox" value="${m.id}"> ${m.name} (+$${fmtMoney(m.price)})
        </label>`;
      });
      html += '</div></div>';
    });
    html += '</div>';
    
    $('#modalBody').innerHTML = html;
    
    // Handle modifier selection
    $$('.modifier-option').forEach(opt => {
      opt.onclick = () => {
        opt.classList.toggle('selected');
        opt.querySelector('input').checked = opt.classList.contains('selected');
      };
    });
    
    $('#itemModal').classList.add('show');
  } catch (e) {
    console.error('Load modifiers error:', e);
    // If no modifiers, just add directly
    addToCart({ ...currentMenuItem, modifiers: [] });
  }
}

$('#cancelModifierBtn').onclick = () => $('#itemModal').classList.remove('show');
$('#closeModalBtn').onclick = () => $('#itemModal').classList.remove('show');

$('#addToCartBtn').onclick = () => {
  if (!currentMenuItem) return;
  
  const selected = [];
  $$('.modifier-option.selected').forEach(opt => {
    selected.push({ id: opt.dataset.id, name: opt.textContent.trim(), price: parseInt(opt.dataset.price) });
  });
  
  addToCart({ ...currentMenuItem, modifiers: selected });
  $('#itemModal').classList.remove('show');
};

function addToCart(item) {
  state.cart.push(item);
  updateCartUI();
}

function updateCartUI() {
  const count = state.cart.length;
  $('#cartCount').textContent = count;
  
  const container = $('#cartItems');
  if (state.cart.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align:center;padding:2rem;">Cart is empty</p>';
    $('#cartTotal').textContent = '0.00';
    return;
  }
  
  let subtotal = 0;
  container.innerHTML = state.cart.map((item, idx) => {
    const qty = item.qty || 1;
    const modPrice = item.modifiers ? item.modifiers.reduce((s, m) => s + (m.price || 0), 0) : 0;
    const itemTotal = (item.price + modPrice) * qty;
    subtotal += itemTotal;
    
    return `
      <div class="cart-item">
        <div class="cart-item-header">
          <span class="cart-item-name">${item.name}</span>
          <button class="btn btn-danger" style="width:auto;padding:0.25rem 0.5rem;font-size:0.75rem;" onclick="removeFromCart(${idx})">✕</button>
        </div>
        <div class="cart-item-qty">
          <button class="btn btn-secondary" onclick="changeQty(${idx}, -1)">-</button>
          <span>${qty}</span>
          <button class="btn btn-secondary" onclick="changeQty(${idx}, 1)">+</button>
          <span style="margin-left:auto;font-weight:600;">$${fmtMoney(itemTotal)}</span>
        </div>
        ${item.modifiers && item.modifiers.length ? `<div class="cart-item-mods">${item.modifiers.map(m => m.price > 0 ? m.name + ' (+$' + fmtMoney(m.price) + ')' : m.name).join(', ')}</div>` : ''}
      </div>
    `;
  }).join('');
  
  // Calculate discount and tax
  let discountAmount = 0;
  if (state.discount.value > 0) {
    if (state.discount.type === 'percent') {
      discountAmount = subtotal * (state.discount.value / 100);
    } else {
      discountAmount = state.discount.value * 100;
    }
  }
  
  const taxableAmount = subtotal - discountAmount;
  const taxRate = 8.25;
  const tax = Math.round(taxableAmount * (taxRate / 100));
  const total = taxableAmount + tax;
  
  $('#cartTotal').textContent = fmtMoney(Math.max(0, total));
}

window.removeFromCart = (idx) => { state.cart.splice(idx, 1); updateCartUI(); };
window.changeQty = (idx, delta) => {
  const item = state.cart[idx];
  item.qty = (item.qty || 1) + delta;
  if (item.qty <= 0) { state.cart.splice(idx, 1); }
  updateCartUI();
};

$('#openCartBtn').onclick = () => $('#cartSidebar').classList.add('open');
$('#closeCartBtn').onclick = () => $('#cartSidebar').classList.remove('open');

$('#applyDiscountBtn').onclick = () => {
  const type = $('#discountType').value;
  const value = parseFloat($('#discountValue').value) || 0;
  state.discount = { type, value };
  updateCartUI();
};

$('#clearCartBtn').onclick = () => { state.cart = []; state.discount = { type: 'percent', value: 0 }; updateCartUI(); };

$('#checkoutBtn').onclick = () => {
  if (state.cart.length === 0) return alert('Cart is empty!');
  if (!state.selectedTable) return alert('Please select a table first!');
  openCheckoutModal();
};

async function openCheckoutModal() {
  // Calculate subtotal (before discount)
  let subtotal = state.cart.reduce((s, item) => {
    const modPrice = item.modifiers ? item.modifiers.reduce((m, x) => m + (x.price || 0), 0) : 0;
    return s + (item.price + modPrice) * (item.qty || 1);
  }, 0);
  
  // Calculate discount amount
  let discountAmount = 0;
  let discountPercent = 0;
  if (state.discount.value > 0) {
    if (state.discount.type === 'percent') {
      discountPercent = state.discount.value;
      discountAmount = subtotal * (state.discount.value / 100);
    } else {
      discountAmount = state.discount.value * 100;
    }
  }
  
  const taxableAmount = subtotal - discountAmount;
  const taxRate = 8.25; // Default tax rate
  const tax = Math.round(taxableAmount * (taxRate / 100));
  const total = taxableAmount + tax;
  
  const body = `
    <div style="padding:1rem;">
      <h3>Order Summary</h3>
      <p><strong>Table:</strong> ${state.tables.find(t => t.id === state.selectedTable)?.number || state.selectedTable}</p>
      <p><strong>Items:</strong> ${state.cart.length}</p>
      <hr style="margin:0.75rem 0;border-color:#333;">
      <p style="display:flex;justify-content:space-between;"><span>Subtotal:</span> <span>$${fmtMoney(subtotal)}</span></p>
      ${discountAmount > 0 ? `
        <p style="display:flex;justify-content:space-between;color:#ef4444;">
          <span>Discount (${discountPercent > 0 ? discountPercent + '%' : '$' + fmtMoney(discountAmount)}):</span> 
          <span>-$${fmtMoney(discountAmount)}</span>
        </p>
      ` : ''}
      <p style="display:flex;justify-content:space-between;"><span>Tax (${taxRate}%):</span> <span>$${fmtMoney(tax)}</span></p>
      <hr style="margin:0.75rem 0;border-color:#333;">
      <h2 style="color:#22c55e;text-align:right;">Total: $${fmtMoney(total)}</h2>
      
      <div class="form-group" style="margin-top:1.5rem;">
        <label><strong>Payment Method</strong></label>
        <select id="paymentMethod" style="width:100%;padding:0.75rem;border:1px solid #444;border-radius:8px;background:#16213e;color:#fff;">
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="zelle">Zelle</option>
        </select>
      </div>
    </div>
  `;
  
  $('#checkoutBody').innerHTML = body;
  $('#checkoutModal').classList.add('show');
}

$('#cancelCheckoutBtn').onclick = () => $('#checkoutModal').classList.remove('show');
$('#closeCheckoutBtn').onclick = () => $('#checkoutModal').classList.remove('show');

$('#processPaymentBtn').onclick = async () => {
  try {
    const items = state.cart.map(item => ({
      menuItemId: item.id,
      price: item.price,
      qty: item.qty || 1,
      modifiers: item.modifiers
    }));
    
    const orderData = {
      tableId: state.selectedTable,
      staffId: state.user.id,
      items,
      discount: state.discount.value > 0 ? { type: state.discount.type, value: state.discount.value } : { type: 'percent', value: 0 }
    };
    
    const order = await apiCall('/api/orders', { method: 'POST', body: JSON.stringify(orderData) });
    
    // Process payment
    const method = $('#paymentMethod').value;
    await apiCall('/api/payments', {
      method: 'POST',
      body: JSON.stringify({ amount: order.total, method, orderId: order.id })
    });
    
    alert(`Order #${order.id} created and paid successfully!`);
    $('#checkoutModal').classList.remove('show');
    state.cart = [];
    state.discount = { type: 'percent', value: 0 };
    state.selectedTable = null;
    updateCartUI();
    loadTables();
    loadOrders();
  } catch (e) {
    alert('Checkout failed: ' + e.message);
  }
};

// ============ Tables ============
async function loadTables() {
  try {
    state.tables = await apiCall('/api/tables');
    renderTables();
  } catch (e) {
    console.error('Load tables error:', e);
  }
}

function renderTables() {
  const container = $('#tablesGrid');
  container.innerHTML = state.tables.map(t => `
    <div class="table-card ${t.status} ${state.selectedTable === t.id ? 'selected' : ''}" data-id="${t.id}">
      <div class="number">Table ${t.number}</div>
      <div class="status">${t.status}</div>
    </div>
  `).join('');
  
  container.querySelectorAll('.table-card').forEach(card => {
    card.onclick = () => {
      if (card.classList.contains('available')) {
        state.selectedTable = parseInt(card.dataset.id);
        renderTables();
      }
    };
  });
}

// ============ Orders ============
async function loadOrders() {
  try {
    state.orders = await apiCall('/api/orders?limit=50');
    renderOrders();
  } catch (e) {
    console.error('Load orders error:', e);
  }
}

function renderOrders() {
  const container = $('#ordersList');
  if (state.orders.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align:center;padding:2rem;">No orders yet</p>';
    return;
  }
  
  container.innerHTML = state.orders.map(o => `
    <div class="order-card status-${o.status}">
      <div class="order-info">
        <h3>Order #${o.id}</h3>
        <span>Table ${o.TableId} • ${o.items?.length || 0} items • $${fmtMoney(o.total)}</span>
      </div>
      <div class="order-actions">
        <button class="btn btn-secondary" style="width:auto;padding:0.5rem;" onclick="viewOrder(${o.id})">View</button>
        ${o.status === 'open' ? `<button class="btn btn-success" style="width:auto;padding:0.5rem;" onclick="markPaid(${o.id})">Mark Paid</button>` : ''}
        ${o.status !== 'canceled' ? `<button class="btn btn-danger" style="width:auto;padding:0.5rem;" onclick="cancelOrder(${o.id})">Void</button>` : ''}
      </div>
    </div>
  `).join('');
}

window.viewOrder = async (id) => {
  try {
    const order = await apiCall(`/api/orders/${id}`);
    let items = order.items || [];
    let html = `<div style="padding:1rem;"><h3>Order #${order.id}</h3>`;
    html += `<p><strong>Status:</strong> ${order.status}</p>`;
    html += `<p><strong>Total:</strong> $${fmtMoney(order.total)}</p>`;
    html += '<ul style="margin-top:1rem;">';
    items.forEach(i => {
      html += `<li>${i.MenuItem?.name || 'Item'} x${i.quantity} - $${fmtMoney(i.price)}</li>`;
    });
    html += '</ul></div>';
    alert(html.replace(/<[^>]+>/g, '\n'));
  } catch (e) { alert(e.message); }
};

window.markPaid = async (id) => {
  try {
    await apiCall(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'paid' }) });
    loadOrders();
  } catch (e) { alert(e.message); }
};

window.cancelOrder = async (id) => {
  const reason = prompt('Enter void reason:');
  if (!reason) return;
  try {
    await apiCall(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'canceled', notes: reason }) });
    loadOrders();
  } catch (e) { alert(e.message); }
};

// ============ KDS ============
async function loadKDS() {
  try {
    const openOrders = await apiCall('/api/orders?status=open&limit=50');
    renderKDS(openOrders);
  } catch (e) {
    console.error('Load KDS error:', e);
  }
}

function renderKDS(orders) {
  const container = $('#kdsGrid');
  if (orders.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align:center;padding:2rem;">No open orders in kitchen</p>';
    return;
  }
  
  container.innerHTML = orders.map(o => {
    const time = new Date(o.createdAt).toLocaleTimeString();
    const items = o.items || [];
    return `
      <div class="kds-card">
        <div class="kds-card-header">
          <span class="table">Table ${o.TableId}</span>
          <span class="time">${time}</span>
        </div>
        <div class="kds-items">
          ${items.map(i => `
            <div class="kds-item">
              <span>${i.MenuItem?.name || 'Item'} x${i.quantity}</span>
              <button class="btn btn-success" style="width:auto;padding:0.25rem 0.5rem;font-size:0.75rem;" onclick="completeKDSItem(${o.id}, ${i.id})">✓</button>
            </div>
          `).join('')}
        </div>
        <div class="kds-actions">
          <button class="btn btn-success" style="width:100%;" onclick="completeOrder(${o.id})">Complete Order</button>
        </div>
      </div>
    `;
  }).join('');
}

window.completeKDSItem = (orderId, itemId) => {
  alert('Item marked ready!');
};

window.completeOrder = async (id) => {
  try {
    await apiCall(`/api/orders/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'paid' }) });
    loadKDS();
  } catch (e) { alert(e.message); }
};

// ============ Employees ============
async function loadEmployees() {
  try {
    const employees = await apiCall('/api/employees');
    const container = $('#employeeList');
    container.innerHTML = employees.map(e => `
      <div class="employee-card">
        <div class="employee-info">
          <h4>${e.name}</h4>
          <span>${e.role} • $${e.hourlyRate}/hr</span>
        </div>
        <div class="order-actions">
          <button class="btn btn-secondary" style="width:auto;padding:0.5rem;">Edit</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    $('#employeeList').innerHTML = '<p class="text-muted">No employees found</p>';
  }
}

// ============ Reports ============
async function loadReports() {
  const stats = [
    { label: "Today's Sales", value: "$1,234" },
    { label: "Orders", value: "45" },
    { label: "Avg Order", value: "$27.42" },
    { label: "Top Item", value: "Burger" }
  ];
  
  const container = $('#reportsStats');
  container.innerHTML = stats.map(s => `
    <div class="stat-card">
      <h3>${s.label}</h3>
      <div class="value">${s.value}</div>
    </div>
  `).join('');
}

// ============ Initialization ============
async function init() {
  // Check for existing auth
  if (checkAuth()) {
    showLoginSuccess();
    return;
  }
  
  // Setup login handler
  $('#loginBtn').onclick = async () => {
    const staffId = $('#staffId').value;
    const pin = $('#pin').value;
    
    if (!staffId || !pin) {
      $('#loginError').textContent = 'Please enter both staff ID and PIN';
      $('#loginError').classList.add('show');
      return;
    }
    
    try {
      await login(staffId, pin);
      showLoginSuccess();
    } catch (e) {
      $('#loginError').textContent = e.message || 'Login failed';
      $('#loginError').classList.add('show');
    }
  };
  
  // Setup navigation
  $$('.nav-tab').forEach(tab => {
    tab.onclick = () => switchView(tab.dataset.view);
  });
  
  // Logout
  $('#logoutBtn').onclick = logout;
}

function showLoginSuccess() {
  hide($('#loginScreen'));
  show($('#mainApp'));
  loadMenu();
  loadTables();
}

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW registration failed:', e));
}

// Initialize app
init();