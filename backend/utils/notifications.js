const { getDb } = require('../db/database');

function createNotification(userId, patientId, type, title, message) {
  const db = getDb();
  db.prepare(`INSERT INTO notifications (user_id, patient_id, type, title, message) VALUES (?, ?, ?, ?, ?)`).run(userId, patientId, type, title, message);
}

function notifyDepartment(department, patientId, type, title, message) {
  const db = getDb();
  const staffMembers = db.prepare('SELECT id FROM users WHERE department = ? AND role != ?').all(department, 'patient');
  for (const staff of staffMembers) {
    createNotification(staff.id, patientId, type, title, message);
  }
}

function notifyPatient(patientId, type, title, message) {
  const db = getDb();
  const patient = db.prepare('SELECT user_id FROM patients WHERE id = ?').get(patientId);
  if (patient) {
    createNotification(patient.user_id, patientId, type, title, message);
  }
}

function notifyRole(role, patientId, type, title, message) {
  const db = getDb();
  const users = db.prepare('SELECT id FROM users WHERE role = ?').all(role);
  for (const u of users) {
    createNotification(u.id, patientId, type, title, message);
  }
}

function getNotifications(userId, limit = 50) {
  const db = getDb();
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
}

function markRead(notificationId, userId) {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notificationId, userId);
}

module.exports = { createNotification, notifyDepartment, notifyPatient, notifyRole, getNotifications, markRead };
