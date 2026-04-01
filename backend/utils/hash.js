const crypto = require('crypto');

function computeBillHash(billItems) {
  const sorted = [...billItems].sort((a, b) => a.id - b.id);
  const content = JSON.stringify(sorted.map(item => ({
    id: item.id,
    item_name: item.item_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price
  })));
  return crypto.createHash('sha256').update(content).digest('hex');
}

function verifyBillHash(billItems, expectedHash) {
  const computedHash = computeBillHash(billItems);
  return computedHash === expectedHash;
}

function generateQrToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password + '!1';
}

module.exports = { computeBillHash, verifyBillHash, generateQrToken, generatePassword };
