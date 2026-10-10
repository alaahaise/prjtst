-- ============================================================
-- Auth: users table (new)
-- Create your first user after running this schema with:
--   node scripts/createUser.js admin your_password admin
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'staff',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- NOTE: your original schema (raw_materials, finished_products,
-- recipes, purchases, production, sales, adjustments, movements,
-- packaging, etc.) is unchanged and goes below this line exactly
-- as it was — only the users table above is new.
-- ============================================================
