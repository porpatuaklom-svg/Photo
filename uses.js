// uses.js (หน้าเลือกอุปกรณ์ + ฟอร์มจอง + โปรไฟล์ + ปฏิทินจองแอดมิน)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, onAuthStateChanged, updateProfile, signOut } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp, doc, getDoc, getDocs, setDoc, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

/* =========================
   FIREBASE
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyDpZVOQA1YhNgW4CgiRI6WteAi3tiEZhac",
  authDomain: "porpaphoto.firebaseapp.com",
  projectId: "porpaphoto",
  storageBucket: "porpaphoto.firebasestorage.app",
  messagingSenderId: "332750950001",
  appId: "1:332750950001:web:131128b0644eec9f3a15d0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

//ฟังก์ชันแปลงลิงก์ Google Drive (ถ้ามี)
function normalizeImageUrl(raw) {
  if (!raw) return "";
  // ถ้าเป็นลิงก์ view ของ Google Drive แปลงเป็น direct
  if (raw.includes("drive.google.com")) {
    const match = raw.match(/\/d\/([^/]+)\//);
    const id = match ? match[1] : "";
    if (id) return `https://lh3.googleusercontent.com/d/${id}=w1200`;
  }
  return raw;
}

/* =========================
   GLOBAL USER STATE
========================= */
let currentUser = null;
let currentUserName = "";
let currentUserEmail = "";

/* =========================
   DOM ELEMENTS
========================= */
// tab ปฏิทิน (ถ้ามีในหน้า admin)
const tabC = document.getElementById("tabCalendar");
const panelC = document.getElementById("panelCalendar");

// ฟอร์มจอง + ฟิลด์ในโมดัล
const modal = document.getElementById("bookingModal");
const form = document.getElementById("bookingForm");
const submitBtn = document.getElementById("submitBooking");
const productEl = document.getElementById("productInput");
const priceEl = document.getElementById("priceInput");
const startDateEl = document.getElementById("startDate");
const endDateEl = document.getElementById("endDate");
const daysEl = document.getElementById("daysInput");
const totalEl = document.getElementById("totalPrice");
const facebookEl = document.getElementById("facebookName");
const userNameEl = document.getElementById("userName");   // ชื่อผู้จอง
const userEmailEl = document.getElementById("userEmail");  // อีเมลผู้จอง

if (facebookEl) {
  facebookEl.addEventListener("input", () => {
    const cleaned = sanitizePhoneValue(facebookEl.value);
    if (facebookEl.value !== cleaned) {
      facebookEl.value = cleaned;
    }
  });
}

// เมนูโปรไฟล์บนเฮดเดอร์
const userDropdown = document.getElementById("userDropdown");
const userDisplayName = document.getElementById("userDisplayName");
const btnLogout = document.getElementById("btnLogout");
const btnOpenProfile = document.getElementById("btnOpenProfile");
const userMenu = document.getElementById("userMenu");

// โมดัลโปรไฟล์
const profileModal = document.getElementById("profileModal");
const closeProfile = document.getElementById("closeProfile");
const cancelProfile = document.getElementById("cancelProfile");
const saveProfile = document.getElementById("saveProfile");
const profEmail = document.getElementById("profEmail");
const profName = document.getElementById("profName");

/* =========================
   HELPERS
========================= */
// Google Drive URL → direct view
function normalizeDriveUrl(url = "") {
  if (!url) return "";
  try {
    if (/^https?:\/\/drive\.google\.com\/uc\?/.test(url)) return url;

    // ถ้าเป็นแค่ id
    if (!/^https?:\/\//.test(url) && /^[\w-]{10,}$/.test(url)) {
      return `https://drive.google.com/uc?export=view&id=${url}`;
    }

    // /file/d/ID/
    const m1 = url.match(/\/file\/d\/([^/]+)\//);
    if (m1 && m1[1]) {
      return `https://drive.google.com/uc?export=view&id=${m1[1]}`;
    }

    // ?id=ID
    const u = new URL(url);
    const id = u.searchParams.get("id");
    if (id) return `https://drive.google.com/uc?export=view&id=${id}`;

    return url;
  } catch {
    return url;
  }
}

function parsePricePerDay(raw) {
  const num = (raw || "").toString().replace(/[^\d.]/g, "");
  return Number(num || 0);
}
function sanitizePhoneValue(value) {
  return (value || "").toString().replace(/\D/g, "").slice(0, 10);
}
function formatTHB(num) {
  try {
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      maximumFractionDigits: 0
    }).format(num);
  } catch {
    return "฿" + (num || 0).toLocaleString("th-TH");
  }
}

