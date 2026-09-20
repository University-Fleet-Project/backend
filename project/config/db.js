// config/db.js
const { Pool } = require('pg');

// SQL Database configuration
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'fleet_db',
    password: '1234', // ⚠️ اكتب الباسورد بتاعك هنا
    port: 5432,
});

// Database connection check - Clean English Output Only
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
    } else {
        // السطر ده تم تحويله للإنجليزي تماماً عشان يظهر نظيف في الـ Terminal
        console.log('🔌 PostgreSQL database connected successfully!');
    }
});

module.exports = pool;


