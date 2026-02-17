const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const helmet = require("helmet");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "change_me";

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "portfolio.json");

// --- Ensure required folders/files exist ---
function ensurePaths() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, "[]", "utf-8");
}
ensurePaths();

// --- Helpers to read/write database ---
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeDB(items) {
  fs.writeFileSync(DB_PATH, JSON.stringify(items, null, 2), "utf-8");
}

// --- Security + basic middleware ---
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOADS_DIR));

// --- Multer storage config (accept any file type) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    // Keep original extension if present
    const ext = path.extname(file.originalname) || "";
    cb(null, `${id}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    // Adjust if you want. This is per-file limit (200MB).
    fileSize: 200 * 1024 * 1024
  }
});

// --- API: List portfolio items ---
app.get("/api/portfolio", (req, res) => {
  const items = readDB();
  // newest first
  items.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  res.json({ ok: true, items });
});

// --- API: Upload portfolio item ---
app.post("/api/portfolio/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file received." });
    }

    const { title = "", description = "" } = req.body;

    const id = path.parse(req.file.filename).name; // uuid
    const item = {
      id,
      title: String(title).trim() || req.file.originalname,
      description: String(description).trim(),
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      url: `/uploads/${req.file.filename}`,
      uploadedAt: new Date().toISOString()
    };

    const items = readDB();
    items.push(item);
    writeDB(items);

    res.json({ ok: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Upload failed." });
  }
});

// --- API: Delete portfolio item (admin-only) ---
app.delete("/api/portfolio/:id", (req, res) => {
  try {
    const providedKey = req.headers["x-admin-key"];
    if (!providedKey || providedKey !== ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }

    const id = req.params.id;
    const items = readDB();
    const idx = items.findIndex(x => x.id === id);

    if (idx === -1) {
      return res.status(404).json({ ok: false, error: "Item not found." });
    }

    const [removed] = items.splice(idx, 1);
    writeDB(items);

    // delete file
    const filePath = path.join(UPLOADS_DIR, removed.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Delete failed." });
  }
});

// --- Health check ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