const statusTextMap = {
  pending: "จองแล้ว",
  approved: "รับของแล้ว",
  rejected: "คืนของแล้ว",
  paid: "ชำระเงินแล้ว",
  requested: "ขอคืนอุปกรณ์"
};
function statusDisplay(statusRaw) {
  const key = String(statusRaw || "").toLowerCase();
  return statusTextMap[key] || String(statusRaw || "");
  }

function toDate(v) {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}
function toYMD(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function daysDiffInclusive(a, b) {
  return Math.floor((b - a) / 86400000) + 1;
}

// ===== ฟังก์ชันเช็คว่า “ช่วงวันที่” ซ้อนทับกันไหม =====
function rangesOverlap(start1, end1, start2, end2) {
  if (!start1 || !end1 || !start2 || !end2) return false;
  // ซ้อนทับ = ไม่ใช่กรณีที่ A จบ ก่อน B เริ่ม หรือ B จบ ก่อน A เริ่ม
  return !(end1 < start2 || end2 < start1);
}

// ===== เช็คว่าวันที่เลือก “ว่างไหม” สำหรับอุปกรณ์ชิ้นนี้ =====
async function isDateRangeAvailableForProduct(productName, startYMD, endYMD) {
  try {
    const snap = await getDocs(collection(db, "bookings"));
    let conflict = null;

    const aStart = toDate(startYMD);
    const aEnd = toDate(endYMD);
    if (!aStart || !aEnd) return { ok: false, conflict: null };

    snap.forEach(docu => {
      if (conflict) return; // เจอแล้ว ก็ไม่ต้องเช็คต่อ
      const data = docu.data();

      // ต้องเป็นอุปกรณ์ชิ้นเดียวกัน
      if ((data.product || "") !== productName) return;

      // สนใจเฉพาะสถานะที่ยังไม่นับว่า “ว่าง”
      const status = data.status || "pending";
      if (!["pending", "approved"].includes(status)) return;

      const bStart = toDate(data.startDate);
      const bEnd = toDate(data.endDate);
      if (!bStart || !bEnd) return;

      if (rangesOverlap(aStart, aEnd, bStart, bEnd)) {
        conflict = { id: docu.id, ...data };
      }
    });

    return { ok: !conflict, conflict };
  } catch (e) {
    console.error("check availability failed", e);
    return { ok: false, conflict: null, error: e };
  }
}

/* =========================
   LOAD PRODUCTS → .equipment-grid
========================= */
async function loadProducts() {
  const grid = document.querySelector(".equipment-grid");
  if (!grid) return;

  grid.innerHTML = `<div style="opacity:.7">กำลังโหลดรายการอุปกรณ์…</div>`;

  try {
    const snap = await getDocs(collection(db, "products"));
    if (snap.empty) {
      grid.innerHTML = `<div style="opacity:.7">ยังไม่มีสินค้าในระบบ</div>`;
      return;
    }

    const items = [];
    snap.forEach(docu => items.push({ id: docu.id, ...docu.data() }));

    const isLoggedIn = !!(auth.currentUser || localStorage.getItem("isLoggedIn"));
    grid.innerHTML = items.map(d => {
      const name = d.name || "-";
      const price = Number(d.pricePerDay || 0);
      const img = normalizeDriveUrl(d.imageUrl || "");
      const dataPriceText = `฿${price}/วัน`;
      const bookBtn = isLoggedIn
        ? `<button class="btn btn-hero btn-lg2 button-container2 book-btn" type="button" data-product="${name}" data-price="${dataPriceText}" onclick="window.__openBooking && window.__openBooking(this)">จองเลย</button>`
        : `<button class="btn btn-hero btn-lg2 button-container2 book-btn" type="button" data-product="${name}" data-price="${dataPriceText}" onclick="triggerGoogleLogin(this)">จองเลย</button>`;

      return `
        <div class="equipment-card">
          <img
            src="${img}"
            alt="${name}"
            class="card-img"
            loading="lazy"
            style="width:100%;border-radius:12px;aspect-ratio:16/10;object-fit:cover"
            onerror="this.onerror=null;this.src='https://via.placeholder.com/800x500?text=Image+not+available';"
          />
          <div class="card-content">
            <div class="card-header">
              <div>
                <h3 class="card-title">${name}</h3>
                <p class="card-category">อุปกรณ์ให้เช่า</p>
              </div>
            </div>
            <p class="card-price">฿${price.toLocaleString('th-TH')} / วัน</p>
            <div class="hero-actions">
              ${bookBtn}
            </div>
          </div>
        </div>`;
    }).join("");
  } catch (e) {
    console.error(e);
    grid.innerHTML = `<div style="color:#b91c1c">โหลดสินค้าไม่สำเร็จ กรุณารีเฟรชหน้าอีกครั้ง</div>`;
  }
}
loadProducts();

/* =========================
   BOOKING MODAL OPEN/CLOSE
========================= */
function openModal() {
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}
function closeModal() {
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
}

// เรียกตอนผู้ใช้กดปุ่มล็อกอินบน card หากยังไม่ได้ล็อกอิน
window.triggerGoogleLogin = function (btnEl) {
  try {
    const product = btnEl?.getAttribute("data-product") || "";
    const price = btnEl?.getAttribute("data-price") || "";
    localStorage.setItem("pendingBooking", JSON.stringify({ product, price }));
  } catch (e) { /* ignore */ }
  // ถ้ามีปุ่ม Google ใน header ให้คลิกปุ่มนั้น (google.js ผูก handler ไว้)
  const headerGoogle = document.getElementById("google");
  if (headerGoogle) {
    headerGoogle.click();
    return;
  }
  // ถ้าไม่มี ให้ไปหน้า auth.html
  window.location.href = "auth.html";
};

function syncEndMin() {
  // ปิดการจำกัด min เพื่อให้สามารถกรอกย้อนหลังกว่าได้
}
function computeEndFromStartAndDays() {
  const start = toDate(startDateEl?.value);
  let days = parseInt(daysEl?.value || "1", 10);
  if (!start || !days || days < 1) return;
  const end = new Date(start);
  end.setDate(end.getDate() + (Math.max(1, days) - 1));
  if (endDateEl) endDateEl.value = toYMD(end);
}
function computeDaysFromRange() {
  const start = toDate(startDateEl?.value);
  const end = toDate(endDateEl?.value);
  if (!start || !end) return;
  if (end < start) {
    if (startDateEl && endDateEl) {
      startDateEl.value = toYMD(end);
      endDateEl.value = toYMD(start);
    }
    if (daysEl) daysEl.value = daysDiffInclusive(end, start);
    return;
  }
  if (daysEl) daysEl.value = daysDiffInclusive(start, end);
}
function updateTotal() {
  const price = parsePricePerDay(priceEl?.value);
  const days = Math.max(1, parseInt(daysEl?.value || "1", 10));
  if (totalEl) totalEl.value = formatTHB(price * days);
}

startDateEl?.addEventListener("change", () => {
  syncEndMin();
  if (daysEl?.value) computeEndFromStartAndDays();
  updateTotal();
});
daysEl?.addEventListener("input", () => {
  if (!daysEl.value || parseInt(daysEl.value, 10) < 1) daysEl.value = 1;
  if (startDateEl?.value) computeEndFromStartAndDays();
  updateTotal();
});
endDateEl?.addEventListener("change", () => {
  computeDaysFromRange();
  updateTotal();
});
priceEl?.addEventListener("change", updateTotal);
syncEndMin();
updateTotal();

// เปิดโมดัลจากปุ่ม "จองเลย"
window.__openBooking = (btnEl) => {
  // ตรวจสอบล็อกอิน ถ้าไม่ล็อกอิน ให้แสดง Sign In button
  if (!auth.currentUser && !localStorage.getItem("isLoggedIn")) {
    showPopup("ต้องเข้าสู่ระบบก่อน", "กรุณาเข้าสู่ระบบเพื่อจองอุปกรณ์");
    // แสดง/สร้าง Sign In button ที่เข้าสู่ระบบ
    const loginBtn = document.getElementById("google");
    if (loginBtn) loginBtn.click();
    return;
  }

  if (facebookEl) {
    try {
      facebookEl.value = localStorage.getItem("userFacebook") || "";
    } catch { }
  }

  if (btnEl) {
    const product = btnEl.getAttribute("data-product") || "";
    const price = btnEl.getAttribute("data-price") || "";
    if (productEl) productEl.value = product;
    if (priceEl) priceEl.value = price;
  }

  if (userNameEl) userNameEl.value = currentUserName || localStorage.getItem("loggedusername") || "";
  if (userEmailEl) userEmailEl.value = currentUserEmail || localStorage.getItem("userEmail") || "";

  updateTotal();
  openModal();
};

/* =========================
   AUTH STATE
========================= */
function refreshHeaderName(name, email) {
  if (userDisplayName) {
    userDisplayName.textContent = (name?.trim() || email || "ผู้ใช้");
  }
}

// อัพเดท UI ตาม login state
function updateHeaderUI(isLoggedIn) {
  const googleBtn = document.getElementById("google");
  const userMenuEl = document.getElementById("userMenu");

  if (isLoggedIn) {
    // ซ่อนปุ่ม Sign In แสดง user menu
    if (googleBtn) googleBtn.style.display = "none";
    if (userMenuEl) userMenuEl.style.display = "block";
  } else {
    // แสดง Sign In ซ่อน user menu
    if (googleBtn) googleBtn.style.display = "flex";
    if (userMenuEl) userMenuEl.style.display = "none";
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user || null;
  currentUserEmail = user?.email || localStorage.getItem("userEmail") || "";

  if (!user) {
    currentUserName = "";
    if (userNameEl) userNameEl.value = "";
    if (userEmailEl) userEmailEl.value = "";
    refreshHeaderName("", "");
    updateHeaderUI(false);
    return;
  }

  // persist login state
  localStorage.setItem("loggedinuserid", user.uid);
  localStorage.setItem("isLoggedIn", "true");
  localStorage.setItem("userEmail", user.email || "");
  if (user.displayName) {
    localStorage.setItem("loggedusername", user.displayName || "");
  }

  // name priority: Auth.displayName → users/{uid}.name → localStorage
  if (user.displayName) {
    currentUserName = user.displayName;
  } else {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      currentUserName = (snap.exists() && snap.data()?.name)
        ? snap.data().name
        : (localStorage.getItem("loggedusername") || "");
    } catch (e) {
      console.warn("getDoc(users) failed:", e);
      currentUserName = localStorage.getItem("loggedusername") || "";
    }
  }

  if (userNameEl) userNameEl.value = currentUserName;
  if (userEmailEl) userEmailEl.value = currentUserEmail;

  refreshHeaderName(
    currentUserName || user.displayName || localStorage.getItem("loggedusername") || "",
    user.email || ""
  );

  updateHeaderUI(true);

  // ถ้ามี pending booking ให้เปิด modal และเติมค่า (ทำครั้งเดียว)
  try {
    const pendingRaw = localStorage.getItem("pendingBooking");
    if (pendingRaw) {
      const data = JSON.parse(pendingRaw || "{}");
      if (data && (data.product || data.price)) {
        if (productEl) productEl.value = data.product || "";
        if (priceEl) priceEl.value = data.price || "";
        if (userNameEl) userNameEl.value = currentUserName || localStorage.getItem("loggedusername") || "";
        if (userEmailEl) userEmailEl.value = currentUserEmail || localStorage.getItem("userEmail") || "";
        updateTotal();
        openModal();
      }
      localStorage.removeItem("pendingBooking");
    }
  } catch (e) { console.warn('restore pendingBooking failed', e); }
});

