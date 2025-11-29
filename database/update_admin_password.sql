-- Actualizar contraseña del usuario admin
-- Password: admin123

USE tomodachi_pos;

UPDATE users 
SET password_hash = '$2y$10$rDGCkOinf6RJ2ywtMU6QYeeTNkqq4/soMpsxdF4wO9lqIRTrjfP2a'
WHERE username = 'admin';

-- Verificar actualización
SELECT user_id, username, full_name, role, status 
FROM users 
WHERE username = 'admin';
