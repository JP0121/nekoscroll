# NekoScroll 🐾

NekoScroll is a lightweight, cloud-resilient image board and gallery application. Originally built for hosting high-resolution anime art and photography, it features a custom-built JSON database for restrictive shared-hosting environments and an enterprise-grade Instagram scraper powered by Apify.

## ✨ Features

* **Enterprise Instagram Scraper:** Simply paste an Instagram link. The server uses Apify's ghost-browsers to bypass Meta's security, extract high-res images, download them locally, and automatically tag them in your database.
* **Crash-Proof JSON Database:** Bypasses the strict C++ limitations of shared hosting platforms (like Hostinger) by utilizing a pure-JavaScript JSON database (`gallery.json`). 
* **Folder Auto-Sync:** Never lose a picture. On every server boot, the app scans the `/public/uploads` directory and automatically registers any orphaned images into the database.
* **Secure Admin Portal:** A private `/admin.html` dashboard protected by HTTP Basic Authentication allowing for manual uploads, tag editing, and image deletion.
* **Tag-Based Search Engine:** Instantly filter the gallery by typing keywords into the search bar.

## 🛠️ Tech Stack

* **Backend:** Node.js (v20+ recommended), Express.js
* **Database:** Custom Pure JS JSON File System
* **File Handling:** Multer (for manual uploads), native `fetch` & `fs` (for scraper downloads)
* **API Integration:** Apify (Enterprise Instagram Scraper)
* **Security:** `express-basic-auth`

## 🚀 Getting Started

### Prerequisites
* Node.js v20.x or higher
* An [Apify](https://apify.com/) account (Free tier includes $5/mo credit, perfect for scraping)