/* =========================
   SUBMIT → FIRESTORE
========================= */
form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  // ตรวจสอบว่าล็อกอินแล้ว ถ้าไม่ให้ redirect ไป auth
  if (!auth.currentUser && !localStorage.getItem("isLoggedIn")) {
    window.location.href = "auth.html";
    return;
  }

  const phoneValue = sanitizePhoneValue(facebookEl?.value || "");
  if (phoneValue.length !== 10) {
    alert("กรุณากรอกเบอร์โทร 10 หลักโดยใช้ตัวเลขเท่านั้น");
    return;
  }

  if (!startDateEl?.value || !endDateEl?.value || !daysEl?.value) {
    alert("กรุณากรอกวันที่เช่า ถึงวันที่ และจำนวนวันให้ครบ");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "กำลังบันทึก...";
  }

  try {
    const startYMD = startDateEl.value;
    const endYMD = endDateEl.value;
    const productName = productEl?.value || "";

    // ✅ เช็คว่าช่วงวันที่นี้ มีคนจองอุปกรณ์นี้อยู่แล้วหรือไม่
    const { ok, conflict, error } =
      await isDateRangeAvailableForProduct(productName, startYMD, endYMD);

    if (!ok && error) {
      alert("ระบบตรวจสอบวันจองผิดพลาด กรุณาลองใหม่อีกครั้ง");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "ยืนยันการจอง";
      }
      return;
    }

    if (!ok && conflict) {
      alert(
        `ช่วงวันที่ที่เลือกมีการจองอุปกรณ์นี้แล้ว\n\n` +
        `อุปกรณ์: ${conflict.product || "-"}\n` +
        `วันที่: ${conflict.startDate || ""} ถึง ${conflict.endDate || ""}\n` +
        `สถานะ: ${statusDisplay(conflict.status)}\n\n` +
        `กรุณาเลือกวันอื่นครับ`
      );
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "ยืนยันการจอง";
      }
      return;
    }

    // ===== ถ้าวันว่าง -> ดำเนินการบันทึกต่อ =====
    const uid =
      auth.currentUser?.uid ||
      localStorage.getItem("loggedinuserid") ||
      "";

    let bookedName =
      currentUserName ||
      auth.currentUser?.displayName ||
      localStorage.getItem("loggedusername") ||
      "";

    let bookedEmail =
      currentUserEmail ||
      auth.currentUser?.email ||
      localStorage.getItem("userEmail") ||
      "";

    if (!bookedName && uid) {
      try {
        const uSnap = await getDoc(doc(db, "users", uid));
        if (uSnap.exists() && uSnap.data()?.name) {
          bookedName = uSnap.data().name;
        }
      } catch (e) {
        console.warn("fallback getDoc(users) failed:", e);
      }
    }

    const payload = {
      product: productEl?.value || "",
      pricePerDay: parsePricePerDay(priceEl?.value),
      startDate: startDateEl?.value || "",
      endDate: endDateEl?.value || "",
      days: Math.max(1, Number(daysEl?.value || 1)),
      total: Number((totalEl?.value || "").toString().replace(/[^\d.]/g, "")),
      status: "pending",
      createdAt: serverTimestamp(),
      userId: uid,
      userName: bookedName || "",
      userEmail: bookedEmail || "",
      facebookName: phoneValue,
    };

    const docRef = await addDoc(collection(db, "bookings"), payload);
    try {
      localStorage.setItem("lastBookingId", docRef.id);
    } catch { }

    const dir = location.href.slice(0, location.href.lastIndexOf('/') + 1);
    location.href = dir + "my-bookings.html";
  } catch (err) {
    console.error(err);
    alert("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "ยืนยันการจอง";
    }
  }
});

