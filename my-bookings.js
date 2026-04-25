// my-bookings.js (Firebase v12 modular, realtime with index-fallback)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore, collection, query, where, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// ----- Firebase -----
const firebaseConfig = {
  apiKey: "AIzaSyDpZVOQA1YhNgW4CgiRI6WteAi3tiEZhac",
  authDomain: "porpaphoto.firebaseapp.com",
  projectId: "porpaphoto",
  storageBucket: "porpaphoto.firebasestorage.app",
  messagingSenderId: "332750950001",
  appId: "1:332750950001:web:131128b0644eec9f3a15d0"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ----- DOM -----
const tbody = document.getElementById("myBookingsBody");
const emptyState = document.getElementById("emptyState");
const statusFilter = document.getElementById("statusFilter");
const refreshBtn = document.getElementById("refreshBtn");

// โปรไฟล์เมนู (กัน null)
const userBtn = document.getElementById("userBtn");
const userDropdown = document.getElementById("userDropdown");
const userMenu = document.getElementById("userMenu");
const userDisplay = document.getElementById("userDisplayName");
const btnLogout = document.getElementById("btnLogout");

// ----- Utils -----
const money = (n) => {
  const num = (typeof n === "number") ? n : Number(n || 0);
  return num.toLocaleString("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 });
};
const toDateObj = (v) => {
  try {
    if (v && typeof v.toDate === "function") return v.toDate();
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
};
const dateRangeText = (start, end) => {
  const s = toDateObj(start);
  const e = toDateObj(end);
  if (!s && !e) return "-";
  const fmt = (d) => d.toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
  if (s && e) return `${fmt(s)} – ${fmt(e)}`;
  return s ? fmt(s) : fmt(e);
};
const statusMap = {
  pending: { text: "จองแล้ว", cls: "pending" },
  approved: { text: "รับของแล้ว", cls: "approved" },
  rejected: { text: "คืนของแล้ว", cls: "rejected" },
  paid: { text: "ชำระเงินแล้ว", cls: "paid" },
};
function statusPill(statusRaw) {
  const key = String(statusRaw || "pending").toLowerCase();
  const conf = statusMap[key] || statusMap["pending"];
  return `<span class="pill ${conf.cls}">${conf.text}</span>`;
}
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ----- Render -----
let _cacheItems = [];
function renderRows(items) {
  _cacheItems = items;

  const f = (statusFilter?.value || "all").toLowerCase();
  const filtered = (f === "all") ? items : items.filter(b => {
    const st = String(b.status || "pending").toLowerCase();
    if (f === "paid") return st === "paid" || b.paid === true;
    return st === f;
  });

  if (!filtered.length) {
    tbody.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  const rows = filtered.map(b => {
    const name = b.productName || b.product || "(ไม่ระบุอุปกรณ์)";
    const total = b.total ?? b.totalPrice ?? b.price ?? 0;
    const range = dateRangeText(b.startDate || b.start, b.endDate || b.end);
    const stHtml = statusPill(b.status || (b.paid ? "paid" : "pending"));
    return `
      <tr class="row-card">
        <td data-label="อุปกรณ์">${escapeHtml(name)}</td>
        <td data-label="วันที่เช่า">${escapeHtml(range)}</td>
        <td data-label="รวม" class="price">${escapeHtml(money(total))}</td>
        <td data-label="สถานะ">${stHtml}</td>
      </tr>`;
  }).join("");

  tbody.innerHTML = rows;
}

// ----- Data (Realtime) -----
let unsubscribe = null;

// ฟังแบบมี orderBy (ต้องมี index) ถ้า error → ตกลงไปฟังแบบไม่มี orderBy แล้ว sort ในฝั่ง client
function startListenMyBookings(uid) {
  stopListen();
  const q = query(
    collection(db, "bookings"),
    where("userId", "==", uid),
    orderBy("createdAt", "desc")
  );
  unsubscribe = onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    renderRows(items);
  }, (err) => {
    console.warn("Primary listener error (likely missing index):", err?.code, err?.message);
    // Fallback: ไม่มี orderBy → ไม่ต้องใช้ index, แล้วค่อย sort ใน client
    startListenFallback(uid);
  });
}

function startListenFallback(uid) {
  stopListen();
  const q = query(
    collection(db, "bookings"),
    where("userId", "==", uid)
  );
  unsubscribe = onSnapshot(q, (snap) => {
    const items = snap.docs.map(d => ({ _id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ax = a?.createdAt?.toMillis?.() ?? new Date(a?.createdAt || 0).getTime();
        const bx = b?.createdAt?.toMillis?.() ?? new Date(b?.createdAt || 0).getTime();
        return (bx || 0) - (ax || 0);
      });
    renderRows(items);
  }, (err) => {
    console.error("Fallback listener error:", err);
  });
}

function stopListen() {
  if (typeof unsubscribe === "function") {
    unsubscribe();
    unsubscribe = null;
  }
}

// ----- Auth / UI events -----
onAuthStateChanged(auth, (user) => {
  if (!user) {
    location.href = "auth.html";
    return;
  }
  if (userDisplay) userDisplay.textContent = user.displayName || user.email || "บัญชีของฉัน";
  startListenMyBookings(user.uid);
});

// ฟิลเตอร์/รีเฟรช แค่เรนเดอร์จากแคช
statusFilter?.addEventListener("change", () => renderRows(_cacheItems));
refreshBtn?.addEventListener("click", () => renderRows(_cacheItems));

// เมนูโปรไฟล์ (กัน null)
userBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  userDropdown?.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (userMenu && !userMenu.contains(e.target)) userDropdown?.classList.remove("open");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") userDropdown?.classList.remove("open");
});
btnLogout?.addEventListener("click", async () => {
  try { await signOut(auth); location.href = "index.html"; }
  catch (err) { alert("ออกจากระบบไม่สำเร็จ: " + err.message); }
});
const canReturn =
  String(b.status).toLowerCase() === "approved" &&
  String(b.returnStatus || "").toLowerCase() !== "returned";

const returnBtn = canReturn
  ? `<button class="btn return-btn" data-id="${b._id}">ขอคืนอุปกรณ์</button>`
  : `<span class="muted">—</span>`;
tbody?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".return-btn");
  if (!btn) return;

  const id = btn.dataset.id;
  if (!confirm("ยืนยันขอคืนอุปกรณ์รายการนี้?")) return;

  const { updateDoc, doc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js");

  await updateDoc(doc(db, "bookings", id), {
    returnStatus: "requested",
    returnRequestedAt: serverTimestamp()
  });

  alert("ส่งคำขอคืนอุปกรณ์เรียบร้อย");
});
