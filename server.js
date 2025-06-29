const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Створити папку для завантажених файлів
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Налаштування multer для завантаження файлів
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueName = uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|mp3|wav|ogg|m4a/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb('Error: Дозволені тільки зображення та аудіо файли!');
        }
    }
});

// Зберігання даних в пам'яті (в реальному проекті краще використовувати БД)
let wallData = {
    elements: []
};

// Статичні файли
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));
app.use(express.json({ limit: '50mb' }));

// Головна сторінка
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API для завантаження файлів
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не завантажено' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const { x, y, type } = req.body;

    const element = {
        id: uuidv4(),
        type: type,
        src: fileUrl,
        x: parseFloat(x),
        y: parseFloat(y),
        timestamp: Date.now(),
        filename: req.file.filename
    };

    wallData.elements.push(element);
    
    // Повідомити всіх користувачів про новий елемент
    io.emit('element-added', element);
    
    res.json({ success: true, element });
});

// API для видалення елементів
app.delete('/api/element/:id', (req, res) => {
    const { id } = req.params;
    const elementIndex = wallData.elements.findIndex(el => el.id === id);
    
    if (elementIndex === -1) {
        return res.status(404).json({ error: 'Елемент не знайдено' });
    }

    const element = wallData.elements[elementIndex];
    
    // Видалити файл з диска
    if (element.filename) {
        const filePath = path.join(uploadsDir, element.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
    
    wallData.elements.splice(elementIndex, 1);
    
    // Повідомити всіх користувачів про видалення
    io.emit('element-deleted', { id });
    
    res.json({ success: true });
});

// API для збереження фото з камери
app.post('/api/capture', (req, res) => {
    const { imageData, x, y } = req.body;
    
    if (!imageData) {
        return res.status(400).json({ error: 'Дані зображення відсутні' });
    }

    // Конвертувати base64 в файл
    const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
    const filename = uuidv4() + '.png';
    const filepath = path.join(uploadsDir, filename);
    
    fs.writeFileSync(filepath, base64Data, 'base64');

    const element = {
        id: uuidv4(),
        type: 'image',
        src: `/uploads/${filename}`,
        x: parseFloat(x),
        y: parseFloat(y),
        timestamp: Date.now(),
        filename: filename
    };

    wallData.elements.push(element);
    
    // Повідомити всіх користувачів про новий елемент
    io.emit('element-added', element);
    
    res.json({ success: true, element });
});

// API для отримання всіх елементів
app.get('/api/elements', (req, res) => {
    res.json(wallData);
});

// Socket.io подключення
io.on('connection', (socket) => {
    console.log('Користувач підключився:', socket.id);
    
    // Відправити поточні дані новому користувачу
    socket.emit('wall-data', wallData);
    
    // Повідомити інших про нового користувача
    socket.broadcast.emit('user-connected', { 
        id: socket.id,
        timestamp: Date.now()
    });

    // Обробка відключення
    socket.on('disconnect', () => {
        console.log('Користувач відключився:', socket.id);
        socket.broadcast.emit('user-disconnected', { 
            id: socket.id,
            timestamp: Date.now()
        });
    });

    // Обробка курсору користувача (опціонально)
    socket.on('cursor-move', (data) => {
        socket.broadcast.emit('user-cursor', {
            id: socket.id,
            x: data.x,
            y: data.y
        });
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Сервер запущено на порту ${PORT}`);
    if (process.env.NODE_ENV === 'production') {
        console.log(`Додаток доступний в продакшн режимі`);
    } else {
        console.log(`Відкрийте http://localhost:${PORT} у браузері`);
    }
}); 