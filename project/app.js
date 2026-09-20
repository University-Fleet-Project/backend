// app.js

const express = require('express');
const app = express();

// 1. استدعاء الموزعات والـ الروابط (Routes) من الفولدرات
const usersRouter = require('./routes/users');
const vehiclesRouter = require('./routes/vehicles');
const reservationsRouter = require('./routes/reservations');
const tripsRouter = require('./routes/trips'); // سطر استدعاء الرحلات المظبوط

// 2. المترجم السحري لقراءة داتا الـ JSON الجاية من الفلاتر
app.use(express.json());

// 3. ربط وبناء بوابات العناوين الرئيسية للسيستم (ترتيب فسيولوجي نظيف)
app.use('/api/users', usersRouter);              // شاشات اللوجن والريجيستر
app.use('/api/vehicles', vehiclesRouter);        // شاشات الكتالوج والتفاصيل
app.use('/api/reservations', reservationsRouter);  // شاشات تقديم الحجز وموافقة المدير
app.use('/api/trips', tripsRouter);              // شاشات السائق وتحديثات العداد

// 4. رابط تجريبي سريع تفتحه من المتصفح للتأكد إن السيرفر قايم
app.get('/', (req, res) => {
    res.send('🚀 University Fleet Management Server is running successfully!');
});

// 🚨 5. معالجة مشكلة العناوين والروابط الخاطئة (404 Page Not Found)
// الترتيب هنا حاسم: لازم تكون تحت البوابات الكبيرة علطول لحمايتها
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

// 🚀 7. تشغيل موتور السيرفر وفتح البوابة 3000 (آخر سطر رسمي في الملف)
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}!`);
});
