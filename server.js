const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('<h1>Server is alive! The 503 is gone!</h1>');
});

app.listen(PORT, () => {
    console.log(`Diagnostic server running on port ${PORT}`);
});