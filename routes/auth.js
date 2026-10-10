const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../db/pool');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 12 * 60 * 60 * 1000 // 12h
};

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Identifiants invalides' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.cookie('token', token, COOKIE_OPTS);
    res.json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Échec de la connexion' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', { ...COOKIE_OPTS, maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ id: payload.id, username: payload.username, role: payload.role });
  } catch {
    res.status(401).json({ error: 'Session invalide ou expirée' });
  }
});

module.exports = router;
