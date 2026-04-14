require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const https = require('https');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const basicAuth = require('express-basic-auth');

// Initialize the Hugging Face AI Brain
const { HfInference } = require('@huggingface/inference');
const hf = new HfInference(process.env.HF_TOKEN);

puppeteer.use(StealthPlugin());
const app = express();
const PORT = 3000;

app.use(express.json());

// --- SECURITY SHIELD ---
const authMiddleware = basicAuth({
    users: { [process.env.ADMIN_USERNAME]: process.env.ADMIN_PASSWORD },
    challenge: true,
    unauthorizedResponse: 'Access Denied: Authorized personnel only.'
});

app.use((req, res, next) => {
    if (req.path === '/admin.html') {
        return authMiddleware(req, res, next);
    }
    next();
});

app.use('/api/upload', authMiddleware);
app.use('/api/admin/images', authMiddleware);
app.use('/api/delete', authMiddleware);
app.use('/api/update', authMiddleware); 

app.use(express.static('public'));

// --- DATABASE SETUP ---
const db = new sqlite3.Database('./gallery.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        tags TEXT
    )`);
});

// --- UPLOAD SETUP ---
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: function(req, file, cb) {
        cb(null, 'neko-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });


// --- ENDPOINT 1: Scrape & Auto-Save Instagram URL ---
app.post('/api/scrape', async (req, res) => {
    const { url, tags } = req.body; // <-- NEW: Grabbing tags from the frontend
    if (!url || !url.includes('instagram.com/p/')) return res.status(400).json({ error: 'Invalid URL.' });

    let browser;
    try {
        browser = await puppeteer.launch({ headless: false });
        const page = await browser.newPage();
        const imageUrls = new Set();

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 6000)); 

        const extractVisualImages = async () => {
            return await page.evaluate(() => {
                const urls = new Set();
                document.querySelectorAll('img').forEach(img => {
                    const isGridLink = img.closest('a') !== null;
                    const rect = img.getBoundingClientRect();
                    if (!isGridLink && (rect.width > 250 || img.naturalWidth > 250)) {
                        let bestUrl = img.src;
                        if (img.srcset) {
                            const srcsetParts = img.srcset.split(',');
                            const highestRes = srcsetParts[srcsetParts.length - 1].trim().split(' ')[0];
                            if (highestRes) bestUrl = highestRes;
                        }
                        if (bestUrl) urls.add(bestUrl);
                    }
                });
                return Array.from(urls);
            });
        };

        let currentImages = await extractVisualImages();
        currentImages.forEach(url => imageUrls.add(url));

        let clickCount = 0;
        while (clickCount < 10) { 
            const clicked = await page.evaluate(() => {
                const btn = document.querySelector('button[aria-label="Next"]');
                if (btn) { btn.click(); return true; }
                return false;
            });
            if (clicked) {
                await new Promise(r => setTimeout(r, 1500)); 
                currentImages = await extractVisualImages();
                currentImages.forEach(url => imageUrls.add(url));
                clickCount++;
            } else break;
        }
        await browser.close();

        const finalImages = Array.from(imageUrls);
        if (finalImages.length === 0) return res.status(404).json({ error: 'No images found.' });

        // --- MERGE FRONTEND TAGS ---
        const finalTags = tags ? `instagram, scraped, ${tags.toLowerCase()}` : 'instagram, scraped';

        const savedImages = [];
        for (let i = 0; i < finalImages.length; i++) {
            const imgUrl = finalImages[i];
            const ext = imgUrl.includes('.webp') ? '.webp' : '.jpg';
            const filename = `neko-ig-${Date.now()}-${i}${ext}`;
            const filePath = path.join(__dirname, 'public', 'uploads', filename);

            try {
                await new Promise((resolve, reject) => {
                    https.get(imgUrl, (response) => {
                        if (response.statusCode !== 200) return reject('Download failed');
                        const fileStream = fs.createWriteStream(filePath);
                        response.pipe(fileStream);
                        fileStream.on('finish', () => resolve());
                    }).on('error', reject);
                });

                await new Promise((resolve) => {
                    // Logs the merged tags into the database
                    db.run(`INSERT INTO images (filename, tags) VALUES (?, ?)`, [filename, finalTags], () => resolve());
                });

                savedImages.push({ filename: filename });
            } catch (err) {
                console.error('Failed to auto-save image:', err);
            }
        }

        res.json({ images: savedImages });
    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ error: 'Scrape failed.' });
    }
});

// --- ENDPOINT 2: Force Download ---
app.get('/api/download', (req, res) => {
    const imageUrl = req.query.url;
    let fileName = req.query.filename || 'instagram_image'; 
    if (!imageUrl) return res.status(400).send('No URL provided');

    const isWebp = imageUrl.includes('.webp');
    const extension = isWebp ? '.webp' : '.jpg';
    const contentType = isWebp ? 'image/webp' : 'image/jpeg';
    fileName = fileName.replace(/\.jpg$|\.webp$/i, '');
    
    https.get(imageUrl, (response) => {
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}${extension}"`);
        res.setHeader('Content-Type', contentType);
        response.pipe(res);
    }).on('error', () => res.status(500).send('Error downloading image'));
});