/* =========================
   HEADER MENU & PROFILE MODAL
========================= */
function toggleDropdown(open) {
  if (!userDropdown) return;
  const willOpen = (open === undefined)
    ? !userDropdown.classList.contains("open")
    : open;
  userDropdown.classList.toggle("open", willOpen);
  userMenu?.setAttribute("aria-expanded", String(willOpen));
}

userMenu?.addEventListener("click", (e) => {
  const item = e.target.closest(".menu-dropdown .menu-item, .menu-dropdown a");
  if (item) {
    toggleDropdown(false);
    e.stopPropagation();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  toggleDropdown();
});

userMenu?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    toggleDropdown();
  }
  if (e.key === "Escape") toggleDropdown(false);
});

document.addEventListener("click", (e) => {
  if (!userMenu?.contains(e.target) && !userDropdown?.contains(e.target)) {
    toggleDropdown(false);
  }
});

// เปิด/ปิดโมดัลโปรไฟล์
function openProfile() {
  if (!auth.currentUser) {
    location.href = "auth.html";
    return;
  }

  if (profEmail) {
    profEmail.value = auth.currentUser.email || "";
  }
  const candidate =
    currentUserName ||
    auth.currentUser.displayName ||
    localStorage.getItem("loggedusername") ||
    "";

  if (profName) {
    profName.value = candidate;
  }
  profileModal?.classList.add("open");
}

