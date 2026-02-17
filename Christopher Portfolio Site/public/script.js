const skills = [
  { title: "Graphics Design", desc: "Logos, branding, social media assets, clean visual systems with strong contrast and clarity." },
  { title: "Music Production", desc: "Beat-making, composition, arrangement, mixing workflow, and release-ready audio." },
  { title: "Sound Design", desc: "Custom patches, FX, atmospheres, impacts, risers, and unique audio identity for content." },
  { title: "Data Entry", desc: "Accurate, fast, organized spreadsheets and data cleanup with strong attention to detail." },
  { title: "Digital Marketing", desc: "Campaign planning, content strategy, and conversion-focused messaging." },
  { title: "SEO", desc: "Keyword strategy, on-page optimization, and content structuring for search visibility." },
  { title: "AI Training", desc: "Data labeling, evaluation, prompt-based testing, quality control, and annotation workflows." },
  { title: "Web Development", desc: "Clean front-end builds, simple backend services, and practical solutions that ship." },
  { title: "Customer Service", desc: "Professional communication, calm conflict resolution, and reliable follow-through." },
  { title: "Content Creation", desc: "Creative direction, scripting, editing workflows, and consistent publishing systems." }
];

// DOM
const skillsGrid = document.getElementById("skillsGrid");
const portfolioGrid = document.getElementById("portfolioGrid");
const uploadCard = document.getElementById("uploadCard");
const uploadForm = document.getElementById("uploadForm");
const uploadStatus = document.getElementById("uploadStatus");
const titleInput = document.getElementById("titleInput");
const descInput = document.getElementById("descInput");
const fileInput = document.getElementById("fileInput");
const refreshBtn = document.getElementById("refreshBtn");
const adminToggleBtn = document.getElementById("adminToggleBtn");
const year = document.getElementById("year");

// State
let adminMode = false;
let adminKey = localStorage.getItem("portfolio_admin_key") || "";

// Init
year.textContent = new Date().getFullYear();
renderSkills();
wireAdmin();
loadPortfolio();

// --- Skills ---
function renderSkills(){
  skillsGrid.innerHTML = "";
  for (const s of skills){
    const card = document.createElement("div");
    card.className = "skill-card";
    card.innerHTML = `
      <div class="skill-title">${escapeHtml(s.title)}</div>
      <div class="skill-desc">${escapeHtml(s.desc)}</div>
    `;
    skillsGrid.appendChild(card);
  }
}

// --- Admin mode ---
function wireAdmin(){
  setAdminUI();

  adminToggleBtn.addEventListener("click", () => {
    if (!adminMode) {
      const key = prompt("Enter your Admin Key (from .env ADMIN_KEY):");
      if (!key || key.trim().length < 6) {
        alert("Admin key not set. Try again.");
        return;
      }
      adminKey = key.trim();
      localStorage.setItem("portfolio_admin_key", adminKey);
      adminMode = true;
    } else {
      adminMode = false;
    }
    setAdminUI();
    loadPortfolio();
  });

  refreshBtn.addEventListener("click", loadPortfolio);
}

function setAdminUI(){
  adminToggleBtn.textContent = `Admin: ${adminMode ? "ON" : "OFF"}`;
  uploadCard.style.display = adminMode ? "block" : "none";
}

// --- Upload ---
uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!adminMode) return;

  uploadStatus.textContent = "";

  const file = fileInput.files?.[0];
  if (!file) {
    uploadStatus.textContent = "Please choose a file.";
    return;
  }

  try {
    uploadStatus.textContent = "Uploading...";

    const fd = new FormData();
    fd.append("title", titleInput.value || "");
    fd.append("description", descInput.value || "");
    fd.append("file", file);

    const res = await fetch("/api/portfolio/upload", {
      method: "POST",
      body: fd
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Upload failed.");

    uploadStatus.textContent = "✅ Uploaded successfully.";
    titleInput.value = "";
    descInput.value = "";
    fileInput.value = "";

    await loadPortfolio();
  } catch (err) {
    uploadStatus.textContent = `❌ ${err.message}`;
  }
});

