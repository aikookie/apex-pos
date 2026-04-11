require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
// Note: Server serves from 'static' folder - no copy needed

const { sequelize, Staff, MenuItem, MenuModifier, Table, Order, OrderItem, Payment, Setting, Employee, Shift, PrinterStation } = require('./models');

const app = express();
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'apexpos-secret-change-in-production';

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// ============ Auth Middleware ============
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

// ============ Health ============
app.get('/health', (req, res) => res.send('OK'));

// ============ Frontend ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'static', 'index.html')));

// ============ Auth ============
app.get('/api/staff', async (req, res) => {
  const staff = await Staff.findAll({ where: { active: true }, attributes: ['id', 'name', 'role'] });
  res.json(staff);
});

app.post('/api/auth/login', async (req, res) => {
  const { staffId, pin } = req.body;
  if (!staffId || !pin) return res.status(400).json({ error: 'Staff ID and PIN required' });
  
  const staff = await Staff.findByPk(staffId);
  if (!staff) return res.status(401).json({ error: 'Invalid PIN' });
  
  const match = await bcrypt.compare(pin, staff.pinHash);
  if (!match) return res.status(401).json({ error: 'Invalid PIN' });
  
  const token = jwt.sign({ id: staff.id, name: staff.name, role: staff.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, name: staff.name, role: staff.role });
});

// ============ Menu ============
app.get('/api/menu', async (req, res) => {
  const items = await MenuItem.findAll();
  res.json(items);
});

app.get('/api/menu/categories', async (req, res) => {
  const items = await MenuItem.findAll({ attributes: ['category'], group: ['category'] });
  const categories = items.map(i => i.category).filter(c => c);
  res.json(categories);
});

