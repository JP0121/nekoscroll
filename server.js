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

// --- ENDPOINT 1: Scrape & Auto-Save Instagram URL (Enterprise Apify Version) ---
app.post('/api/scrape', async (req, res) => {
    const { url, tags } = req.body;
    
    if (!url || !url.includes('instagram.com/p/')) {
        return res.status(400).json({ error: 'Invalid URL. Please use an Instagram post link.' });
    }

    // --- NEW: THE SMART CACHE ---
    // 1. Clean the URL (Removes tracking tags so we can accurately check for duplicates)
    const cleanUrl = url.split('?')[0]; 
    
    // 2. Check the database before hitting Apify
    const db = getDb();
    const existingImages = db.filter(img => img.source_url === cleanUrl);

    if (existingImages.length > 0) {
        console.log("Post already scraped! Loading from local database to save Apify credits.");
        return res.json({ images: existingImages }); // Instantly returns your saved photos!
    }
    // ----------------------------

    if (!process.env.APIFY_TOKEN) {
        return res.status(500).json({ error: 'APIFY_TOKEN is missing in Hostinger Environment Variables.' });
    }

    try {
        // Send the URL to Apify
        const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`;
        
        const apiResponse = await fetch(apifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                directUrls: [url],
                resultsType: "details",
                searchType: "hashtag" 
            }) 
        });

        const data = await apiResponse.json();

        // The Recursive Extractor
        let rawImages = [];
        function findImageUrls(obj) {
            for (let key in obj) {
                if (typeof obj[key] === 'string') {
                    if (obj[key].startsWith('http') && (obj[key].includes('.jpg') || obj[key].includes('.webp') || obj[key].includes('scontent'))) {
                        rawImages.push(obj[key]);
                    }
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    findImageUrls(obj[key]);
                }
            }
        }
        findImageUrls(data);

        let finalImages = [...new Set(rawImages)]
            .map(url => url.replace(/\\\//g, '/')) 
            .filter(img => !img.includes('150x150') && !img.includes('profile_pic') && !img.includes('e35/c'));

        if (finalImages.length === 0) {
            console.error("Apify Data Dump:", JSON.stringify(data).substring(0, 500)); 
            return res.status(404).json({ error: 'Apify ran successfully, but found no high-res images.' });
        }

        // Download and save
        const finalTags = tags ? `instagram, scraped, ${tags.toLowerCase()}` : 'instagram, scraped';
        const savedImages = [];

        for (let i = 0; i < finalImages.length; i++) {
            const imgUrl = finalImages[i];
            const ext = imgUrl.includes('.webp') ? '.webp' : '.jpg';
            const filename = `obsession-ig-${Date.now()}-${i}${ext}`; 
            const filePath = path.join(__dirname, 'public', 'uploads', filename);

            try {
                const imgRes = await fetch(imgUrl);
                if (!imgRes.ok) throw new Error('Failed to download image from Apify link');
                
                const buffer = await imgRes.arrayBuffer();
                fs.writeFileSync(filePath, Buffer.from(buffer));

                const newId = db.length > 0 ? Math.max(...db.map(img => img.id)) + 1 : 1;
                
                // --- NEW: Add the cleanUrl to the database so we remember it later ---
                db.push({ id: newId, filename: filename, tags: finalTags, source_url: cleanUrl });
                savedImages.push({ filename: filename });

            } catch (err) {
                console.error('Failed to auto-save image:', err);
            }
        }
        
        saveDb(db); 
        res.json({ images: savedImages });

    } catch (error) {
        console.error('Apify Scrape error:', error);
        res.status(500).json({ error: 'Apify Scrape failed. Check Hostinger logs.' });
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