require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { Op } = require('sequelize');
const Stripe = require('stripe');

const { sequelize, Staff, MenuItem, MenuModifier, Table, Order, OrderItem, Payment, Setting, Employee, Shift } = require('./models');

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'apexpos-secret-change-in-production';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

// Initialize Stripe (if key is valid)
let stripe = null;
if (STRIPE_SECRET.startsWith('sk_')) {
  stripe = new Stripe(STRIPE_SECRET);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// ============ Helper Functions ============
function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '8h' });
}

const authMiddleware = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing token' });
  const token = auth.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

const adminOnly = (req, res, next) => {
  if (!['owner', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ============ DB Init & Seed ============
(async () => {
  try {
    await sequelize.sync();
    console.log('DB synced');

    // Seed staff if empty
    const staffCount = await Staff.count();
    if (staffCount === 0) {
      const defaultPins = ['1234', '5678', '9999'];
      const roles = ['owner', 'manager', 'server'];
      const names = ['Owner', 'Manager', 'Server'];
      for (let i = 0; i < 3; i++) {
        const hash = await bcrypt.hash(defaultPins[i], 10);
        await Staff.create({ name: names[i], role: roles[i], pinHash: hash });
      }
      console.log('Seeded staff');
    }

    // Seed menu if empty
    const menuCount = await MenuItem.count();
    if (menuCount === 0) {
      const defaultMenu = [
        { name: 'Kung Pao Chicken', category: 'meal', price: 14.99, description: 'Spicy diced chicken with peanuts', popular: true, spicy: true, image: '🍗', stock: 50 },
        { name: 'Mapo Tofu', category: 'meal', price: 12.99, description: 'Spicy soft tofu in rich sauce', popular: false, spicy: true, image: '🍲', stock: 50 },
        { name: 'Sweet & Sour Pork', category: 'meal', price: 13.99, description: 'Crispy pork in tangy sauce', popular: true, spicy: false, image: '🥡', stock: 40 },
        { name: 'Classic Milk Tea', category: 'boba', price: 5.99, description: 'Black tea with milk and boba', popular: true, spicy: false, image: '🧋', stock: 100 },
        { name: 'Taro Milk Tea', category: 'boba', price: 6.49, description: 'Creamy taro milk tea', popular: true, spicy: false, image: '🧋', stock: 100 },
        { name: 'Fried Dumplings', category: 'appetizer', price: 8.99, description: 'Crispy pan-fried dumplings (8 pcs)', popular: true, spicy: false, image: '🥟', stock: 30 }
      ];
      await MenuItem.bulkCreate(defaultMenu);
      
      // Add modifiers
      const modifiers = [
        { name: 'Extra Cheese', price: 1.50, category: 'extras', menuItemId: 1 },
        { name: 'Extra Spicy', price: 0, category: 'spice-level', menuItemId: 1 },
        { name: 'Regular Size', price: 0, category: 'size', menuItemId: 4 },
        { name: 'Large Size', price: 1.50, category: 'size', menuItemId: 4 },
        { name: 'Less Ice', price: 0, category: 'customization', menuItemId: 4 },
        { name: 'Extra Ice', price: 0, category: 'customization', menuItemId: 4 }
      ];
      await MenuModifier.bulkCreate(modifiers);
      console.log('Seeded menu & modifiers');
    }

    // Seed tables if empty
    const tableCount = await Table.count();
    if (tableCount === 0) {
      const defaultTables = [
        { number: 1, capacity: 4 }, { number: 2, capacity: 4 },
        { number: 3, capacity: 6 }, { number: 4, capacity: 2 },
        { number: 5, capacity: 4 }, { number: 6, capacity: 8 }
      ];
      await Table.bulkCreate(defaultTables);
      console.log('Seeded tables');
    }

    // Seed default settings if empty
    const settingsCount = await Setting.count();
    if (settingsCount === 0) {
      const defaults = [
        { key: 'taxRate', value: '0.0875', category: 'tax' },
        { key: 'tipPercent', value: '15', category: 'payment' },
        { key: 'printerName', value: 'default', category: 'printer' },
        { key: 'restaurantName', value: 'Apex Chinese & Boba', category: 'general' },
        { key: 'address', value: '123 Main St', category: 'general' },
        { key: 'phone', value: '555-0123', category: 'general' }
      ];
      await Setting.bulkCreate(defaults);
      console.log('Seeded settings');
    }

  } catch (err) {
    console.error('🚨 DB init error', err);
  }
})();

// ============ Auth ============
app.post('/api/staff/login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  
  const all = await Staff.findAll({ where: { active: true } });
  for (const user of all) {
    const match = await bcrypt.compare(pin, user.pinHash);
    if (match) {
      const token = signToken(user);
      return res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
    }
  }
  return res.status(401).json({ error: 'Invalid PIN' });
});

// ============ Menu ============
app.get('/api/menu', async (req, res) => {
  const items = await MenuItem.findAll({ include: ['modifiers'] });
  res.json(items);
});

app.get('/api/menu/:id', async (req, res) => {
  const item = await MenuItem.findByPk(req.params.id, { include: ['modifiers'] });
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

app.post('/api/menu', authMiddleware, adminOnly, async (req, res) => {
  const item = await MenuItem.create(req.body);
  res.json(item);
});

app.put('/api/menu/:id', authMiddleware, adminOnly, async (req, res) => {
  const item = await MenuItem.findByPk(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  await item.update(req.body);
  res.json(item);
});

app.delete('/api/menu/:id', authMiddleware, adminOnly, async (req, res) => {
  const del = await MenuItem.destroy({ where: { id: req.params.id } });
  res.json({ deleted: del });
});

// ============ Menu Modifiers ============
app.get('/api/menu/:id/modifiers', async (req, res) => {
  const modifiers = await MenuModifier.findAll({ where: { menuItemId: req.params.id } });
  res.json(modifiers);
});

app.post('/api/menu/:id/modifiers', authMiddleware, adminOnly, async (req, res) => {
  const modifier = await MenuModifier.create({ ...req.body, menuItemId: req.params.id });
  res.json(modifier);
});

app.delete('/api/modifiers/:id', authMiddleware, adminOnly, async (req, res) => {
  await MenuModifier.destroy({ where: { id: req.params.id } });
  res.json({ deleted: true });
});

// ============ Inventory ============
app.get('/api/inventory', authMiddleware, adminOnly, async (req, res) => {
  const items = await MenuItem.findAll({ 
    attributes: ['id', 'name', 'category', 'stock', 'lowStockThreshold'] 
  });
  // Flag low stock items
  const inventory = items.map(item => ({
    ...item.toJSON(),
    lowStock: item.stock <= item.lowStockThreshold
  }));
  res.json(inventory);
});

app.post('/api/inventory/restock/:id', authMiddleware, adminOnly, async (req, res) => {
  const { quantity } = req.body;
  const item = await MenuItem.findByPk(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  item.stock = (item.stock || 0) + (quantity || 10);
  await item.save();
  res.json(item);
});

app.put('/api/inventory/:id', authMiddleware, adminOnly, async (req, res) => {
  const item = await MenuItem.findByPk(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  await item.update(req.body); // can update stock directly
  res.json(item);
});

// ============ Tables ============
app.get('/api/tables', async (req, res) => {
  const tables = await Table.findAll();
  // Include active order info
  const tablesWithOrders = await Promise.all(tables.map(async (table) => {
    const order = await Order.findOne({ 
      where: { TableId: table.id, status: 'open' },
      include: [{ model: OrderItem, as: 'items', include: [MenuItem] }]
    });
    return { ...table.toJSON(), activeOrder: order };
  }));
  res.json(tablesWithOrders);
});

app.post('/api/tables', authMiddleware, adminOnly, async (req, res) => {
  const tbl = await Table.create(req.body);
  res.json(tbl);
});

app.put('/api/tables/:id', authMiddleware, async (req, res) => {
  const tbl = await Table.findByPk(req.params.id);
  if (!tbl) return res.status(404).json({ error: 'Table not found' });
  await tbl.update(req.body);
  res.json(tbl);
});

// ============ Orders ============
app.get('/api/orders', authMiddleware, async (req, res) => {
  const { status, date } = req.query;
  const where = {};
  if (status) where.status = status;
  if (date) {
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    where.createdAt = { [Op.between]: [start, end] };
  }
  
  const orders = await Order.findAll({
    where,
    include: [
      { model: OrderItem, as: 'items', include: [MenuItem] },
      Table,
      Staff,
      { model: Payment, as: 'payments' }
    ],
    order: [['createdAt', 'DESC']]
  });
  res.json(orders);
});

app.get('/api/orders/:id', authMiddleware, async (req, res) => {
  const order = await Order.findByPk(req.params.id, {
    include: [
      { model: OrderItem, as: 'items', include: [MenuItem] },
      Table,
      Staff,
      { model: Payment, as: 'payments' }
    ]
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.post('/api/orders', authMiddleware, async (req, res) => {
  const { tableId, orderType = 'dinein', items } = req.body;
  
  let orderData = { status: 'open', orderType, StaffId: req.user.id };
  if (orderType === 'dinein' && tableId) {
    const table = await Table.findByPk(tableId);
    if (!table) return res.status(400).json({ error: 'Invalid table' });
    orderData.TableId = table.id;
    table.status = 'occupied';
    await table.save();
  }
  
  const order = await Order.create(orderData);
  let total = 0;
  
  for (const it of items) {
    const menuItem = await MenuItem.findByPk(it.menuItemId);
    if (!menuItem) continue;
    
    // Check stock
    if (menuItem.stock < it.quantity) {
      return res.status(400).json({ error: `Insufficient stock for ${menuItem.name}` });
    }
    
    // Decrement stock
    menuItem.stock -= it.quantity;
    await menuItem.save();
    
    // Calculate item total with modifiers
    let itemTotal = menuItem.price * it.quantity;
    let modifiersStr = '';
    
    if (it.modifiers && it.modifiers.length > 0) {
      const mods = await MenuModifier.findAll({ where: { id: { [Op.in]: it.modifiers } } });
      for (const mod of mods) {
        itemTotal += mod.price * it.quantity;
        modifiersStr += (modifiersStr ? ', ' : '') + mod.name;
      }
    }
    
    total += itemTotal;
    await OrderItem.create({
      OrderId: order.id,
      MenuItemId: menuItem.id,
      quantity: it.quantity,
      price: menuItem.price,
      modifiers: modifiersStr
    });
  }
  
  order.total = total;
  await order.save();
  
  // Fetch complete order for response
  const fullOrder = await Order.findByPk(order.id, {
    include: [
      { model: OrderItem, as: 'items', include: [MenuItem] },
      Table, Staff
    ]
  });
  
  res.json(fullOrder);
});

app.put('/api/orders/:id', authMiddleware, async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'open') return res.status(400).json({ error: 'Cannot modify closed order' });
  
  await order.update(req.body);
  res.json(order);
});

app.delete('/api/orders/:id', authMiddleware, adminOnly, async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  
  // Restore stock for order items
  const items = await OrderItem.findAll({ where: { OrderId: order.id } });
  for (const item of items) {
    const menuItem = await MenuItem.findByPk(item.MenuItemId);
    if (menuItem) {
      menuItem.stock += item.quantity;
      await menuItem.save();
    }
  }
  
  order.status = 'canceled';
  await order.save();
  res.json({ canceled: true });
});

// ============ Payments ============
app.post('/api/orders/:id/payments', authMiddleware, async (req, res) => {
  const { amount, method, splitAmount } = req.body;
  const order = await Order.findByPk(req.params.id, {
    include: [{ model: Payment, as: 'payments' }]
  });
  
  if (!order) return res.status(404).json({ error: 'Order not found' });
  
  // Calculate remaining balance
  const paidSoFar = order.payments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + p.amount, 0);
  const remaining = order.total - paidSoFar;
  const paymentAmount = amount || remaining;
  
  let payment;
  let qrUrl = null;
  let clientSecret = null;
  
  switch (method) {
    case 'cash':
      payment = await Payment.create({
        OrderId: order.id,
        amount: paymentAmount,
        method: 'cash',
        status: 'completed'
      });
      break;
      
    case 'stripe':
      if (!stripe) {
        // Mock mode
        payment = await Payment.create({
          OrderId: order.id,
          amount: paymentAmount,
          method: 'stripe',
          status: 'completed',
          transactionId: 'mock_' + Date.now()
        });
      } else {
        // Real Stripe payment intent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(paymentAmount * 100),
          currency: 'usd',
          metadata: { orderId: order.id }
        });
        clientSecret = paymentIntent.client_secret;
        payment = await Payment.create({
          OrderId: order.id,
          amount: paymentAmount,
          method: 'stripe',
          status: 'pending',
          transactionId: paymentIntent.id
        });
      }
      break;
      
    case 'zelle':
      const zelleEmail = process.env.ZELLE_EMAIL || 'payments@example.com';
      const qrData = `zelle:${zelleEmail}?amount=${paymentAmount}`;
      qrUrl = await QRCode.toDataURL(qrData);
      payment = await Payment.create({
        OrderId: order.id,
        amount: paymentAmount,
        method: 'zelle',
        status: 'pending'
      });
      break;
      
    default:
      return res.status(400).json({ error: 'Unsupported payment method' });
  }
  
  // Check if order is fully paid
  const newPaidTotal = paidSoFar + paymentAmount;
  if (newPaidTotal >= order.total && payment.status === 'completed') {
    order.status = 'paid';
    await order.save();
    
    // Free up table if dine-in
    if (order.TableId) {
      const table = await Table.findByPk(order.TableId);
      if (table) {
        table.status = 'available';
        await table.save();
      }
    }
  }
  
  res.json({ payment, qrUrl, clientSecret, order });
});

// Stripe webhook handler
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(200).send('Stripe not configured');
  
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const payment = await Payment.findOne({ 
      where: { transactionId: paymentIntent.id } 
    });
    if (payment) {
      payment.status = 'completed';
      await payment.save();
      
      const order = await Order.findByPk(payment.OrderId);
      if (order) {
        order.status = 'paid';
        await order.save();
      }
    }
  }
  
  res.json({ received: true });
});

app.get('/api/orders/:id/payments', authMiddleware, async (req, res) => {
  const payments = await Payment.findAll({ where: { OrderId: req.params.id } });
  res.json(payments);
});

// ============ Settings ============
app.get('/api/settings', authMiddleware, async (req, res) => {
  const settings = await Setting.findAll();
  const obj = {};
  settings.forEach(s => { obj[s.key] = s.value; });
  res.json(obj);
});

app.get('/api/settings/:key', authMiddleware, async (req, res) => {
  const setting = await Setting.findOne({ where: { key: req.params.key } });
  if (!setting) return res.status(404).json({ error: 'Setting not found' });
  res.json(setting);
});

app.post('/api/settings', authMiddleware, adminOnly, async (req, res) => {
  const { key, value, category } = req.body;
  const [setting, created] = await Setting.findOrCreate({
    where: { key },
    defaults: { value, category }
  });
  if (!created) {
    await setting.update({ value, category });
  }
  res.json(setting);
});

app.delete('/api/settings/:key', authMiddleware, adminOnly, async (req, res) => {
  await Setting.destroy({ where: { key: req.params.key } });
  res.json({ deleted: true });
});

// ============ Employees & Shifts ============
app.get('/api/employees', authMiddleware, adminOnly, async (req, res) => {
  const employees = await Employee.findAll({ where: { active: true } });
  res.json(employees);
});

app.post('/api/employees', authMiddleware, adminOnly, async (req, res) => {
  const { name, role, pin, hourlyRate } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  const pinHash = await bcrypt.hash(pin, 10);
  const employee = await Employee.create({ name, role, pinHash, hourlyRate });
  res.json(employee);
});

app.put('/api/employees/:id', authMiddleware, adminOnly, async (req, res) => {
  const emp = await Employee.findByPk(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  
  if (req.body.pin) {
    req.body.pinHash = await bcrypt.hash(req.body.pin, 10);
    delete req.body.pin;
  }
  
  await emp.update(req.body);
  res.json(emp);
});

app.delete('/api/employees/:id', authMiddleware, adminOnly, async (req, res) => {
  const emp = await Employee.findByPk(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  emp.active = false;
  await emp.save();
  res.json({ deleted: true });
});

// Shift management
app.post('/api/shifts/start', authMiddleware, async (req, res) => {
  // Check if employee already has open shift
  const openShift = await Shift.findOne({
    where: { EmployeeId: req.user.id, endTime: null }
  });
  if (openShift) return res.status(400).json({ error: 'You have an open shift' });
  
  const shift = await Shift.create({
    EmployeeId: req.user.id,
    startTime: new Date()
  });
  res.json(shift);
});

app.post('/api/shifts/:id/end', authMiddleware, async (req, res) => {
  const shift = await Shift.findByPk(req.params.id);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });
  if (shift.endTime) return res.status(400).json({ error: 'Shift already ended');
  
  const endTime = new Date();
  const hours = (endTime - shift.startTime) / (1000 * 60 * 60);
  shift.endTime = endTime;
  shift.totalHours = hours;
  await shift.save();
  res.json(shift);
});

app.get('/api/shifts', authMiddleware, adminOnly, async (req, res) => {
  const { startDate, endDate } = req.query;
  const where = {};
  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) where.startTime[Op.gte] = new Date(startDate);
    if (endDate) where.startTime[Op.lte] = new Date(endDate);
  }
  
  const shifts = await Shift.findAll({
    where,
    include: [Employee],
    order: [['startTime', 'DESC']]
  });
  res.json(shifts);
});

// ============ Reports ============
app.get('/api/reports/daily', authMiddleware, adminOnly, async (req, res) => {
  const { date } = req.query;
  const targetDate = date ? new Date(date) : new Date();
  const start = new Date(targetDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(targetDate);
  end.setHours(23, 59, 59, 999);
  
  const orders = await Order.findAll({
    where: {
      status: 'paid',
      createdAt: { [Op.between]: [start, end] }
    },
    include: [Staff, { model: Payment, as: 'payments' }]
  });
  
  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  const orderCount = orders.length;
  const avgTicket = orderCount > 0 ? totalSales / orderCount : 0;
  
  // Payment breakdown
  const payments = orders.flatMap(o => o.payments || []);
  const byMethod = {};
  payments.forEach(p => {
    byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
  });
  
  // Category breakdown
  const items = await OrderItem.findAll({
    include: [{ 
      model: Order, 
      where: { 
        status: 'paid',
        createdAt: { [Op.between]: [start, end] }
      } 
    }, MenuItem]
  });
  
  const byCategory = {};
  items.forEach(item => {
    const cat = item.MenuItem?.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + (item.price * item.quantity);
  });
  
  res.json({
    date: targetDate.toISOString().split('T')[0],
    totalSales,
    orderCount,
    avgTicket,
    byMethod,
    byCategory
  });
});

app.get('/api/reports/summary', authMiddleware, adminOnly, async (req, res) => {
  const { days = 7 } = req.query;
  const start = new Date();
  start.setDate(start.getDate() - parseInt(days));
  
  const orders = await Order.findAll({
    where: {
      status: 'paid',
      createdAt: { [Op.gte]: start }
    }
  });
  
  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  const orderCount = orders.length;
  
  // Daily breakdown
  const daily = {};
  orders.forEach(o => {
    const d = o.createdAt.toISOString().split('T')[0];
    daily[d] = (daily[d] || 0) + o.total;
  });
  
  // Top items
  const items = await OrderItem.findAll({
    include: [{ model: Order, where: { status: 'paid', createdAt: { [Op.gte]: start } } }, MenuItem]
  });
  
  const topItems = {};
  items.forEach(item => {
    const name = item.MenuItem?.name || 'Unknown';
    topItems[name] = (topItems[name] || 0) + item.quantity;
  });
  
  const sortedItems = Object.entries(topItems)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, qty]) => ({ name, quantity: qty }));
  
  res.json({
    period: `${days} days`,
    totalSales,
    orderCount,
    avgTicket: orderCount > 0 ? totalSales / orderCount : 0,
    daily,
    topItems: sortedItems
  });
});

