// Simple PIN Login - Robust Version
let pin = '';

// Run after page fully loads
setTimeout(function() {
  // Add click handlers to PIN buttons - prevent default on <a> tags
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
}, 500);

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