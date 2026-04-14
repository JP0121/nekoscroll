const express = require('express');
const sqlite3 = require('sqlite3').verbose(); // Bringing the database back
const app = express();
const PORT = process.env.PORT || 3000;

// Try to initialize the database
const db = new sqlite3.Database('./gallery.db', (err) => {
    if (err) {
        console.error("Database Error:", err.message);
    } else {
        console.log("Connected to the SQLite database.");
    }
});

app.get('/', (req, res) => {
    res.send('<h1>Server is alive AND the Database is working!</h1>');
});

app.listen(PORT, () => {
    console.log(`Diagnostic server running on port ${PORT}`);
});