btnOpenProfile?.addEventListener("click", () => {
  openProfile();
  toggleDropdown(false);
});
closeProfile?.addEventListener("click", () => {
  profileModal?.classList.remove("open");
});
cancelProfile?.addEventListener("click", () => {
  profileModal?.classList.remove("open");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") profileModal?.classList.remove("open");
});

// บันทึกชื่อโปรไฟล์
saveProfile?.addEventListener("click", async () => {
  const newName = (profName?.value || "").trim();
  if (!newName) {
    alert("กรุณากรอกชื่อ");
    return;
  }
  const u = auth.currentUser;
  if (!u) {
    location.href = "auth.html";
    return;
  }

  try {
    await updateProfile(u, { displayName: newName });
    await setDoc(
      doc(db, "users", u.uid),
      { name: newName, email: u.email || "" },
      { merge: true }
    );

    currentUserName = newName;
    localStorage.setItem("loggedusername", newName);

    refreshHeaderName(newName, u.email || "");
    profileModal?.classList.remove("open");
    alert("บันทึกชื่อเรียบร้อย");
  } catch (e) {
    console.error(e);
    alert("บันทึกไม่สำเร็จ");
  }
});

// ออกจากระบบ
btnLogout?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } finally {
    try { localStorage.clear(); } catch { }
    location.href = "index.html";
  }
});