app.get('/api/reports/labor', authMiddleware, adminOnly, async (req, res) => {
  const { startDate, endDate } = req.query;
  const where = {};
  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) where.startTime[Op.gte] = new Date(startDate);
    if (endDate) where.startTime[Op.lte] = new Date(endDate);
  }
  
  const shifts = await Shift.findAll({
    where,
    include: [Employee],
    order: [['startTime', 'DESC']]
  });
  
  const byEmployee = {};
  shifts.forEach(s => {
    const name = s.Employee?.name || 'Unknown';
    if (!byEmployee[name]) {
      byEmployee[name] = { hours: 0, shifts: 0, tips: 0, sales: 0 };
    }
    byEmployee[name].hours += s.totalHours || 0;
    byEmployee[name].shifts += 1;
    byEmployee[name].tips += s.tips || 0;
    byEmployee[name].sales += s.salesTotal || 0;
  });
  
  res.json(byEmployee);
});

// ============ Receipt Printing ============
app.post('/api/orders/:id/print', authMiddleware, async (req, res) => {
  const order = await Order.findByPk(req.params.id, {
    include: [
      { model: OrderItem, as: 'items', include: [MenuItem] },
      Table, Staff
    ]
  });
  
  if (!order) return res.status(404).json({ error: 'Order not found' });
  
  // Generate receipt text
  const settings = await Setting.findAll();
  const config = {};
  settings.forEach(s => config[s.key] = s.value);
  
  let receipt = `
================================
${config.restaurantName || 'Apex POS'}
${config.address || ''}
${config.phone || ''}
================================
Order #${order.id}
${order.createdAt.toLocaleString()}
${order.orderType.toUpperCase()}
${order.Table ? `Table: ${order.Table.number}` : 'Takeout'}
--------------------------------
`;
  
  order.items.forEach(item => {
    receipt += `${item.quantity}x ${item.MenuItem?.name || 'Item'}\n`;
    if (item.modifiers) {
      receipt += `   + ${item.modifiers}\n`;
    }
    receipt += `   $${(item.price * item.quantity).toFixed(2)}\n`;
  });
  
  receipt += `--------------------------------
SUBTOTAL:        $${order.total.toFixed(2)}
TAX (${((parseFloat(config.taxRate) || 0.0875) * 100).toFixed(1)}%):     $${(order.total * (parseFloat(config.taxRate) || 0.0875)).toFixed(2)}
--------------------------------
TOTAL:           $${(order.total * (1 + (parseFloat(config.taxRate) || 0.0875))).toFixed(2)}
================================
Served by: ${order.Staff?.name || 'N/A'}
Thank you!
`;
  
  // In production, this would send to ESC/POS printer
  // For now, return the receipt text
  res.json({ receipt, orderId: order.id });
});

// ============ Offline Sync Queue ============
// For PWA - sync orders when back online
app.get('/api/sync/status', authMiddleware, async (req, res) => {
  res.json({ 
    status: 'online',
    lastSync: new Date().toISOString(),
    pendingOrders: 0 // Client-side tracked
  });
});

// ============ Health ============
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`Apex POS listening on http://localhost:${PORT}`);
  console.log(`JWT secret: ${JWT_SECRET === 'apexpos-secret-change-in-production' ? 'DEFAULT (CHANGE IN PRODUCTION!)' : 'Custom (secure)'}`);
});