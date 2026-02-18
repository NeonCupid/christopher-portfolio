const express = require("express");
const path = require("path");
const multer = require("multer");
const helmet = require("helmet");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "change_me";

const PUBLIC_DIR = path.join(__dirname, "public");

// --- Supabase ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BUCKET = "portfolio-uploads";
const TABLE = "portfolio_items";

// --- Security + basic middleware ---
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));

// --- Multer (store file in memory, then upload to Supabase Storage) ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// --- API: List portfolio items ---
app.get("/api/portfolio", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("uploaded_at", { ascending: false });

    if (error) throw error;

    // Keep response shape similar to your old code
    const items = (data || []).map((x) => ({
      id: x.id,
      title: x.title,
      description: x.description,
      originalName: x.original_name,
      storedName: x.stored_name,
      mimeType: x.mime_type,
      sizeBytes: x.size_bytes,
      url: x.url,
      uploadedAt: x.uploaded_at,
    }));

    res.json({ ok: true, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to load portfolio." });
  }
});

// --- API: Upload portfolio item ---
app.post("/api/portfolio/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file received." });
    }

    const { title = "", description = "" } = req.body;

    const id = uuidv4();
    const ext = path.extname(req.file.originalname) || "";
    const storedName = `${id}${ext}`;

    // 1) Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storedName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // 2) Get public URL (bucket must be public)
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storedName);
    const publicUrl = urlData?.publicUrl;

    // 3) Insert metadata into table
    const row = {
      id,
      title: String(title).trim() || req.file.originalname,
      description: String(description).trim(),
      original_name: req.file.originalname,
      stored_name: storedName,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      url: publicUrl,
      uploaded_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertError } = await supabase
      .from(TABLE)
      .insert([row])
      .select()
      .single();

    if (insertError) throw insertError;

    // Keep response shape similar to before
    const item = {
      id: inserted.id,
      title: inserted.title,
      description: inserted.description,
      originalName: inserted.original_name,
      storedName: inserted.stored_name,
      mimeType: inserted.mime_type,
      sizeBytes: inserted.size_bytes,
      url: inserted.url,
      uploadedAt: inserted.uploaded_at,
    };

    res.json({ ok: true, item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Upload failed." });
  }
});

// --- API: Delete portfolio item (admin-only) ---
app.delete("/api/portfolio/:id", async (req, res) => {
  try {
    const providedKey = req.headers["x-admin-key"];
    if (!providedKey || providedKey !== ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }

    const id = req.params.id;

    // 1) Find the row
    const { data: row, error: findError } = await supabase
      .from(TABLE)
      .select("stored_name")
      .eq("id", id)
      .single();

    if (findError) {
      // If not found, Supabase often returns an error; handle as 404
      return res.status(404).json({ ok: false, error: "Item not found." });
    }

    // 2) Delete DB row
    const { error: delRowError } = await supabase.from(TABLE).delete().eq("id", id);
    if (delRowError) throw delRowError;

    // 3) Delete file from Storage
    const storedName = row.stored_name;
    if (storedName) {
      const { error: delFileError } = await supabase.storage.from(BUCKET).remove([storedName]);
      if (delFileError) throw delFileError;
    }

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
