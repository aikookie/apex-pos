// Simple PIN Login - Override the inline handler
let pin = '';

// Wait for inline script to run first, then override
window.onload = function() {
  // Remove old handlers
  document.querySelectorAll('.pin-key').forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
  });
  
  // Add new handlers
  document.querySelectorAll('.pin-key').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const num = btn.dataset.num;
      if (num === 'C') {
        pin = '';
      } else if (num === 'E') {
        verifyPin();
      } else if (num && pin.length < 4) {
        pin += num;
      }
      updatePinDisplay();
    });
  });
};

function updatePinDisplay() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('dot' + i);
    if (dot) dot.classList.toggle('filled', i < pin.length);
  }
}

async function verifyPin() {
  if (pin.length !== 4) return;
  try {
    let staff = null;
    for (let staffId = 1; staffId <= 10; staffId++) {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, pin })
      });
      const data = await res.json();
      if (data.token) {
        staff = data;
        localStorage.setItem('apex_token', data.token);
        break;
      }
    }
    if (staff) {
      showScreen('main');
      document.getElementById('bottomNav').style.display = 'flex';
      loadMenu();
      loadTables();
      loadOrders();
    } else {
      pin = '';
      updatePinDisplay();
    }
  } catch {
    pin = '';
    updatePinDisplay();
  }
}