// ลิงก์ "รายการจองของฉัน" ในเมนู → ปิดเมนูก่อนนำทาง
const myBookingsLink = document.querySelector('#userDropdown a[href="my-bookings.html"]');
myBookingsLink?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleDropdown(false);
});

/* =========================
   ปฏิทินจองในหน้าแอดมิน
========================= */

// DOM calendar
const calMonthLabel = document.getElementById("calMonthLabel");
const calGrid = document.getElementById("calGrid");
const calTodayStatus = document.getElementById("calTodayStatus");
const calPrevMonth = document.getElementById("calPrevMonth");
const calNextMonth = document.getElementById("calNextMonth");

// state
let calYear;
let calMonth; // 0..11
let calBusyIndex = {};  // {"YYYY-MM-DD": { count, bookings: [...] }}
let calLoaded = false;

// helper date
function calToDate(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}
function calToYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// สร้าง index จาก snapshot bookings
function calBuildBusyIndex(snap) {
  const idx = {};
  snap.forEach(docu => {
    const data = docu.data();
    const status = data.status || "pending";

    // เฉพาะ pending / approved
    if (!["pending", "approved"].includes(status)) return;

    const start = calToDate(data.startDate);
    const end = calToDate(data.endDate);
    if (!start || !end) return;

    const bookingInfo = {
      id: docu.id,
      product: data.product || "-",
      userName: data.userName || "",
      userEmail: data.userEmail || "",
      startDate: data.startDate,
      endDate: data.endDate,
      status
    };

    const cur = new Date(start);
    while (cur <= end) {
      const ymd = calToYMD(cur);
      if (!idx[ymd]) idx[ymd] = { count: 0, bookings: [] };
      idx[ymd].count += 1;
      idx[ymd].bookings.push(bookingInfo);
      cur.setDate(cur.getDate() + 1);
    }
  });
  return idx;
}

