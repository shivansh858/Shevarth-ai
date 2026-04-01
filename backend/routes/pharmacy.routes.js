const express = require('express');
const { getDb } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { checkMedicineOvercharge } = require('../engines/fraud.engine');
const { addBillItem } = require('../engines/transparency.engine');
const { notifyPatient } = require('../utils/notifications');

const router = express.Router();

// GET /api/pharmacy/tasks
router.get('/tasks', authenticateToken, requireRole('pharmacy'), (req, res) => {
  try {
    const db = getDb();
    
    // Pending discharge tasks for pharmacy
    const dischargeTasks = db.prepare(`
      SELECT dt.*, p.name as patient_name, p.diagnosis, p.bed_number
      FROM discharge_tasks dt
      JOIN patients p ON dt.patient_id = p.id
      WHERE dt.department = 'Pharmacy' AND dt.status = 'pending'
    `).all();

    // Medicine catalog with pricing
    const medicines = db.prepare(`
      SELECT mc.*, mc2.name as generic_alternative, mc2.nppa_ceiling_price as generic_price
      FROM medicine_catalog mc
      LEFT JOIN medicine_catalog mc2 ON mc.generic_equivalent_id = mc2.id
      ORDER BY mc.name
    `).all();

    // Recent dispense log
    const recentDispenses = db.prepare(`
      SELECT mdl.*, mc.name as med_name, p.name as patient_name, mc.nppa_ceiling_price
      FROM medicine_dispense_log mdl
      JOIN medicine_catalog mc ON mdl.medicine_id = mc.id
      JOIN patients p ON mdl.patient_id = p.id
      ORDER BY mdl.dispensed_at DESC
      LIMIT 50
    `).all();

    // Active patients
    const patients = db.prepare(`
      SELECT id, name, diagnosis, bed_number, ward_type
      FROM patients WHERE state IN ('ADMITTED','READY_SOON','DISCHARGING')
    `).all();

    res.json({ discharge_tasks: dischargeTasks, medicines, recent_dispenses: recentDispenses, patients });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pharmacy data' });
  }
});

// POST /api/pharmacy/dispense
router.post('/dispense', authenticateToken, requireRole('pharmacy'), (req, res) => {
  try {
    const { patient_id, medicine_id, quantity } = req.body;
    if (!patient_id || !medicine_id || !quantity) {
      return res.status(400).json({ error: 'Patient ID, medicine ID, and quantity required' });
    }

    const db = getDb();
    const medicine = db.prepare(`
      SELECT mc.*, mc2.name as generic_name_alt, mc2.nppa_ceiling_price as generic_price, mc2.id as generic_id
      FROM medicine_catalog mc
      LEFT JOIN medicine_catalog mc2 ON mc.generic_equivalent_id = mc2.id
      WHERE mc.id = ?
    `).get(medicine_id);

    if (!medicine) return res.status(404).json({ error: 'Medicine not found' });

    const varianceAmount = medicine.nppa_ceiling_price ? 
      (medicine.hospital_rate - medicine.nppa_ceiling_price) * quantity : 0;
    const isOvercharge = medicine.nppa_ceiling_price && medicine.hospital_rate > medicine.nppa_ceiling_price * 1.10;

    const result = db.prepare(`
      INSERT INTO medicine_dispense_log (patient_id, medicine_id, quantity, unit_price_charged, nppa_price, variance_amount, generic_offered, dispensed_by, overcharge_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patient_id, medicine_id, quantity, medicine.hospital_rate,
      medicine.nppa_ceiling_price, varianceAmount,
      medicine.generic_equivalent_id ? 1 : 0,
      req.user.id, isOvercharge ? 1 : 0
    );

    // Check overcharge fraud
    if (isOvercharge) {
      checkMedicineOvercharge(result.lastInsertRowid);
    }

    // Add to bill
    const bill = db.prepare('SELECT id FROM bills WHERE patient_id = ?').get(patient_id);
    if (bill) {
      addBillItem(bill.id, {
        item_name: medicine.name,
        unit_price: medicine.hospital_rate,
        quantity,
        benchmark_price: (medicine.nppa_ceiling_price || medicine.cghs_rate || 0) * quantity,
        item_code: `MED-${medicine_id}`
      }, req.user.id);
    }

    res.json({
      id: result.lastInsertRowid,
      medicine: medicine.name,
      charged: medicine.hospital_rate * quantity,
      nppa_total: (medicine.nppa_ceiling_price || 0) * quantity,
      overcharge: isOvercharge,
      markup_pct: medicine.markup_percentage,
      generic_available: !!medicine.generic_equivalent_id,
      generic_name: medicine.generic_name_alt,
      generic_price: medicine.generic_price
    });
  } catch (error) {
    console.error('Dispense error:', error);
    res.status(500).json({ error: 'Failed to dispense medicine' });
  }
});

// PUT /api/pharmacy/confirm-task/:taskId
router.put('/confirm-task/:taskId', authenticateToken, requireRole('pharmacy'), (req, res) => {
  try {
    const db = getDb();
    const task = db.prepare('SELECT * FROM discharge_tasks WHERE id = ? AND department = ?').get(req.params.taskId, 'Pharmacy');
    if (!task) return res.status(404).json({ error: 'Task not found' });

    db.prepare(`UPDATE discharge_tasks SET status = 'complete', completed_at = datetime('now'), completed_by = ? WHERE id = ?`)
      .run(req.user.id, task.id);

    notifyPatient(task.patient_id, 'task_complete', '💊 Pharmacy Clearance Complete',
      'All medicines have been reconciled for your discharge.');

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to confirm task' });
  }
});

module.exports = router;