// --- Portfolio load/render ---
async function loadPortfolio(){
  portfolioGrid.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "status";
  loading.textContent = "Loading portfolio...";
  portfolioGrid.appendChild(loading);

  try {
    const res = await fetch("/api/portfolio");
    const data = await res.json();
    if (!data.ok) throw new Error("Failed to load.");

    const items = data.items || [];
    portfolioGrid.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "status";
      empty.textContent = "No portfolio items yet. (Admin can upload above.)";
      portfolioGrid.appendChild(empty);
      return;
    }

    for (const item of items) {
      portfolioGrid.appendChild(renderPortfolioItem(item));
    }
  } catch (err) {
    portfolioGrid.innerHTML = "";
    const fail = document.createElement("div");
    fail.className = "status";
    fail.textContent = "❌ Could not load portfolio. Check server is running.";
    portfolioGrid.appendChild(fail);
  }
}

function renderPortfolioItem(item){
  const wrap = document.createElement("div");
  wrap.className = "p-item";

  const uploadedDate = new Date(item.uploadedAt);
  const prettyDate = isNaN(uploadedDate.getTime())
    ? ""
    : uploadedDate.toLocaleString();

  const mime = item.mimeType || "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");

  wrap.innerHTML = `
    <div class="p-head">
      <div>
        <div class="p-title">${escapeHtml(item.title || item.originalName || "Portfolio Item")}</div>
        <div class="p-meta">${escapeHtml(prettyDate)} • ${formatBytes(item.sizeBytes || 0)}</div>
      </div>
      <div class="badge">${escapeHtml(shortMime(mime))}</div>
    </div>

    ${item.description ? `<div class="p-desc">${escapeHtml(item.description)}</div>` : ""}

    <div class="preview">
      ${isImage ? `
        <img src="${item.url}" alt="${escapeHtml(item.title || item.originalName || "Image")}" loading="lazy" />
      ` : ""}
      ${isVideo ? `
        <video src="${item.url}" controls preload="metadata"></video>
      ` : ""}
      ${isAudio ? `
        <audio src="${item.url}" controls preload="metadata"></audio>
      ` : ""}
      ${(!isImage && !isVideo && !isAudio) ? `
        <div class="file-row">
          <div>
            <div style="font-weight:700; color: rgba(255,255,255,0.92)">File</div>
            <div style="color: rgba(255,255,255,0.70); font-size: 0.9rem;">${escapeHtml(item.originalName || "download")}</div>
          </div>
          <div class="badge">Download</div>
        </div>
      ` : ""}
    </div>

    <div style="height:10px"></div>

    <div class="actions">
      <a class="btn small dl" href="${item.url}" download>Download</a>
      ${adminMode ? `<button class="btn small danger" type="button" data-del="${item.id}">Delete</button>` : ""}
    </div>
  `;

  if (adminMode) {
    const delBtn = wrap.querySelector(`[data-del="${item.id}"]`);
    delBtn.addEventListener("click", async () => {
      const ok = confirm("Delete this portfolio item permanently?");
      if (!ok) return;

      try {
        const res = await fetch(`/api/portfolio/${encodeURIComponent(item.id)}`, {
          method: "DELETE",
          headers: {
            "x-admin-key": adminKey
          }
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Delete failed.");
        await loadPortfolio();
      } catch (err) {
        alert(`❌ ${err.message}`);
      }
    });
  }

  return wrap;
}

// --- Helpers ---
function shortMime(mime){
  if (!mime) return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "spreadsheet";
  if (mime.includes("csv")) return "csv";
  if (mime.includes("pdf")) return "pdf";
  return mime.split("/")[1] ? mime.split("/")[1] : "file";
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes){
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}
