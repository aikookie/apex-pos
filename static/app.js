// Apex POS - Full Frontend Application
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
  tip: 0,
  tipPercent: null,
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
  
  let total = 0;
  container.innerHTML = state.cart.map((item, idx) => {
    const modPrice = item.modifiers ? item.modifiers.reduce((s, m) => s + m.price, 0) : 0;
    const itemTotal = (item.price + modPrice);
    total += itemTotal;
    
    return `
      <div class="cart-item">
        <div class="cart-item-header">
          <span class="cart-item-name">${item.name}</span>
          <button class="btn btn-danger" style="width:auto;padding:0.25rem 0.5rem;font-size:0.75rem;" onclick="removeFromCart(${idx})">✕</button>
        </div>
        <div class="cart-item-qty">
          <button class="btn btn-secondary" onclick="changeQty(${idx}, -1)">-</button>
          <span>${item.qty || 1}</span>
          <button class="btn btn-secondary" onclick="changeQty(${idx}, 1)">+</button>
          <span style="margin-left:auto;font-weight:600;">$${fmtMoney(itemTotal * (item.qty || 1))}</span>
        </div>
        ${item.modifiers && item.modifiers.length ? `<div class="cart-item-mods">${item.modifiers.map(m => m.name).join(', ')}</div>` : ''}
      </div>
    `;
  }).join('');
  
  // Apply discount
  if (state.discount.value > 0) {
    if (state.discount.type === 'percent') {
      total = total * (1 - state.discount.value / 100);
    } else {
      total = total - (state.discount.value * 100);
    }
  }
  
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

// Tip calculation helper
function calculateCheckoutTotals() {
  let subtotal = state.cart.reduce((s, item) => {
    const modPrice = item.modifiers ? item.modifiers.reduce((m, x) => m + x.price, 0) : 0;
    return s + (item.price + modPrice) * (item.qty || 1);
  }, 0);
  
  let discount = 0;
  if (state.discount.value > 0) {
    if (state.discount.type === 'percent') {
      discount = subtotal * (state.discount.value / 100);
    } else {
      discount = state.discount.value * 100;
    }
  }
  
  let afterDiscount = subtotal - discount;
  let tax = afterDiscount * 0.0875; // 8.75% tax
  let tip = state.tip || 0;
  let total = afterDiscount + tax + tip;
  
  return { subtotal, discount, afterDiscount, tax, tip, total };
}