// สถานะ "วันนี้"
function calUpdateTodayStatus() {
  if (!calTodayStatus) return;

  const today = new Date();
  const todayYMD = calToYMD(today);
  const info = calBusyIndex[todayYMD];
  const options = { year: "numeric", month: "long", day: "numeric" };
  const label = today.toLocaleDateString("th-TH", options);

  if (!calLoaded) {
    calTodayStatus.textContent = "วันนี้กำลังโหลดข้อมูล…";
    return;
  }

  if (!info) {
    calTodayStatus.innerHTML =
      `วันนี้ <strong>${label}</strong> : ` +
      `<strong style="color:#16a34a">ยังว่าง (ไม่มีการจอง)</strong>`;
  } else {
    calTodayStatus.innerHTML =
      `วันนี้ <strong>${label}</strong> : ` +
      `<strong style="color:#b45309">มีการจองแล้ว ${info.count} รายการ</strong>`;
  }
}

// เรนเดอร์ปฏิทิน
function calRender() {
  if (!calGrid) return;

  // ถ้ายังไม่ได้ตั้งค่าเดือนเริ่มต้น
  if (typeof calYear === "undefined" || typeof calMonth === "undefined") {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }

  const first = new Date(calYear, calMonth, 1);
  const firstDow = first.getDay(); // 0=อา..6=ส
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate(); // อาจไม่ใช้แต่เก็บไว้

  // label เดือนด้านบน
  const label = first.toLocaleDateString("th-TH", { year: "numeric", month: "long" });
  if (calMonthLabel) calMonthLabel.textContent = label;

  // วันแรกที่ใช้แสดงในช่อง (ถอยกลับไปวันอาทิตย์ของสัปดาห์แรก)
  const startCellDate = new Date(calYear, calMonth, 1 - firstDow);
  const todayYMD = calToYMD(new Date());

  const cells = [];
  for (let i = 0; i < 42; i++) { // 6 แถว * 7 คอลัมน์
    const d = new Date(startCellDate);
    d.setDate(startCellDate.getDate() + i);

    const ymd = calToYMD(d);
    const inMonth = d.getMonth() === calMonth;

    const info = calBusyIndex[ymd];
    const isBusy = !!info;
    const isToday = ymd === todayYMD;

    const classes = ["cal-day"];
    if (!inMonth) classes.push("muted");
    classes.push(isBusy ? "busy" : "free");
    if (isBusy) classes.push("clickable");
    if (isToday) classes.push("today");

    const statusText = isBusy ? `มีจอง ${info.count} รายการ` : "ว่าง";
    const badge = isBusy ? `<div class="count-badge">${info.count}</div>` : "";

    cells.push(`
      <div class="${classes.join(" ")}" data-date="${ymd}">
        ${badge}
        <div class="cal-day-number">${d.getDate()}</div>
        <div class="cal-day-status">${statusText}</div>
      </div>
    `);
  }

  calGrid.innerHTML = cells.join("");

  // คลิกดูรายละเอียดรายวัน
  const dayEls = calGrid.querySelectorAll(".cal-day.clickable");
  dayEls.forEach(el => {
    el.addEventListener("click", () => {
      const ymd = el.getAttribute("data-date");
      const info = calBusyIndex[ymd];
      if (!info) return;

      const lines = info.bookings.map(b =>
        `• ${b.product} (${b.startDate} ถึง ${b.endDate})\n` +
        `  ผู้จอง: ${b.userName || "-"}\n` +
        `  สถานะ: ${statusDisplay(b.status)}`
      ).join("\n\n");

      // Use popup modal when available
      const title = `วันที่ ${ymd} มีการจอง ${info.count} รายการ`;
      if (typeof showPopup === 'function') showPopup(title, lines);
      else alert(`วันที่ ${ymd} มีการจอง ${info.count} รายการ:\n\n${lines}`);
    });
  });

  // Popup helper: show/hide message modal
  function showPopup(title, text) {
    const modal = document.getElementById('popupModal');
    if (!modal) { alert(text); return; }
    const titleEl = modal.querySelector('.popup-title');
    const bodyEl = modal.querySelector('.popup-body');
    titleEl.textContent = title || 'ข้อความ';
    bodyEl.textContent = text || '';
    modal.setAttribute('aria-hidden', 'false');
  }
  const popupCloseBtn = document.getElementById('popupClose');
  if (popupCloseBtn) popupCloseBtn.addEventListener('click', () => {
    const modal = document.getElementById('popupModal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  });
}

// เปลี่ยนเดือน
calPrevMonth?.addEventListener("click", () => {
  if (typeof calYear === "undefined") {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }
  calMonth -= 1;
  if (calMonth < 0) {
    calMonth = 11;
    calYear -= 1;
  }
  calRender();
});

calNextMonth?.addEventListener("click", () => {
  if (typeof calYear === "undefined") {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }
  calMonth += 1;
  if (calMonth > 11) {
    calMonth = 0;
    calYear += 1;
  }
  calRender();
});

// init snapshot bookings สำหรับปฏิทิน (ดึงข้อมูลแบบ realtime)
function initAdminCalendar() {
  if (!calGrid) return; // ถ้าไม่มี DOM ปฏิทินก็ไม่ต้องทำอะไร

  // กันเรียกซ้ำ
  if (initAdminCalendar._inited) return;
  initAdminCalendar._inited = true;

  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();

  // If anonymous, try reading from a sanitized public collection `bookings_public`.
  const collName = (auth.currentUser || localStorage.getItem("isLoggedIn")) ? "bookings" : "bookings_public";
  const qref = query(collection(db, collName), orderBy("startDate", "asc"));
  // onSnapshot with error handler: if permission denied (not logged in),
  // fall back to rendering an empty calendar so anonymous users still see the UI.
  onSnapshot(qref, (snap) => {
    calBusyIndex = calBuildBusyIndex(snap);
    calLoaded = true;
    calRender();
    calUpdateTodayStatus();
  }, (err) => {
    console.warn('Calendar snapshot failed (read may be restricted):', err);
    // fallback: show empty calendar and a gentle notice
    calBusyIndex = {};
    calLoaded = true;
    calRender();
    const s = document.getElementById('calTodayStatus');
    if (s) s.textContent = 'ปฏิทิน: เข้าชมแบบสาธารณะ — รายละเอียดต้องล็อกอิน';
  });
}

// ถ้าอยู่หน้า/แท็บที่มีปฏิทิน ให้ init เลย (แต่ซ่อนปฏิทินสำหรับผู้ใช้ที่ยังไม่ได้ล็อกอิน)
if (calGrid) {
  if (!auth.currentUser && !localStorage.getItem("isLoggedIn")) {
    // ซ่อนทั้ง section ปฏิทิน เพื่อไม่ให้ผู้เยี่ยมชมเห็นปฏิทิน
    const calSection = document.querySelector('.calendar-card') || (calGrid.closest ? calGrid.closest('section') : null);
    if (calSection) calSection.style.display = 'none';
  } else {
    initAdminCalendar();
  }
}

// ถ้ามี tab ปฏิทิน (เช่นปุ่มใน dashboard) ก็เรียกตอนกดแท็บได้ด้วย
tabC?.addEventListener("click", () => {
  panelC?.classList.add("active");
  if (!auth.currentUser && !localStorage.getItem("isLoggedIn")) return; // do nothing for anonymous
  initAdminCalendar();
});
