require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

async function main() {
  const [username, password, role = 'staff'] = process.argv.slice(2);
  if (!username || !password) {
    console.log('Usage: node scripts/createUser.js <username> <password> [role]');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO users (username, password_hash, role)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role)`,
    [username, hash, role]
  );

  console.log(`User "${username}" created/updated with role "${role}".`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
