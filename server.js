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

// --- AUTO-SYNC FOLDER TO DATABASE ---
function syncDatabase() {
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const files = fs.readdirSync(uploadsDir).filter(file => file.match(/\.(jpg|jpeg|png|webp|gif)$/i));
    const db = getDb();
    let updated = false;

    files.forEach(file => {
        // If the file isn't in the database yet, add it!
        const exists = db.find(img => img.filename === file);
        if (!exists) {
            const newId = db.length > 0 ? Math.max(...db.map(img => img.id)) + 1 : 1;
            db.push({ id: newId, filename: file, tags: 'recovered, auto-sync' });
            updated = true;
        }
    });

    if (updated) {
        saveDb(db);
        console.log("Database synced! Found and registered new images.");
    }
}
syncDatabase(); // Run the sync every time the server boots
// --- ENDPOINTS ---

// --- ENDPOINT 1: Scrape & Auto-Save Instagram URL (API Version) ---
app.post('/api/scrape', async (req, res) => {
    const { url, tags } = req.body;
    
    if (!url || !url.includes('instagram.com/p/')) {
        return res.status(400).json({ error: 'Invalid URL. Please use an Instagram post link.' });
    }

    if (!process.env.RAPIDAPI_KEY) {
        return res.status(500).json({ error: 'RAPIDAPI_KEY is missing in Hostinger Environment Variables.' });
    }

    try {
        // 1. Send the URL to your RapidAPI Scraper
        const apiResponse = await fetch('https://cheap-instagram-scraper-api1.p.rapidapi.com/api/check_link', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': 'cheap-instagram-scraper-api1.p.rapidapi.com',
                'x-rapidapi-key': process.env.RAPIDAPI_KEY
            },
            body: JSON.stringify({ url: url }) 
        });

        const data = await apiResponse.json();

        // 2. The "Recursive Extractor" - Hunts through the JSON object for image links
        let rawImages = [];
        
        function findImageUrls(obj) {
            for (let key in obj) {
                if (typeof obj[key] === 'string') {
                    // Look for strings that are web links and contain image markers
                    if (obj[key].startsWith('http') && (obj[key].includes('.jpg') || obj[key].includes('.webp') || obj[key].includes('scontent'))) {
                        rawImages.push(obj[key]);
                    }
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    // If it's a nested folder, dig deeper
                    findImageUrls(obj[key]);
                }
            }
        }
        
        findImageUrls(data); // Start the hunt

        // Clean up escaped slashes, remove duplicates, and filter out tiny thumbnails
        let finalImages = [...new Set(rawImages)]
            .map(url => url.replace(/\\\//g, '/')) 
            .filter(img => !img.includes('150x150') && !img.includes('profile_pic') && !img.includes('e35/c'));

        if (finalImages.length === 0) {
            console.error("API Response data:", data); // Logs to Hostinger if the API changes its format
            return res.status(404).json({ error: 'No high-res images found in the API response.' });
        }

        // 3. Download the images and save them to the JSON Database
        const finalTags = tags ? `instagram, scraped, ${tags.toLowerCase()}` : 'instagram, scraped';
        const savedImages = [];
        const db = getDb();

        for (let i = 0; i < finalImages.length; i++) {
            const imgUrl = finalImages[i];
            const ext = imgUrl.includes('.webp') ? '.webp' : '.jpg';
            
            // Rebranded filename format!
            const filename = `obsession-ig-${Date.now()}-${i}${ext}`; 
            const filePath = path.join(__dirname, 'public', 'uploads', filename);

            try {
                // Download image using Node 20's native fetch
                const imgRes = await fetch(imgUrl);
                if (!imgRes.ok) throw new Error('Failed to download image from API link');
                
                const buffer = await imgRes.arrayBuffer();
                fs.writeFileSync(filePath, Buffer.from(buffer));

                // Register to database
                const newId = db.length > 0 ? Math.max(...db.map(img => img.id)) + 1 : 1;
                db.push({ id: newId, filename: filename, tags: finalTags });
                savedImages.push({ filename: filename });

            } catch (err) {
                console.error('Failed to auto-save image:', err);
            }
        }
        
        saveDb(db); // Commit changes to gallery.json
        res.json({ images: savedImages });

    } catch (error) {
        console.error('Scrape error:', error);
        res.status(500).json({ error: 'API Scrape failed. Check Hostinger logs.' });
    }
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