app.get('/api/menu/:id', async (req, res) => {
  const item = await MenuItem.findByPk(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

app.get('/api/menu/:id/modifiers', async (req, res) => {
  const modifiers = await MenuModifier.findAll({ where: { menuItemId: req.params.id } });
  res.json(modifiers);
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
  const item = await MenuItem.findByPk(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  await item.destroy();
  res.json({ deleted: true });
});

// ============ Modifiers ============
app.get('/api/modifiers', async (req, res) => {
  const modifiers = await MenuModifier.findAll();
  res.json(modifiers);
});

app.get('/api/modifiers/categories', async (req, res) => {
  // Use SQL DISTINCT for faster query, normalize to lowercase
  const modifiers = await MenuModifier.findAll({ attributes: ['category'], raw: true });
  const categories = [...new Set(modifiers.map(m => (m.category || '').toLowerCase()).filter(c => c))];
  res.json(categories);
});

app.post('/api/modifiers', authMiddleware, adminOnly, async (req, res) => {
  const modifier = await MenuModifier.create(req.body);
  res.json(modifier);
});

app.post('/api/menu/:id/modifiers', authMiddleware, adminOnly, async (req, res) => {
  const modifier = await MenuModifier.create({ ...req.body, menuItemId: req.params.id });
  res.json(modifier);
});

app.delete('/api/modifiers/:id', authMiddleware, adminOnly, async (req, res) => {
  const modifier = await MenuModifier.findByPk(req.params.id);
  if (!modifier) return res.status(404).json({ error: 'Modifier not found' });
  await modifier.destroy();
  res.json({ deleted: true });
});

app.put('/api/modifiers/:id', authMiddleware, adminOnly, async (req, res) => {
  const modifier = await MenuModifier.findByPk(req.params.id);
  if (!modifier) return res.status(404).json({ error: 'Modifier not found' });
  await modifier.update(req.body);
  res.json(modifier);
});

// ============ Tables ============
app.get('/api/tables', async (req, res) => {
  const tables = await Table.findAll();
  res.json(tables);
});

app.post('/api/tables', authMiddleware, adminOnly, async (req, res) => {
  const table = await Table.create(req.body);
  res.json(table);
});

app.put('/api/tables/:id', async (req, res) => {
  const table = await Table.findByPk(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  await table.update(req.body);
  res.json(table);
});

// ============ Orders ============
app.get('/api/orders', async (req, res) => {
  const { status, limit = 50 } = req.query;
  const where = {};
  if (status) where.status = status;
  
  const orders = await Order.findAll({
    where,
    include: [{ 
      model: OrderItem, 
      as: 'items',
      include: [MenuItem] 
    }, {
      model: Staff,
      attributes: ['id', 'name']
    }],
    order: [['createdAt', 'DESC']],
    limit: parseInt(limit)
  });
  res.json(orders);
});

app.get('/api/orders/:id', async (req, res) => {
  const order = await Order.findByPk(req.params.id, {
    include: [{ 
      model: OrderItem, 
      as: 'items',
      include: [MenuItem] 
    }, {
      model: Staff,
      attributes: ['name']
    }]
  });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.post('/api/orders', authMiddleware, async (req, res) => {
  const { tableId, items, orderType = 'dinein', staffId, discount = 0, tip = 0 } = req.body;
  if (!tableId || !items || !items.length) {
    return res.status(400).json({ error: 'Table ID and items required' });
  }
  
  // Calculate total with modifiers (including modifier quantities)
  let subtotal = 0;
  for (const item of items) {
    const itemTotal = item.price * item.qty;
    let modifierTotal = 0;
    if (item.modifiers && Array.isArray(item.modifiers)) {
      const mQty = item.modifierQty || {};
      modifierTotal = item.modifiers.reduce((sum, m) => {
        const qty = mQty[m.id] || 1;
        return sum + ((m.price || 0) * qty * item.qty);
      }, 0);
    }
    subtotal += itemTotal + modifierTotal;
  }
  
  const discountAmount = discount.type === 'percent' 
    ? subtotal * (discount.value / 100) 
    : discount.value || 0;
  
  // Get tax rate from settings (default 8.25%)
  let taxRate = 8.25;
  try {
    const taxSetting = await Setting.findOne({ where: { key: 'taxRate' } });
    if (taxSetting) taxRate = parseFloat(taxSetting.value) || 8.25;
  } catch (e) { /* use default */ }
  
  const taxableAmount = subtotal - discountAmount;
  const tax = Math.round(taxableAmount * (taxRate / 100) * 100) / 100;
  const total = Number((taxableAmount + tax + tip).toFixed(2));
  
  const order = await Order.create({
    TableId: tableId,
    StaffId: staffId || req.user?.id || 1,
    orderType,
    status: 'open',
    subtotal,
    tax,
    tip,
    total,
    discount: discountAmount,
    notes: discount.reason || ''
  });
  
  for (const item of items) {
    const modifiersJson = item.modifiers ? JSON.stringify(item.modifiers) : null;
    const modifierQtyJson = item.modifierQty ? JSON.stringify(item.modifierQty) : null;
    const menuItemId = item.menuItemId || item.id;
    await OrderItem.create({
      orderId: order.id,
      menuItemId: menuItemId,
      quantity: item.qty,
      price: item.price,
      modifiers: modifiersJson,
      modifierQty: modifierQtyJson,
      remarks: item.remarks || null
    });
    
    // Update inventory
    const menuItem = await MenuItem.findByPk(menuItemId);
    if (menuItem && menuItem.stock !== null) {
      await menuItem.update({ stock: Math.max(0, menuItem.stock - item.qty) });
    }
  }
  
  // Update table status
  const table = await Table.findByPk(tableId);
  if (table) await table.update({ status: 'occupied' });
  
  const fullOrder = await Order.findByPk(order.id, {
    include: [{ 
      model: OrderItem, 
      as: 'items',
      include: [MenuItem] 
    }]
  });
  
  // Auto-print to stations (fire and forget)
  setTimeout(async () => {
    try {
      const stations = await PrinterStation.findAll({ where: { active: true } });
      if (stations.length > 0) {
        // Build filtered orders per station
        for (const station of stations) {
          const categories = (station.categories || '').split(',').map(c => c.trim().toLowerCase());
          const isAll = categories.includes('*');
          const matchingItems = (fullOrder.items || []).filter(item => {
            const itemCat = (item.MenuItem?.category || '').toLowerCase();
            return isAll || categories.includes(itemCat);
          });
          if (matchingItems.length > 0) {
            const filtered = { ...fullOrder.toJSON(), items: matchingItems };
            const content = buildKitchenSlip(filtered, station.name);
            for (let i = 0; i < (station.printCopy || 1); i++) {
              await printToStation(station, content);
            }
          }
        }
        console.log(`Auto-printed order #${order.id} to stations`);
      }
    } catch (e) {
      console.error('Auto-print error:', e.message);
    }
  }, 500);
  
  res.json(fullOrder);
});

app.put('/api/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  await order.update({ status });
  res.json(order);
});

app.put('/api/orders/:id', async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  await order.update(req.body);
  res.json(order);
});

// Delete order completely
app.delete('/api/orders/:id', authMiddleware, async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  
  // Delete order items first
  await OrderItem.destroy({ where: { orderId: order.id } });
  
  // Delete associated payments
  await Payment.destroy({ where: { orderId: order.id } });
  
  // Delete the order
  await order.destroy();
  
  res.json({ deleted: true, id: req.params.id });
});

// Void/Refund
app.post('/api/orders/:id/void', authMiddleware, async (req, res) => {
  const { reason } = req.body;
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  
  // Restore inventory
  const orderItems = await OrderItem.findAll({ where: { orderId: order.id } });
  for (const item of orderItems) {
    const menuItem = await MenuItem.findByPk(item.menuItemId);
    if (menuItem && menuItem.stock !== null) {
      await menuItem.update({ stock: menuItem.stock + item.quantity });
    }
  }
  
  await order.update({ 
    status: 'canceled',
    notes: (order.notes || '') + ` | VOIDED: ${reason} by ${req.user?.name || 'staff'}`
  });
  
  // Free up table
  const table = await Table.findByPk(order.TableId);
  if (table) await table.update({ status: 'available' });
  
  res.json(order);
});

// ============ Payments ============
app.post('/api/payments', async (req, res) => {
  const { orderId, amount, method, tip = 0, splits = [] } = req.body;
  const order = await Order.findByPk(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  
  const paidAmount = splits.reduce((sum, s) => sum + s.amount, 0) || amount || order.total;
  
  // Handle splits
  if (splits.length > 0) {
    for (const split of splits) {
      await Payment.create({
        orderId: orderId,
        amount: split.amount,
        tip: split.tip || 0,
        method: split.method,
        status: 'completed',
        transactionId: split.transactionId || null
      });
    }
  } else {
    await Payment.create({
      orderId: orderId,
      amount: paidAmount,
      tip: tip,
      method: method || 'cash',
      status: 'completed'
    });
  }
  
  await order.update({ tip: order.tip + tip }); // Keep status as 'open' for kitchen visibility
  
  // Free up table
  const table = await Table.findByPk(order.TableId);
  if (table) await table.update({ status: 'available' });
  
  res.json({ success: true, orderId, paidAmount });
});

// ============ Discounts ============
app.post('/api/discounts', authMiddleware, async (req, res) => {
  const { orderId, type, value, reason } = req.body;
  const order = await Order.findByPk(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  
  const discountAmount = type === 'percent' 
    ? order.total * (value / 100) 
    : value;
  
  await order.update({
    discount: discountAmount,
    total: order.total - discountAmount,
    notes: (order.notes || '') + ` | DISCOUNT: ${reason}`
  });
  
  res.json(order);
});

// ============ Kitchen Display (KDS) ============
app.get('/api/kitchen/orders', async (req, res) => {
  const orders = await Order.findAll({
    where: { status: { [Op.in]: ['open', 'preparing'] } },
    include: [{ 
      model: OrderItem, 
      as: 'items',
      include: [MenuItem] 
    }, Table, Staff],
    order: [['createdAt', 'ASC']]
  });
  res.json(orders);
});

app.put('/api/kitchen/orders/:id/ready', authMiddleware, async (req, res) => {
  const order = await Order.findByPk(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  await order.update({ status: 'ready' });
  res.json(order);
});

// ============ Employees ============
app.get('/api/employees', async (req, res) => {
  const employees = await Employee.findAll({ where: { active: true } });
  res.json(employees);
});

app.post('/api/employees', authMiddleware, adminOnly, async (req, res) => {
  const { name, role, pin, hourlyRate } = req.body;
  const pinHash = await bcrypt.hash(pin, 10);
  const emp = await Employee.create({ name, role, pinHash, hourlyRate });
  res.json({ id: emp.id, name: emp.name, role: emp.role });
});

app.put('/api/employees/:id', authMiddleware, adminOnly, async (req, res) => {
  const emp = await Employee.findByPk(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  
  const updateData = { ...req.body };
  if (req.body.pin) {
    updateData.pinHash = await bcrypt.hash(req.body.pin, 10);
    delete updateData.pin;
  }
  
  await emp.update(updateData);
  res.json(emp);
});

app.delete('/api/employees/:id', authMiddleware, adminOnly, async (req, res) => {
  const emp = await Employee.findByPk(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  await emp.update({ active: false });
  res.json({ deleted: true });
});

// ============ Shifts ============
app.post('/api/shifts/start', authMiddleware, async (req, res) => {
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
  if (shift.endTime) return res.status(400).json({ error: 'Shift already ended' });
  
  const endTime = new Date();
  const hours = (endTime - new Date(shift.startTime)) / (1000 * 60 * 60);
  shift.endTime = endTime;
  shift.totalHours = hours;
  await shift.save();
  res.json(shift);
});

app.get('/api/shifts', authMiddleware, adminOnly, async (req, res) => {
  const { startDate, endDate, employeeId } = req.query;
  const where = {};
  
  if (employeeId) where.EmployeeId = employeeId;
  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) where.startTime[Op.gte] = new Date(startDate);
    if (endDate) where.startTime[Op.lte] = new Date(endDate);
  }
  
  const shifts = await Shift.findAll({
    where,
    include: [{ model: Employee, attributes: ['name'] }],
    order: [['startTime', 'DESC']]
  });
  res.json(shifts);
});

// ============ Reports ============
app.get('/api/reports/sales', authMiddleware, adminOnly, async (req, res) => {
  const { startDate, endDate, groupBy = 'day' } = req.query;
  const where = { status: 'paid' };
  
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt[Op.gte] = new Date(startDate);
    if (endDate) where.createdAt[Op.lte] = new Date(endDate);
  }
  
  const orders = await Order.findAll({ where });
  
  let totalSales = 0;
  let totalOrders = orders.length;
  let totalDiscounts = 0;
  
  for (const order of orders) {
    totalSales += order.total;
    totalDiscounts += order.discount || 0;
  }
  
  // Sales by hour
  const byHour = {};
  for (const order of orders) {
    const hour = new Date(order.createdAt).getHours();
    byHour[hour] = (byHour[hour] || 0) + order.total;
  }
  
  res.json({
    totalSales,
    totalOrders,
    avgOrderValue: totalOrders > 0 ? totalSales / totalOrders : 0,
    totalDiscounts,
    byHour
  });
});

app.get('/api/reports/employees', authMiddleware, adminOnly, async (req, res) => {
  const { startDate, endDate } = req.query;
  const where = {};
  
  if (startDate || endDate) {
    where.startTime = {};
    if (startDate) where.startTime[Op.gte] = new Date(startDate);
    if (endDate) where.startTime[Op.lte] = new Date(endDate);
  }
  
  const shifts = await Shift.findAll({
    where,
    include: [{ model: Employee, attributes: ['name', 'role', 'hourlyRate'] }]
  });
  
  const employeeStats = {};
  for (const shift of shifts) {
    const empId = shift.EmployeeId;
    if (!employeeStats[empId]) {
      employeeStats[empId] = { 
        name: shift.Employee?.name || 'Unknown',
        role: shift.Employee?.role || 'server',
        hours: 0, 
        tips: 0,
        shifts: 0 
      };
    }
    employeeStats[empId].hours += shift.totalHours || 0;
    employeeStats[empId].tips += shift.tips || 0;
    employeeStats[empId].shifts += 1;
  }
  
  // Calculate wages
  for (const empId in employeeStats) {
    const stats = employeeStats[empId];
    const rate = shifts.find(s => s.EmployeeId == empId)?.Employee?.hourlyRate || 15;
    stats.wages = stats.hours * rate;
  }
  
  res.json(Object.values(employeeStats));
});

app.get('/api/reports/inventory', authMiddleware, adminOnly, async (req, res) => {
  const items = await MenuItem.findAll({
    where: { stock: { [Op.lte]: sequelize.col('lowStockThreshold') } }
  });
  res.json(items);
});

// ============ Settings ============
app.get('/api/settings', authMiddleware, adminOnly, async (req, res) => {
  const settings = await Setting.findAll();
  res.json(settings);
});

app.get('/api/settings/:key', async (req, res) => {
  const setting = await Setting.findOne({ where: { key: req.params.key } });
  res.json(setting ? setting.value : null);
});

// Public settings (restaurant name, address for receipts)
const publicSettings = ['restaurant_name', 'restaurant_address', 'taxRate', 'businessHours'];

app.put('/api/settings/:key', async (req, res) => {
  const key = req.params.key;
  // Allow public settings without auth
  if (!publicSettings.includes(key)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { value, category = 'general' } = req.body;
  const [setting, created] = await Setting.upsert({
    key: req.params.key,
    value,
    category
  });
  res.json(setting);
});

// ============ Inventory ============
app.get('/api/inventory', authMiddleware, adminOnly, async (req, res) => {
  const items = await MenuItem.findAll({ order: [['category', 'ASC'], ['name', 'ASC']] });
  res.json(items);
});

app.put('/api/inventory/:id', authMiddleware, adminOnly, async (req, res) => {
  const { stock, lowStockThreshold } = req.body;
  const item = await MenuItem.findByPk(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  
  if (stock !== undefined) await item.update({ stock });
  if (lowStockThreshold !== undefined) await item.update({ lowStockThreshold });
  
  res.json(item);
});

// ============ Init DB and seed ============
(async () => {
  await sequelize.sync({ force: true });
  console.log('DB synced');
  
  // Seed staff
  const pins = ['1234', '5678', '9999'];
  const roles = ['owner', 'manager', 'server'];
  const names = ['Owner', 'Manager', 'Server'];
  for (let i = 0; i < 3; i++) {
    const hash = await bcrypt.hash(pins[i], 10);
    await Staff.create({ name: names[i], role: roles[i], pinHash: hash, active: true });
  }
  console.log('Seeded staff');
  
  // Seed menu with modifiers
  const menuItems = [
    { name: 'Kung Pao Chicken', category: 'meal', price: 14.99, spicy: true },
    { name: 'Mapo Tofu', category: 'meal', price: 12.99, spicy: true },
    { name: 'Sweet & Sour Pork', category: 'meal', price: 13.99 },
    { name: 'Fried Rice', category: 'meal', price: 9.99 },
    { name: 'Egg Drop Soup', category: 'appetizer', price: 5.99 },
    { name: 'Spring Rolls', category: 'appetizer', price: 6.99 },
    { name: 'Milk Tea', category: 'drink', price: 5.99 },
    { name: 'Thai Tea', category: 'drink', price: 5.99 },
    { name: 'Jasmine Tea', category: 'drink', price: 3.99 }
  ];
  
  for (const item of menuItems) {
    const menuItem = await MenuItem.create(item);
    
    // Add modifiers for drinks
    if (item.category === 'drink') {
      await MenuModifier.create({ name: 'Large (+$1.00)', price: 1.00, category: 'size', menuItemId: menuItem.id });
      await MenuModifier.create({ name: 'No Sugar', price: 0, category: 'sweetness', menuItemId: menuItem.id });
      await MenuModifier.create({ name: 'Less Ice', price: 0, category: 'ice', menuItemId: menuItem.id });
    }
    // Add modifiers for meals
    if (item.category === 'meal') {
      await MenuModifier.create({ name: 'Extra Spicy', price: 0, category: 'spice', menuItemId: menuItem.id });
      await MenuModifier.create({ name: 'Add Rice (+$2.00)', price: 2.00, category: 'extras', menuItemId: menuItem.id });
      await MenuModifier.create({ name: 'No Vegetables', price: 0, category: 'exclude', menuItemId: menuItem.id });
    }
  }
  console.log('Seeded menu with modifiers');
  
  // Seed tables
  for (let i = 1; i <= 9; i++) {
    await Table.create({ number: i, capacity: 4, status: 'available' });
  }
  console.log('Seeded tables');
  
  // Seed employees
  const empPins = ['1111', '2222', '3333', '4444'];
  const empRoles = ['owner', 'manager', 'server', 'kitchen'];
  const empNames = ['John Owner', 'Mary Manager', 'Sam Server', 'Chef Kim'];
  for (let i = 0; i < 4; i++) {
    const hash = await bcrypt.hash(empPins[i], 10);
    await Employee.create({ 
      name: empNames[i], 
      role: empRoles[i], 
      pinHash: hash, 
      hourlyRate: 15 + i * 2 
    });
  }
  console.log('Seeded employees');

  // ============ Receipt Printing ============
  
  // Network (Ethernet) printer helper
  async function printViaNetwork(printerHost, printerPort, content) {
    const net = require('net');
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      client.setEncoding('utf8');
      client.connect(printerPort || 9100, printerHost, () => {
        client.write(content);
        client.end();
        resolve();
      });
      client.on('error', reject);
    });
  }
  
  // Build receipt text content
  function buildReceiptContent(order) {
    const lines = [];
    lines.push('APEX POS');
    lines.push('----------------');
    lines.push(`Order #${order.id}`);
    lines.push(`Table: ${order.Table?.number || 'Takeout'}`);
    lines.push(`Server: ${order.staff?.name || 'N/A'}`);
    lines.push(`Date: ${new Date(order.createdAt).toLocaleString()}`);
    lines.push('----------------');
    
    for (const item of order.OrderItems || []) {
      const qty = item.quantity;
      const name = item.MenuItem?.name || 'Item';
      const price = (item.price + (item.modifierPrice || 0)) * qty / 100;
      lines.push(`${qty}x ${name}`);
      lines.push(`   $${price.toFixed(2)}`);
      if (item.modifiers) {
        const mods = typeof item.modifiers === 'string' ? JSON.parse(item.modifiers) : item.modifiers;
        for (const m of mods) {
          lines.push(`   +${m.name} +$${parseFloat(m.price).toFixed(2)}`);
        }
      }
    }
    
    lines.push('----------------');
    lines.push(`Subtotal: $${order.subtotal.toFixed(2)}`);
    if (order.discount > 0) {
      lines.push(`Discount: -$${order.discount.toFixed(2)}`);
    }
    lines.push(`Tax: $${order.tax.toFixed(2)}`);
    lines.push('----------------');
    lines.push(`TOTAL: $${order.total.toFixed(2)}`);
    lines.push('----------------');
    
    if (order.Payments?.[0]) {
      lines.push(`Payment: ${order.Payments[0].method}`);
      if (order.Payments[0].cashReceived) {
        lines.push(`Cash: $${order.Payments[0].cashReceived.toFixed(2)}`);
        lines.push(`Change: $${order.Payments[0].changeGiven.toFixed(2)}`);
      }
    }
    lines.push('');
    lines.push('Thank you!');
    return lines.join('\n') + '\x1D\x56\x00'; // ESC/POS cut
  }
  
  // Build kitchen/bar slip (no prices, just items)
  function buildKitchenSlip(order, stationName) {
    const lines = [];
    lines.push('================');
    lines.push(stationName.toUpperCase());
    lines.push('================');
    lines.push(`Order #${order.id}`);
    lines.push(`Table: ${order.Table?.number || 'Takeout'}`);
    lines.push(`Server: ${order.staff?.name || 'N/A'}`);
    lines.push(`Time: ${new Date(order.createdAt).toLocaleTimeString()}`);
    lines.push('----------------');
    
    for (const item of order.OrderItems || []) {
      const qty = item.quantity;
      const name = item.MenuItem?.name || 'Item';
      lines.push(`** ${qty}x ${name} **`);
      if (item.modifiers) {
        const mods = typeof item.modifiers === 'string' ? JSON.parse(item.modifiers) : item.modifiers;
        for (const m of mods) {
          lines.push(`   + ${m.name}`);
        }
      }
      if (item.remarks) {
        lines.push(`   !! ${item.remarks}`);
      }
    }
    
    lines.push('================');
    lines.push('');
    return lines.join('\n') + '\x1D\x56\x00';
  }
  
  // Print to a specific station
  async function printToStation(station, content) {
    if (!station.active) return { skipped: true, reason: 'inactive' };
    try {
      if (station.printerType === 'network') {
        await printViaNetwork(station.printerHost, station.printerPort, content);
        return { success: true, station: station.name };
      } else {
        return { success: false, reason: 'unsupported type: ' + station.printerType };
      }
    } catch (e) {
      return { success: false, error: e.message, station: station.name };
    }
  }
  
  // Get printer settings from DB
  async function getPrinterSettings() {
    const setting = await Setting.findOne({ where: { key: 'printer_config' } });
    return setting ? JSON.parse(setting.value) : { type: 'usb' };
  }
  
  // Save printer settings
  app.post('/api/print/config', authMiddleware, async (req, res) => {
    const { type, host, port, deviceName, bluetoothMac } = req.body;
    
    const config = {
      type: type || 'usb',
      host: host || '192.168.1.100',
      port: port || 9100,
      deviceName: deviceName || 'default',
      bluetoothMac: bluetoothMac || '',
      updatedAt: new Date().toISOString()
    };
    
    await Setting.upsert({
      key: 'printer_config',
      value: JSON.stringify(config)
    });
    res.json({ success: true, config });
  });
  
  // Get printer settings
  app.get('/api/print/config', authMiddleware, async (req, res) => {
    const config = await getPrinterSettings();
    res.json(config);
  });
  
  // ===== PRINTER STATIONS API =====
  // Get all printer stations
  app.get('/api/print/stations', authMiddleware, async (req, res) => {
    const stations = await PrinterStation.findAll({ order: [['name', 'ASC']] });
    res.json(stations);
  });
  
  // Create printer station
  app.post('/api/print/stations', authMiddleware, async (req, res) => {
    const { name, printerType, printerHost, printerPort, printerName, categories, active, printCopy } = req.body;
    const station = await PrinterStation.create({
      name, printerType, printerHost, printerPort, printerName, categories, active, printCopy
    });
    res.json(station);
  });
  
  // Update printer station
  app.put('/api/print/stations/:id', authMiddleware, async (req, res) => {
    const station = await PrinterStation.findByPk(req.params.id);
    if (!station) return res.status(404).json({ error: 'Station not found' });
    await station.update(req.body);
    res.json(station);
  });
  
  // Delete printer station
  app.delete('/api/print/stations/:id', authMiddleware, async (req, res) => {
    const station = await PrinterStation.findByPk(req.params.id);
    if (!station) return res.status(404).json({ error: 'Station not found' });
    await station.destroy();
    res.json({ success: true });
  });
  
  // Get stations for a specific category
  app.get('/api/print/stations/for/:category', authMiddleware, async (req, res) => {
    const { category } = req.params;
    const stations = await PrinterStation.findAll({ 
      where: { active: true },
      order: [['name', 'ASC']]
    });
    // Filter stations that include this category
    const matching = stations.filter(s => {
      const cats = (s.categories || '').split(',').map(c => c.trim().toLowerCase());
      return cats.includes('*') || cats.includes(category.toLowerCase());
    });
    res.json(matching);
  });
  
  // Main print endpoint
  app.post('/api/print/receipt', authMiddleware, async (req, res) => {
    const { orderId, printer: printerName, method } = req.body;
    const order = await Order.findByPk(orderId, {
      include: [
        { model: Staff, as: 'staff' },
        { model: Table },
        { model: OrderItem, include: [{ model: MenuItem }] },
        { model: Payment }
      ]
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Get printer config (use 'method' param to override)
    const config = await getPrinterSettings();
    const printMethod = method || config.type || 'usb';
    
    try {
      if (printMethod === 'network') {
        // Ethernet/Network printing
        const host = req.body.host || config.host;
        const port = req.body.port || config.port || 9100;
        const content = buildReceiptContent(order);
        
        await printViaNetwork(host, port, content);
        console.log(`Printed order #${order.id} via network to ${host}:${port}`);
        return res.json({ success: true, method: 'network', host, port });
        
      } else if (printMethod === 'bluetooth') {
        // Bluetooth handled client-side, but we record the attempt
        return res.json({ 
          success: true, 
          method: 'bluetooth', 
          note: 'Use Web Bluetooth API on client' 
        });
        
      } else {
        // USB printing (default)
        const Printer = require('escpos');
        const device = await Printer.USB.findPrinter(printerName || config.deviceName || 'default');
        const printer = new Printer.USB(device);
        
        printer
          .font('a')
          .align('lt')
          .size(1, 1)
          .text('APEX POS')
          .size(0, 0)
          .text('----------------')
          .text(`Order #${order.id}`)
          .text(`Table: ${order.Table?.number || 'Takeout'}`)
          .text(`Server: ${order.staff?.name || 'N/A'}`)
          .text(`Date: ${new Date(order.createdAt).toLocaleString()}`)
          .text('----------------');
        
        for (const item of order.OrderItems) {
          const qty = item.quantity;
          const name = item.MenuItem?.name || 'Item';
          const price = (item.price + (item.modifierPrice || 0)) * qty / 100;
          printer.text(`${qty}x ${name}`);
          printer.text(`   ${price.toFixed(2)}`);
          if (item.modifiers) {
            const mods = typeof item.modifiers === 'string' ? JSON.parse(item.modifiers) : item.modifiers;
            for (const m of mods) {
              printer.text(`   +${m.name} +$${parseFloat(m.price).toFixed(2)}`);
            }
          }
        }
        
        printer.text('----------------');
        printer.text(`Subtotal: $${order.subtotal.toFixed(2)}`);
        if (order.discount > 0) {
          printer.text(`Discount: -$${order.discount.toFixed(2)}`);
        }
        printer.text(`Tax: $${order.tax.toFixed(2)}`);
        printer.size(1, 1).text(`TOTAL: $${order.total.toFixed(2)}`);
        printer.text('----------------');
        printer.text('Payment: ' + (order.Payments?.[0]?.method || 'N/A'));
        printer.text('');
        printer.text('Thank you!');
        printer.cut().close();
        
        return res.json({ success: true, method: 'usb' });
      }
    } catch (err) {
      console.error('Print error:', err.message);
      res.status(500).json({ error: 'Print failed: ' + err.message });
    }
  });
  
  // Print order to multiple stations (kitchen, bar, etc.)
  app.post('/api/print/order/:orderId', authMiddleware, async (req, res) => {
    const { orderId } = req.params;
    const order = await Order.findByPk(orderId, {
      include: [
        { model: Staff, as: 'staff' },
        { model: Table },
        { model: OrderItem, include: [{ model: MenuItem }] }
      ]
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    // Get all active stations
    const stations = await PrinterStation.findAll({ where: { active: true } });
    const results = [];
    
    for (const station of stations) {
      const categories = (station.categories || '').split(',').map(c => c.trim().toLowerCase());
      const isAllStations = categories.includes('*');
      
      // Get items that match this station's categories
      const matchingItems = (order.OrderItems || []).filter(item => {
        const itemCat = (item.MenuItem?.category || '').toLowerCase();
        return isAllStations || categories.includes(itemCat);
      });
      
      if (matchingItems.length === 0) {
        results.push({ station: station.name, skipped: true, reason: 'no items for category' });
        continue;
      }
      
      // Build a filtered order for this station
      const filteredOrder = { ...order.toJSON(), OrderItems: matchingItems };
      const content = buildKitchenSlip(filteredOrder, station.name);
      
      // Print multiple copies if configured
      for (let i = 0; i < (station.printCopy || 1); i++) {
        const result = await printToStation(station, content);
        results.push(result);
      }
    }
    
    res.json({ orderId: order.id, results });
  });

  app.listen(PORT, () => console.log('Apex POS on ' + PORT));
})();