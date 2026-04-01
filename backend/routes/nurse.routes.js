const express = require('express');
const { getDb } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { notifyPatient } = require('../utils/notifications');

const router = express.Router();

// GET /api/nurse/tasks — pending discharge tasks
router.get('/tasks', authenticateToken, requireRole('nurse'), (req, res) => {
  try {
    const db = getDb();
    const tasks = db.prepare(`
      SELECT dt.*, p.name as patient_name, p.diagnosis, p.bed_number, p.ward_type, p.state as patient_state,
        u.name as doctor_name
      FROM discharge_tasks dt
      JOIN patients p ON dt.patient_id = p.id
      LEFT JOIN users u ON p.doctor_id = u.id
      WHERE dt.department = 'Nursing' AND dt.status = 'pending'
      ORDER BY dt.created_at ASC
    `).all();

    // Also get all patients needing vitals
    const admittedPatients = db.prepare(`
      SELECT p.*, u.name as doctor_name
      FROM patients p
      LEFT JOIN users u ON p.doctor_id = u.id
      WHERE p.state IN ('ADMITTED', 'READY_SOON', 'DISCHARGING')
      ORDER BY p.state, p.admission_date
    `).all();

    res.json({ discharge_tasks: tasks, patients: admittedPatients });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch nurse tasks' });
  }
});

// PUT /api/nurse/complete-discharge/:taskId
router.put('/complete-discharge/:taskId', authenticateToken, requireRole('nurse'), (req, res) => {
  try {
    const db = getDb();
    const task = db.prepare('SELECT * FROM discharge_tasks WHERE id = ? AND department = ?').get(req.params.taskId, 'Nursing');
    if (!task) return res.status(404).json({ error: 'Task not found' });

    db.prepare(`UPDATE discharge_tasks SET status = 'complete', completed_at = datetime('now'), completed_by = ? WHERE id = ?`)
      .run(req.user.id, task.id);

    notifyPatient(task.patient_id, 'task_complete', '✅ Clinical Clearance Complete',
      'Nursing has completed your clinical clearance for discharge.');

    // Audit
    db.prepare(`INSERT INTO audit_log (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)`)
      .run(req.user.id, 'discharge_task_complete', 'discharge_task', task.id);

    res.json({ success: true, message: 'Clinical clearance marked complete' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

module.exports = router;