async function openCheckoutModal() {
  const { subtotal, discount, afterDiscount, tax, tip, total } = calculateCheckoutTotals();
  const tableNum = state.tables.find(t => t.id === state.selectedTable)?.number || state.selectedTable;
  
  const tipButtons = [0, 15, 18, 20].map(pct => `
    <button class="tip-btn ${state.tipPercent === pct ? 'active' : ''}" data-pct="${pct}"
      style="padding:0.5rem 1rem;border:1px solid ${state.tipPercent === pct ? '#22c55e' : '#e2e8f0'};background:${state.tipPercent === pct ? '#22c55e' : '#fff'};color:${state.tipPercent === pct ? '#fff' : '#333'};border-radius:6px;cursor:pointer;font-weight:bold;">
      ${pct === 0 ? 'No Tip' : pct + '%'}
    </button>
  `).join('');
  
  const body = `
    <div style="padding:1rem;max-height:70vh;overflow-y:auto;">
      <h3 style="margin-top:0;">💰 Checkout</h3>
      <p><strong>Table:</strong> ${tableNum}</p>
      <p><strong>Items:</strong> ${state.cart.length}</p>
      
      <!-- Tip Section -->
      <div style="margin:1rem 0;">
        <label style="font-weight:bold;display:block;margin-bottom:0.5rem;">Add Tip</label>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem;">${tipButtons}</div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span style="font-size:0.9rem;">Custom: $</span>
          <input type="number" id="customTip" placeholder="0.00" step="0.01" min="0"
            style="width:100px;padding:0.5rem;border:1px solid #e2e8f0;border-radius:6px;"
            onchange="setCustomTip(this.value)">
        </div>
      </div>
      
      <hr style="margin:1rem 0;border-color:#e2e8f0;">
      
      <!-- Order Summary -->
      <div style="background:#f8fafc;padding:1rem;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.25rem;">
          <span>Subtotal:</span><span>$${fmtMoney(subtotal)}</span>
        </div>
        ${discount > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:0.25rem;color:#ef4444;"><span>Discount:</span><span>-$${fmtMoney(discount)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;margin-bottom:0.25rem;"><span>Tax (8.75%):</span><span>$${fmtMoney(tax)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;"><span>Tip:</span><span>$${fmtMoney(tip)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:1.25rem;font-weight:bold;border-top:2px solid #e2e8f0;padding-top:0.5rem;margin-top:0.5rem;">
          <span>Total:</span><span style="color:#22c55e;">$${fmtMoney(total)}</span>
        </div>
      </div>
      
      <!-- Payment Method -->
      <div class="form-group" style="margin-top:1rem;">
        <label><strong>Payment Method</strong></label>
        <select id="paymentMethod" style="width:100%;padding:0.75rem;border:1px solid #e2e8f0;border-radius:8px;">
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="zelle">Zelle</option>
        </select>
      </div>
      
      <!-- Receipt Preview Toggle -->
      <button type="button" onclick="toggleReceiptPreview()" 
        style="width:100%;margin-top:1rem;padding:0.75rem;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-weight:bold;">
        📄 Preview Receipt
      </button>
      
      <!-- Receipt Preview (hidden by default) -->
      <div id="receiptPreview" style="display:none;margin-top:1rem;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:1rem;font-family:monospace;font-size:0.85rem;">
        <div style="text-align:center;border-bottom:1px dashed #ccc;padding-bottom:0.5rem;margin-bottom:0.5rem;">
          <strong>APEX POS</strong><br>
          <span style="font-size:0.8rem;">${new Date().toLocaleString()}</span>
        </div>
        <div><strong>Table:</strong> ${tableNum}</div>
        <div style="margin-top:0.5rem;">
          ${state.cart.map(item => `
            <div style="display:flex;justify-content:space-between;">
              <span>${item.qty || 1}x ${item.name}</span>
              <span>$${fmtMoney((item.price + (item.modifiers?.reduce((m,x)=>m+x.price,0)||0)) * (item.qty||1))}</span>
            </div>
            ${item.modifiers?.length ? item.modifiers.map(m => `<div style="padding-left:1rem;font-size:0.8rem;color:#666;">+ ${m.name} $${fmtMoney(m.price)}</div>`).join('') : ''}
          `).join('')}
        </div>
        <div style="border-top:1px dashed #ccc;margin:0.5rem 0;padding-top:0.5rem;">
          <div style="display:flex;justify-content:space-between;"><span>Subtotal:</span><span>$${fmtMoney(subtotal)}</span></div>
          ${discount > 0 ? `<div style="display:flex;justify-content:space-between;color:#ef4444;"><span>Discount:</span><span>-$${fmtMoney(discount)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;"><span>Tax:</span><span>$${fmtMoney(tax)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Tip:</span><span>$${fmtMoney(tip)}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:1.1rem;margin-top:0.25rem;"><span>TOTAL:</span><span>$${fmtMoney(total)}</span></div>
        </div>
        <div style="text-align:center;margin-top:1rem;font-size:0.8rem;color:#666;">Thank you! 🍕</div>
      </div>
    </div>
  `;
  
  $('#checkoutBody').innerHTML = body;
  
  // Attach tip button handlers
  document.querySelectorAll('.tip-btn').forEach(btn => {
    btn.onclick = () => {
      const pct = parseInt(btn.dataset.pct);
      state.tipPercent = pct;
      if (pct > 0) {
        state.tip = afterDiscount * (pct / 100);
      } else {
        state.tip = 0;
      }
      openCheckoutModal(); // Re-render
    };
  });
  
  $('#checkoutModal').classList.add('show');
}

// Global function for custom tip
window.setCustomTip = function(val) {
  state.tipPercent = null;
  state.tip = parseFloat(val) || 0;
  openCheckoutModal();
};

window.toggleReceiptPreview = function() {
  const el = $('#receiptPreview');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

$('#cancelCheckoutBtn').onclick = () => $('#checkoutModal').classList.remove('show');
$('#closeCheckoutBtn').onclick = () => $('#checkoutModal').classList.remove('show');

$('#processPaymentBtn').onclick = async () => {
  try {
    const { total, tip } = calculateCheckoutTotals();
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
      discount: state.discount.value > 0 ? { type: state.discount.type, value: state.discount.value } : { type: 'percent', value: 0 },
      tip: tip
    };
    
    const order = await apiCall('/api/orders', { method: 'POST', body: JSON.stringify(orderData) });
    
    // Process payment
    const method = $('#paymentMethod').value;
    await apiCall('/api/payments', {
      method: 'POST',
      body: JSON.stringify({ amount: total, method, orderId: order.id, tip: tip })
    });
    
    alert(`Order #${order.id} created and paid successfully!`);
    $('#checkoutModal').classList.remove('show');
    state.cart = [];
    state.discount = { type: 'percent', value: 0 };
    state.tip = 0;
    state.tipPercent = null;
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