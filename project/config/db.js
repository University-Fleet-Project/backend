// config/db.js
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' }); // استدعاء مكتبة dotenv لقراءة المتغيرات الأمنية

// إعداد الاتصال الديناميكي المتوافق مع الـ Docker والـ Local setup
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_DATABASE || 'fleet_db',
    password: process.env.DB_PASSWORD || '1234', // القيمة الاحتياطية لو الـ .env مش مقروء
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
});

// فحص الاتصال النظيف للتأكد من تشغيل السيرفر
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
    } else {
        console.log('🔌 PostgreSQL database connected dynamic-ready successfully!');
    }
});

module.exports = pool;