// --- ENDPOINT 3: Upload Image & AI Auto-Tagging ---
app.post('/api/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    
    let manualTags = req.body.tags ? req.body.tags.toLowerCase().split(',').map(t => t.trim()) : [];
    const filename = req.file.filename;
    const filePath = path.join(__dirname, 'public', 'uploads', filename);

    let aiTags = [];
    
    try {
        console.log("Sending image to AI brain...");
        const imageBuffer = fs.readFileSync(filePath);

        // Switched to a more widely available free-tier model
        const aiResult = await hf.imageToText({
            data: imageBuffer,
            model: 'nlpconnect/vit-gpt2-image-captioning'
        });

        if (aiResult && aiResult.generated_text) {
            console.log("AI says:", aiResult.generated_text);
            
            aiTags = aiResult.generated_text
                .toLowerCase()
                .replace(/[^a-z\s]/g, "") 
                .split(' ') 
                .filter(word => word.length > 3); 
        }
    } catch (err) {
        // Log the full error to help us debug if the model is still down
        console.error('AI Error Details:', err.message);
        console.log('Falling back to manual tags only.');
    }

    const combinedTagsArray = manualTags.concat(aiTags);
    const finalTags = [...new Set(combinedTagsArray)].filter(Boolean).join(', ');

    db.run(`INSERT INTO images (filename, tags) VALUES (?, ?)`, [filename, finalTags], function(err) {
        if (err) return res.status(500).send('Database error');
        res.status(200).send('Success');
    });
});

// --- ENDPOINT 4: Search Database ---
app.get('/api/search', (req, res) => {
    const query = req.query.q.toLowerCase().trim();
    const keywords = query.split(/\s+/);
    const conditions = keywords.map(() => `tags LIKE ?`).join(' AND ');
    const params = keywords.map(kw => `%${kw}%`);
    
    db.all(`SELECT * FROM images WHERE ${conditions} ORDER BY id DESC`, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ images: rows });
    });
});

// --- ENDPOINT 5: Load Main Gallery ---
app.get('/api/gallery', (req, res) => {
    db.all(`SELECT * FROM images ORDER BY id DESC LIMIT 30`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ images: rows });
    });
});

// --- ENDPOINT 6: Load Admin Gallery ---
app.get('/api/admin/images', (req, res) => {
    db.all(`SELECT * FROM images ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ images: rows });
    });
});

// --- ENDPOINT 7: Edit Image Tags ---
app.put('/api/update/:id', (req, res) => {
    const id = req.params.id;
    const newTags = req.body.tags.toLowerCase();

    db.run(`UPDATE images SET tags = ? WHERE id = ?`, [newTags, id], function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Tags updated successfully!' });
    });
});

// --- ENDPOINT 8: Delete Image & Database Record ---
app.delete('/api/delete/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT filename FROM images WHERE id = ?`, [id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Image not found' });
        
        fs.unlink(path.join(__dirname, 'public', 'uploads', row.filename), () => {
            db.run(`DELETE FROM images WHERE id = ?`, [id], function(dbErr) {
                if (dbErr) return res.status(500).json({ error: 'Database error' });
                res.json({ message: 'Image deleted successfully!' });
            });
        });
    });
});

app.listen(PORT, () => console.log(`Server is running! Open http://localhost:${PORT}`));