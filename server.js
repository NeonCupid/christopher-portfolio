const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const multer = require("multer");
const helmet = require("helmet");
const { v4: uuidv4 } = require("uuid");
const { Readable } = require("stream");
const mime = require("mime-types");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "change_me";

const PUBLIC_DIR = path.join(__dirname, "public");

// ---- Supabase (persistent storage) ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Must match what you created in Supabase
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

// --- Temp upload dir (Render free disk is NOT persistent, so we use temp only) ---
const TMP_DIR = path.join(os.tmpdir(), "portfolio-uploads");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function cleanupTemp(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlink(filePath, () => {});
  }
}

function detectContentType(file) {
  return (
    file?.mimetype ||
    mime.lookup(file?.originalname || "") ||
    "application/octet-stream"
  );
}

// --- Multer storage config (accept any file type) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname) || "";
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    // NOTE: Supabase may enforce its own max object size depending on plan.
    fileSize: 200 * 1024 * 1024,
  },
});

// --- API: List portfolio items ---
app.get("/api/portfolio", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("uploaded_at", { ascending: false });

    if (error) throw error;

    const items = (data || []).map((x) => {
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(x.stored_name);

  return {
    id: x.id,
    title: x.title,
    description: x.description,
    originalName: x.original_name,
    storedName: x.stored_name,
    mimeType: x.mime_type,
    sizeBytes: x.size_bytes,
    url: urlData?.publicUrl || x.url, // ✅ always prefer correct URL
    uploadedAt: x.uploaded_at,
  };
});


    res.json({ ok: true, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message || "Failed to load." });
  }
});

// --- API: Upload portfolio item ---
app.post("/api/portfolio/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file received." });
    }

    const { title = "", description = "" } = req.body;

    const id = path.parse(req.file.filename).name; // uuid
    const storedName = req.file.filename;

    const contentType = detectContentType(req.file);

    // Upload to Supabase Storage (use Web stream for Node compatibility)
    const nodeStream = fs.createReadStream(req.file.path);
    const webStream = Readable.toWeb(nodeStream);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storedName, webStream, {
        contentType,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // Delete temp file (we don't store on Render disk)
    cleanupTemp(req.file.path);

    // Public URL (bucket must be public)
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storedName);
    const publicUrl = urlData?.publicUrl;

    if (!publicUrl) {
      throw new Error("Could not generate public URL (is the bucket public?).");
    }

    const row = {
      id,
      title: String(title).trim() || req.file.originalname,
      description: String(description).trim(),
      original_name: req.file.originalname,
      stored_name: storedName,
      mime_type: contentType,
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
    cleanupTemp(req.file?.path);
    res.status(500).json({ ok: false, error: err?.message || "Upload failed." });
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

    // Find row (need stored_name)
    const { data: row, error: findError } = await supabase
      .from(TABLE)
      .select("stored_name")
      .eq("id", id)
      .single();

    if (findError || !row) {
      return res.status(404).json({ ok: false, error: "Item not found." });
    }

    // Delete DB row
    const { error: delRowError } = await supabase.from(TABLE).delete().eq("id", id);
    if (delRowError) throw delRowError;

    // Delete file from Storage
    const storedName = row.stored_name;
    if (storedName) {
      const { error: delFileError } = await supabase.storage
        .from(BUCKET)
        .remove([storedName]);
      if (delFileError) throw delFileError;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message || "Delete failed." });
  }
});

// --- Health check ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, status: "healthy", storage: "LOCAL_DISK" });
});


app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
