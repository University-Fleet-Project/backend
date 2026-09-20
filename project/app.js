// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors'); // استدعاء مكتبة فتح الحماية للأجهزة الخارجية
const app = express();

// تفعيل الـ CORS عشان جهاز عبد الرحمن يقدر يسحب داتا من جهازك علطول
app.use(cors());

// 1. استدعاء الموزعات والروابط (Routes) من الفولدرات
const usersRouter = require('./routes/users');
const vehiclesRouter = require('./routes/vehicles');
const reservationsRouter = require('./routes/reservations');
const tripsRouter = require('./routes/trips');

// 2. المترجم السحري لقراءة داتا الـ JSON الجاية من الفلاتر
app.use(express.json());

// 3. ربط وبناء بوابات العناوين الرئيسية للسيستم
app.use('/api/users', usersRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/trips', tripsRouter);

// 4. رابط تجريبي سريع للتأكد إن السيرفر قايم
app.get('/', (req, res) => {
    res.send('🚀 University Fleet Management Server is running successfully!');
});

// 🚨 5. معالجة مشكلة العناوين والروابط الخاطئة (404 Page Not Found)
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        error: 'URL not found! Please check the endpoint path.'
    });
});

// 💥 6. شبكة الأمان الكبرى لمعالجة أي خطأ مفاجئ داخل السيرفر (500 Server Error)
app.use((err, req, res, next) => {
    console.error('🔥 Global Error Caught:', err.message);
    res.status(500).json({
        success: false,
        error: 'Internal Server Error! Something went wrong on the backend.'
    });
});

// 🚀 7. تشغيل موتور السيرفر وفتح البوابة 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}!`);
});
