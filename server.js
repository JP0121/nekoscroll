require('dotenv').config();
const express = require('express');
const https = require('https');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const basicAuth = require('express-basic-auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- SECURITY SHIELD ---
const authMiddleware = basicAuth({
    users: { [process.env.ADMIN_USERNAME]: process.env.ADMIN_PASSWORD },
    challenge: true,
    unauthorizedResponse: 'Access Denied: Authorized personnel only.'
});

app.use((req, res, next) => {
    if (req.path === '/admin.html') return authMiddleware(req, res, next);
    next();
});

app.use('/api/upload', authMiddleware);
app.use('/api/admin/images', authMiddleware);
app.use('/api/delete', authMiddleware);
app.use('/api/update', authMiddleware); 

app.use(express.static('public'));

// --- PURE JS JSON DATABASE (Crash-Proof) ---
const dbPath = path.join(__dirname, 'gallery.json');

// Helper function to read/write to the JSON file safely
function getDb() {
    if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify([]));
    return JSON.parse(fs.readFileSync(dbPath));
}
function saveDb(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

// --- UPLOAD SETUP ---
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: function(req, file, cb) {
        cb(null, 'neko-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- ENDPOINTS ---

// The scraper is temporarily disabled to prevent Hostinger crashes
app.post('/api/scrape', async (req, res) => {
    res.status(500).json({ error: 'Puppeteer blocked by Hostinger. Upgrade to API Scraper required.' });
});

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const tags = req.body.tags ? req.body.tags.toLowerCase() : '';
    const filename = req.file.filename;

    const db = getDb();
    const newId = db.length > 0 ? Math.max(...db.map(img => img.id)) + 1 : 1;
    db.push({ id: newId, filename, tags });
    saveDb(db);
    
    res.status(200).send('Success');
});

app.get('/api/search', (req, res) => {
    const query = req.query.q.toLowerCase().trim();
    const keywords = query.split(/\s+/);
    
    const db = getDb();
    const results = db.filter(img => {
        return keywords.every(kw => img.tags && img.tags.toLowerCase().includes(kw));
    }).sort((a, b) => b.id - a.id);
    
    res.json({ images: results });
});

app.get('/api/gallery', (req, res) => {
    const db = getDb();
    const results = db.sort((a, b) => b.id - a.id).slice(0, 30);
    res.json({ images: results });
});

app.get('/api/admin/images', (req, res) => {
    const db = getDb();
    const results = db.sort((a, b) => b.id - a.id);
    res.json({ images: results });
});

app.put('/api/update/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const newTags = req.body.tags.toLowerCase();

    const db = getDb();
    const index = db.findIndex(img => img.id === id);
    if (index !== -1) {
        db[index].tags = newTags;
        saveDb(db);
        res.json({ message: 'Tags updated successfully!' });
    } else {
        res.status(404).json({ error: 'Image not found' });
    }
});

app.delete('/api/delete/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const db = getDb();
    const index = db.findIndex(img => img.id === id);
    
    if (index !== -1) {
        const filename = db[index].filename;
        db.splice(index, 1);
        saveDb(db);
        
        const filePath = path.join(__dirname, 'public', 'uploads', filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.json({ message: 'Image deleted successfully!' });
    } else {
        res.status(404).json({ error: 'Image not found' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));