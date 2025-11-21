-- Actualizar contraseña del usuario admin
-- Password: admin123

USE tomodachi_pos;

UPDATE users 
SET password_hash = '$2y$10$.2GrwgJRr/LKmy9ME2AxP.w3ndbOfW8HiHr10ITOXru/9tPoIUNEC'
WHERE username = 'admin';

-- Verificar actualización
SELECT user_id, username, full_name, role, status 
FROM users 
WHERE username = 'admin';
