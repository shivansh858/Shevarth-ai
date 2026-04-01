const express = require('express');
const { getDb } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { getBillWithDetails, validateNoMiscCharges, addBillItem, recalculateBillTotal, createBillVersion } = require('../engines/transparency.engine');
const { computeBillHash } = require('../utils/hash');
const { checkBillManipulation, checkUnbundling } = require('../engines/fraud.engine');
const { notifyPatient } = require('../utils/notifications');

const router = express.Router();

// GET /api/billing/bill/:patientId
router.get('/bill/:patientId', authenticateToken, requireRole('billing', 'admin'), (req, res) => {
  try {
    const bill = getBillWithDetails(parseInt(req.params.patientId));
    if (!bill) return res.status(404).json({ error: 'No bill found for this patient' });
    res.json(bill);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bill' });
  }
});

// PUT /api/billing/edit-item/:itemId
router.put('/edit-item/:itemId', authenticateToken, requireRole('billing'), (req, res) => {
  try {
    const { unit_price, quantity, reason } = req.body;
    const db = getDb();

    const item = db.prepare('SELECT * FROM bill_items WHERE id = ?').get(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Bill item not found' });

    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(item.bill_id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    // Store old values for audit
    const oldValues = { unit_price: item.unit_price, quantity: item.quantity, total_price: item.total_price };

    // Update item
    const newQty = quantity || item.quantity;
    const newPrice = unit_price || item.unit_price;
    const newTotal = newQty * newPrice;
    const varianceFlag = item.benchmark_price && newTotal > item.benchmark_price * 1.10 ? 1 : 0;

    db.prepare(`UPDATE bill_items SET unit_price = ?, quantity = ?, total_price = ?, variance_flag = ? WHERE id = ?`)
      .run(newPrice, newQty, newTotal, varianceFlag, item.id);

    // Recalculate bill
    recalculateBillTotal(item.bill_id);

    // Check for manipulation
    checkBillManipulation(item.bill_id);

    // Audit log
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, 'bill_item_edit', 'bill_item', item.id, JSON.stringify(oldValues), JSON.stringify({ unit_price: newPrice, quantity: newQty, total_price: newTotal, reason }));

    notifyPatient(bill.patient_id, 'bill_update', '📝 Bill Updated',
      `A charge has been updated: ${item.item_name} — ₹${oldValues.total_price} → ₹${newTotal}`);

    res.json({ success: true, old_total: oldValues.total_price, new_total: newTotal });
  } catch (error) {
    console.error('Edit item error:', error);
    res.status(500).json({ error: 'Failed to edit bill item' });
  }
});

// PUT /api/billing/mark-paid/:billId
router.put('/mark-paid/:billId', authenticateToken, requireRole('billing'), (req, res) => {
  try {
    const db = getDb();
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(req.params.billId);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    // Validate no misc charges
    try { validateNoMiscCharges(bill.misc_charges); } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    db.prepare(`UPDATE bills SET payment_status = 'paid', paid_at = datetime('now') WHERE id = ?`).run(bill.id);

    notifyPatient(bill.patient_id, 'payment', '💰 Payment Confirmed',
      `Your hospital bill of ₹${bill.total_amount} has been marked as paid.`);

    // Audit
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)`)
      .run(req.user.id, 'bill_paid', 'bill', bill.id);

    res.json({ success: true, message: 'Bill marked as paid. Auto-discharge check will run.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark bill as paid' });
  }
});

// GET /api/billing/insurance-check/:patientId
router.get('/insurance-check/:patientId', authenticateToken, requireRole('billing', 'admin'), (req, res) => {
  try {
    const db = getDb();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    if (!patient.insurance_provider) {
      return res.json({ has_insurance: false });
    }

    const bill = getBillWithDetails(patient.id);
    const items = bill?.items || [];
    
    // Cross-check treatment codes
    const testOrders = db.prepare('SELECT * FROM test_orders WHERE patient_id = ?').all(patient.id);
    const mismatchedCodes = [];
    
    for (const item of items) {
      const matchingTest = testOrders.find(t => t.test_name === item.item_name);
      if (matchingTest && matchingTest.test_code && item.item_code && matchingTest.test_code !== item.item_code) {
        mismatchedCodes.push({ item: item.item_name, bill_code: item.item_code, test_code: matchingTest.test_code });
      }
    }

    res.json({
      has_insurance: true,
      provider: patient.insurance_provider,
      insurance_id: patient.insurance_id,
      total_amount: bill?.total_amount || 0,
      item_count: items.length,
      code_mismatches: mismatchedCodes,
      flagged_items: items.filter(i => i.variance_flag || i.duplicate_flag).length
    });
  } catch (error) {
    res.status(500).json({ error: 'Insurance check failed' });
  }
});

// GET /api/billing/patients — all patients with bills
router.get('/patients', authenticateToken, requireRole('billing'), (req, res) => {
  try {
    const db = getDb();
    const patients = db.prepare(`
      SELECT p.id, p.name, p.diagnosis, p.state, p.ward_type, p.bed_number,
        b.id as bill_id, b.total_amount, b.payment_status, b.version,
        (SELECT COUNT(*) FROM bill_items WHERE bill_id = b.id AND variance_flag = 1) as flagged_items,
        (SELECT COUNT(*) FROM disputes WHERE patient_id = p.id AND status = 'open') as open_disputes
      FROM patients p
      LEFT JOIN bills b ON p.id = b.patient_id
      WHERE p.state IN ('ADMITTED','READY_SOON','DISCHARGING','DISCHARGED')
      ORDER BY CASE b.payment_status WHEN 'pending' THEN 1 WHEN 'disputed' THEN 2 ELSE 3 END
    `).all();
    res.json(patients);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch billing patients' });
  }
});

module.exports = router;
