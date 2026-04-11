const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// SQLite DB stored in the data folder
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'data', 'apexpos.db'),
  logging: false,
});

// Staff model with bcrypt pin hash
const Staff = sequelize.define('Staff', {
  name: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('owner','manager','server'), allowNull: false },
  pinHash: { type: DataTypes.STRING, allowNull: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true }
});

// Menu item model with stock tracking
const MenuItem = sequelize.define('MenuItem', {
  name: { type: DataTypes.STRING, allowNull: false },
  category: DataTypes.STRING,
  price: { type: DataTypes.FLOAT, allowNull: false },
  description: DataTypes.TEXT,
  popular: { type: DataTypes.BOOLEAN, defaultValue: false },
  spicy: { type: DataTypes.BOOLEAN, defaultValue: false },
  image: DataTypes.STRING,
  stock: { type: DataTypes.INTEGER, defaultValue: 100 }, // inventory count
  lowStockThreshold: { type: DataTypes.INTEGER, defaultValue: 10 }
});

// Menu modifiers (extras like extra cheese, size, etc.)
const MenuModifier = sequelize.define('MenuModifier', {
  name: { type: DataTypes.STRING, allowNull: false },
  price: { type: DataTypes.FLOAT, defaultValue: 0 },
  category: DataTypes.STRING // e.g., 'size', 'extras', 'spice-level'
});

// Modifier linked to menu item
MenuItem.hasMany(MenuModifier, { as: 'modifiers', foreignKey: 'menuItemId' });
MenuModifier.belongsTo(MenuItem, { foreignKey: 'menuItemId' });

// Table model
const Table = sequelize.define('Table', {
  number: { type: DataTypes.INTEGER, unique: true, allowNull: false },
  capacity: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.ENUM('available','occupied','reserved'), defaultValue: 'available' },
});

// Order model
const Order = sequelize.define('Order', {
  orderType: { type: DataTypes.ENUM('dinein','takeout'), defaultValue: 'dinein' },
  subtotal: { type: DataTypes.FLOAT, defaultValue: 0 },
  tax: { type: DataTypes.FLOAT, defaultValue: 0 },
  discount: { type: DataTypes.FLOAT, defaultValue: 0 },
  tip: { type: DataTypes.FLOAT, defaultValue: 0 },
  total: { type: DataTypes.FLOAT, defaultValue: 0 },
  status: { type: DataTypes.ENUM('open','paid','canceled'), defaultValue: 'open' },
  StaffId: { type: DataTypes.INTEGER } // who created the order
});

// OrderItem model – line items per order
const OrderItem = sequelize.define('OrderItem', {
  quantity: { type: DataTypes.INTEGER, allowNull: false },
  price: { type: DataTypes.FLOAT, allowNull: false }, // price per unit at time of order
  modifiers: { type: DataTypes.TEXT }, // JSON string of selected modifiers
  modifierQty: { type: DataTypes.TEXT }, // JSON string of modifier quantities
  remarks: { type: DataTypes.TEXT } // customer special requests
});

// Associations
Table.hasMany(Order);
Order.belongsTo(Table);

Staff.hasMany(Order);
Order.belongsTo(Staff);

Order.hasMany(OrderItem, { as: 'items', foreignKey: 'orderId' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId' });

MenuItem.hasMany(OrderItem, { foreignKey: 'menuItemId' });
OrderItem.belongsTo(MenuItem, { foreignKey: 'menuItemId' });

// Payment model
const Payment = sequelize.define('Payment', {
  amount: { type: DataTypes.FLOAT, allowNull: false },
  tip: { type: DataTypes.FLOAT, defaultValue: 0 },
  method: { type: DataTypes.ENUM('stripe','zelle','cash'), allowNull: false },
  status: { type: DataTypes.ENUM('pending','completed','failed'), defaultValue: 'pending' },
  transactionId: DataTypes.STRING // external payment reference
});

Order.hasMany(Payment, { as: 'payments', foreignKey: 'orderId' });
Payment.belongsTo(Order, { foreignKey: 'orderId' });

// Settings model (key-value store)
const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING, unique: true, allowNull: false },
  value: { type: DataTypes.TEXT },
  category: { type: DataTypes.STRING, defaultValue: 'general' }
});

// PrinterStation model (printer configurations for different stations)
const PrinterStation = sequelize.define('PrinterStation', {
  name: { type: DataTypes.STRING, allowNull: false }, // e.g., 'Kitchen', 'Bar', 'Receipt'
  printerType: { type: DataTypes.ENUM('network','usb','bluetooth'), defaultValue: 'network' },
  printerHost: DataTypes.STRING, // IP for network printer
  printerPort: { type: DataTypes.INTEGER, defaultValue: 9100 },
  printerName: DataTypes.STRING, // USB device name
  categories: { type: DataTypes.TEXT, defaultValue: '' }, // comma-separated: 'meal,appetizer' or '*' for all
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  printCopy: { type: DataTypes.INTEGER, defaultValue: 1 } // number of copies
});

// Employee model (extended staff)
const Employee = sequelize.define('Employee', {
  name: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('owner','manager','server','kitchen'), allowNull: false },
  pinHash: { type: DataTypes.STRING, allowNull: false },
  hourlyRate: { type: DataTypes.FLOAT, defaultValue: 15 },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  hireDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// Shift model (track employee hours)
const Shift = sequelize.define('Shift', {
  EmployeeId: { type: DataTypes.INTEGER, allowNull: false },
  startTime: { type: DataTypes.DATE, allowNull: false },
  endTime: DataTypes.DATE,
  totalHours: { type: DataTypes.FLOAT, defaultValue: 0 },
  tips: { type: DataTypes.FLOAT, defaultValue: 0 },
  salesTotal: { type: DataTypes.FLOAT, defaultValue: 0 }, // total sales handled
  notes: DataTypes.TEXT
});

Employee.hasMany(Shift, { foreignKey: 'EmployeeId' });
Shift.belongsTo(Employee, { foreignKey: 'EmployeeId' });

module.exports = {
  sequelize,
  Staff,
  MenuItem,
  MenuModifier,
  Table,
  Order,
  OrderItem,
  Payment,
  Setting,
  Employee,
  Shift,
  PrinterStation
};