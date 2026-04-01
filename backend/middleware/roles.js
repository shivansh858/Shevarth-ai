function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}` });
    }
    next();
  };
}

function requireSelfOrRole(patientIdParam, ...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (roles.includes(req.user.role)) {
      return next();
    }
    // For patient role, verify they can only access their own data
    if (req.user.role === 'patient') {
      const { getDb } = require('../db/database');
      const db = getDb();
      const patient = db.prepare('SELECT id FROM patients WHERE user_id = ?').get(req.user.id);
      const requestedId = parseInt(req.params[patientIdParam] || req.body.patient_id || req.query.patient_id);
      if (patient && patient.id === requestedId) {
        return next();
      }
    }
    return res.status(403).json({ error: 'Access denied' });
  };
}

module.exports = { requireRole, requireSelfOrRole };
