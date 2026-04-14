require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- DATABASE SETUP ---
const db = new sqlite3.Database('./gallery.db', (err) => {
    if (err) console.error("Database Error:", err.message);
    else console.log("Database connected successfully!");
});
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        tags TEXT
    )`);
});

app.get('/', (req, res) => {
    res.send('<h1>Server is alive and the Database is working! Puppeteer is the culprit!</h1>');
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));