// admin.js (รวม Bookings + Products + Payments + Calendar)
// Firebase v12.3.0 modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  getFirestore, collection, onSnapshot, query, orderBy, doc,
  updateDoc, deleteDoc, addDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// ===== Firebase Config =====
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

// ---- Correct Google Drive share-link -> direct image URL
function normalizeDriveUrl(url = "") {
  if (!url) return "";
  try {
    if (/drive\.google\.com\/uc\?/.test(url)) return url;             // already direct
    const m1 = url.match(/\/file\/d\/([^/]+)\//);                      // /file/d/FILE_ID/view
    if (m1 && m1[1]) return `https://drive.google.com/uc?export=view&id=${m1[1]}`;
    const u = new URL(url);                                            // ...open?id=FILE_ID
    const id = u.searchParams.get("id");
    if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
    return url;                                                        // not Drive
  } catch {
    return url;
  }
}

// ====== ตรวจสิทธิ์แอดมินเบื้องต้น ======
const ADMIN_EMAILS = [
  "lanjakorn13524@gmail.com",
  "porpatuaklom@gmail.com",
  "glowgramfotore@gmail.com"
]; // ปรับตามต้องการ
async function isAdminByFirestore(uid) {
  try {
    const s = await getDoc(doc(db, "admins", uid));
    return s.exists() && s.data()?.isAdmin === true;
  } catch {
    return false;
  }
}

// ====== UI refs ======
const $ = (id) => document.getElementById(id);

// Tabs
const tabA = $("tabBookings");
const tabB = $("tabProducts");
const tabP = $("tabPayments");
const tabC = $("tabCalendar");
const panelA = $("panelBookings");
const panelB = $("panelProducts");
const panelP = $("panelPayments");
const panelC = $("panelCalendar");

// ฟังก์ชันสลับแท็บ
function showTab(which) {
  if (!tabA || !tabB || !panelA || !panelB) return;

  [tabA, tabB, tabP, tabC].filter(Boolean).forEach(btn =>
    btn.classList.remove("active")
  );
  [panelA, panelB, panelP, panelC].filter(Boolean).forEach(p =>
    p.style.display = "none"
  );

  if (which === "products") {
    tabB?.classList.add("active");
    panelB && (panelB.style.display = "block");
  } else if (which === "payments") {
    tabP?.classList.add("active");
    panelP && (panelP.style.display = "block");
  } else if (which === "calendar") {
    tabC?.classList.add("active");
    panelC && (panelC.style.display = "block");
  } else {
    // bookings (default)
    tabA.classList.add("active");
    panelA.style.display = "block";
  }
}

if (tabA) tabA.onclick = () => showTab("bookings");
if (tabB) tabB.onclick = () => showTab("products");
if (tabP) tabP.onclick = () => showTab("payments");
if (tabC) tabC.onclick = () => showTab("calendar");

$("btnLogout")?.addEventListener("click", async () => {
  try {
      await signOut(auth);
    } finally {
      try { localStorage.clear(); } catch { }
      location.href = "index.html";
    }
});

// ====== Gate + เก็บอีเมลแอดมินปัจจุบัน ======
let currentAdminEmail = "";
let booted = false;

onAuthStateChanged(auth, async (u) => {
  if (!u) { location.href = "auth.html?next=admin"; return; }
  const ok = ADMIN_EMAILS.includes((u.email || "").toLowerCase()) || await isAdminByFirestore(u.uid);
  if (!ok) { alert("บัญชีนี้ไม่ใช่แอดมิน"); location.href = "auth.html"; return; }
  currentAdminEmail = (u.email || "").toLowerCase();
  if (!booted) { boot(); booted = true; }
});

// ====== Bookings ======
let bookingsCache = [];
let selectedIds = new Set();

const tbody = $("bookingsBody");
const statusFilter = $("statusFilter");
const paymentFilter = $("paymentFilter");
const searchBox = $("searchBookings");
const chkAll = $("chkAll");
const rowsMeta = $("rowsMeta");
const btnBulkApprove = $("bulkApprove");
const btnBulkReject = $("bulkReject");

// THB format
function fmtTHB(n) {
  try {
    return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n || 0);
  } catch { return "฿" + (n || 0).toLocaleString("th-TH"); }
}

// ป้ายสถานะชำระเงิน
function paymentPill(v) {
  if (v === "paid") return `<span class="pill pay">ชำระแล้ว</span>`;
  if (v === "failed") return `<span class="pill failed">ชำระไม่สำเร็จ</span>`;
  return `<span class="pill unpaid">ยังไม่ชำระ</span>`;
}

// ====== เรนเดอร์ตาราง (ตัวเดียว รองรับสถานะ/ค้นหา/การชำระ) ======
function renderBookingsFiltered() {
  if (!tbody) return;
  const q = (searchBox?.value || "").trim().toLowerCase();
  const st = statusFilter?.value || "";
  const pay = paymentFilter?.value || "";

  const data = bookingsCache.filter(d => {
    const okStatus = !st || (d.status || "pending") === st;
    const okPay = !pay || (d.paymentStatus || "unpaid") === pay;
    if (!okStatus || !okPay) return false;
    if (!q) return true;
    const hay = `${d.userName || ""} ${d.facebookName || ""} ${d.userEmail || ""} ${d.product || ""}`.toLowerCase();
    return hay.includes(q);
  });

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8">ไม่พบรายการที่ตรงเงื่อนไข</td></tr>';
    if (rowsMeta) rowsMeta.textContent = "แสดง 0 รายการ";
    if (chkAll) chkAll.checked = false;
    selectedIds.clear();
    updateBulkButtons();
    return;
  }

  tbody.innerHTML = "";
  for (const d of data) {
    const id = d._id;
    const statusTextMap = {
      pending: 'จองแล้ว',
      approved: 'รับของแล้ว',
      rejected: 'คืนของแล้ว'
    };
    const pillText = statusTextMap[d.status] || (d.status || 'จองแล้ว');
    const pill = `<span class="pill ${d.status || 'pending'}">${pillText}</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="rowchk" data-id="${id}" ${selectedIds.has(id) ? 'checked' : ''}></td>
      <td>${d.userName || "-"}</td>
      <td>${d.facebookName || "-"}</td>
      <td>${d.product || "-"}</td>
      <td>${d.startDate || "-"} → ${d.endDate || "-"}</td>
      <td>${d.total ? fmtTHB(d.total) : "-"}</td>
      <td>${pill}</td>
      <td>
        <button class="btn" data-act="approve" data-id="${id}">รับของแล้ว</button>
        <button class="btn danger" data-act="reject" data-id="${id}">คืนของแล้ว</button>
      </td>`;

    // action handlers
    tr.querySelector('[data-act="approve"]').onclick = () =>
      updateDoc(doc(db, "bookings", id), {
        status: "approved", statusUpdatedAt: serverTimestamp(), approvedBy: currentAdminEmail
      });
    tr.querySelector('[data-act="reject"]').onclick = () =>
      updateDoc(doc(db, "bookings", id), {
        status: "rejected", statusUpdatedAt: serverTimestamp(), approvedBy: currentAdminEmail
      });
    // การอัปเดตสถานะการชำระเงินถูกเอาออก (feature disabled)

    // checkbox select
    tr.querySelector('.rowchk').onchange = (e) => {
      const checked = e.currentTarget.checked;
      if (checked) selectedIds.add(id); else selectedIds.delete(id);
      updateBulkButtons(); syncChkAll(data);
    };

    tbody.appendChild(tr);
  }

  if (rowsMeta) rowsMeta.textContent = `แสดง ${data.length} รายการ`;
  syncChkAll(data);
  updateBulkButtons();
}

// == helpers สำหรับเลือกทั้งหมด / ปุ่ม bulk ==
function syncChkAll(currentList) {
  if (!chkAll) return;
  const allIds = new Set(currentList.map(d => d._id));
  const allChecked = currentList.length > 0 && [...allIds].every(id => selectedIds.has(id));
  chkAll.checked = allChecked;
}
function updateBulkButtons() {
  const hasSel = selectedIds.size > 0;
  if (btnBulkApprove) btnBulkApprove.disabled = !hasSel;
  if (btnBulkReject) btnBulkReject.disabled = !hasSel;
}

// Bulk actions
btnBulkApprove?.addEventListener("click", async () => {
  if (selectedIds.size === 0) return;
  if (!confirm(`รับของแล้ว ${selectedIds.size} รายการ?`)) return;
  await Promise.all([...selectedIds].map(id =>
    updateDoc(doc(db, "bookings", id), {
      status: "approved", statusUpdatedAt: serverTimestamp(), approvedBy: currentAdminEmail
    })
  ));
  selectedIds.clear(); updateBulkButtons(); renderBookingsFiltered(); renderCalendar();
});
btnBulkReject?.addEventListener("click", async () => {
  if (selectedIds.size === 0) return;
  if (!confirm(`คืนของแล้ว ${selectedIds.size} รายการ?`)) return;
  await Promise.all([...selectedIds].map(id =>
    updateDoc(doc(db, "bookings", id), {
      status: "rejected", statusUpdatedAt: serverTimestamp(), approvedBy: currentAdminEmail
    })
  ));
  selectedIds.clear(); updateBulkButtons(); renderBookingsFiltered(); renderCalendar();
});

// เลือกทั้งหมด
chkAll?.addEventListener("change", () => {
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('.rowchk')];
  rows.forEach(ch => { ch.checked = chkAll.checked; ch.dispatchEvent(new Event('change')); });
});

// debounce filter
let t = null;
function debouncedRender() { clearTimeout(t); t = setTimeout(renderBookingsFiltered, 120); }
statusFilter?.addEventListener('change', () => { renderBookingsFiltered(); renderCalendar(); });
paymentFilter?.addEventListener('change', () => { renderBookingsFiltered(); renderCalendar(); });
searchBox?.addEventListener('input', debouncedRender);

// live bookings
function wireBookingsSnapshot() {
  if (!tbody) return;
  const qref = query(collection(db, "bookings"), orderBy("createdAt", "desc"));
  onSnapshot(qref, (snap) => {
    bookingsCache = [];
    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="8">ไม่มีคำขอ</td></tr>';
      if (rowsMeta) rowsMeta.textContent = 'แสดง 0 รายการ';
      renderCalendar();  // อัปเดตปฏิทินให้ไม่มีจอง
      return;
    }
    snap.forEach(docu => bookingsCache.push({ _id: docu.id, ...docu.data() }));
    renderBookingsFiltered();
    renderCalendar();    // อัปเดตปฏิทินทุกครั้งที่ bookings เปลี่ยน
  });
}

// ====== Products ======
const productsBody = $("productsBody");
const searchProducts = $("searchProducts");
let productsCache = [];

// renderProducts – รองรับฟิลด์รูปหลายชื่อ + แสดงรูปตัวอย่าง
function renderProducts(list) {
  if (!productsBody) return;
  if (!list || list.length === 0) {
    productsBody.innerHTML = '<tr><td colspan="6">ยังไม่มีสินค้า</td></tr>';
    return;
  }

  productsBody.innerHTML = "";
  list.forEach(({ id, d }) => {
    const rawImage =
      d.image ||
      d.imageUrl ||
      d.img ||
      d.photo ||
      d.link ||
      "";

    const imgUrl = normalizeDriveUrl(rawImage);
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${id}</td>
      <td>${d.name || "-"}</td>
      <td>${d.pricePerDay || "-"}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${rawImage
        ? `<a href="${imgUrl}" target="_blank" rel="noopener">${rawImage}</a>`
        : "-"
      }
      </td>
      <td style="width:72px">
        ${imgUrl
        ? `<img src="${imgUrl}" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:6px" onerror="this.style.opacity=.3">`
        : "-"
      }
      </td>
      <td>
        <button class="btn" data-act="edit" data-id="${id}">แก้ไข</button>
        <button class="btn danger" data-act="del" data-id="${id}">ลบ</button>
      </td>`;

    tr.querySelector('[data-act="edit"]').onclick = () => {
      $("pId").value = id;
      $("pName").value = d.name || "";
      $("pPrice").value = d.pricePerDay || "";
      $("pImage").value = rawImage || "";
      showTab("products");
    };
    tr.querySelector('[data-act="del"]').onclick = async () => {
      if (confirm("ลบสินค้านี้?")) await deleteDoc(doc(db, "products", id));
    };
    productsBody.appendChild(tr);
  });
}

function wireProductsSnapshot() {
  if (!productsBody) return;
  const qref = query(collection(db, "products"), orderBy("name", "asc"));
  onSnapshot(qref, (snap) => {
    productsCache = [];
    if (snap.empty) { productsBody.innerHTML = '<tr><td colspan="6">ยังไม่มีสินค้า</td></tr>'; return; }
    snap.forEach(docu => productsCache.push({ id: docu.id, d: docu.data() }));
    applyProductsFilter();
  });
}

function applyProductsFilter() {
  const q = (searchProducts?.value || "").trim().toLowerCase();
  if (!q) { renderProducts(productsCache); return; }
  renderProducts(productsCache.filter(x => {
    const hay = `${x.d.name || ""} ${x.d.pricePerDay || ""}`.toLowerCase();
    return hay.includes(q);
  }));
}
searchProducts?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(applyProductsFilter, 120); });

// ====== Create/Update/Clear ======
$("btnCreate")?.addEventListener("click", async () => {
  const name = $("pName").value.trim();
  const price = Number(($("pPrice").value || "").toString().replace(/[^\d.]/g, ""));
  let image = $("pImage").value.trim();
  if (!name || !price) { alert("กรอกชื่อและราคา/วัน"); return; }

  image = normalizeDriveUrl(image);

  try {
    await addDoc(collection(db, "products"), {
      name,
      pricePerDay: price,
      image: image || "",
      imageUrl: image || ""
    });
    clearForm();
  } catch (e) {
    console.error(e);
    alert("เพิ่มสินค้าไม่สำเร็จ: " + (e?.code || e?.message || e));
  }
});

// update ให้เซฟทั้ง image และ imageUrl
$("btnUpdate")?.addEventListener("click", async () => {
  const id = $("pId").value.trim();
  if (!id) { alert("ใส่ ID (เลือกจากตารางก่อน)"); return; }
  const name = $("pName").value.trim();
  const price = Number(($("pPrice").value || "").toString().replace(/[^\d.]/g, ""));
  let image = $("pImage").value.trim();

  image = normalizeDriveUrl(image);

  try {
    await updateDoc(doc(db, "products", id), {
      name,
      pricePerDay: price,
      image,
      imageUrl: image || ""
    });
    clearForm();
  } catch (e) {
    console.error(e);
    alert("อัปเดตสินค้าไม่สำเร็จ: " + (e?.code || e?.message || e));
  }
});

$("btnClear")?.addEventListener("click", clearForm);
function clearForm() { $("pId").value = ""; $("pName").value = ""; $("pPrice").value = ""; $("pImage").value = ""; }

// ===== โมดัลสลิปจาก bookings =====
const slipModal = document.getElementById("slipModal");
const slipImg = document.getElementById("slipImg");
const slipOpen = document.getElementById("slipOpen");
const btnPaid = document.getElementById("markPaid");
const btnUnpaid = document.getElementById("markUnpaid");

let currentSlip = { id: "", url: "" };

function openSlip(id, url) {
  currentSlip = { id, url };
  if (slipImg) slipImg.src = url;
  if (slipOpen) slipOpen.href = url;
  slipModal?.setAttribute("aria-hidden", "false");
}
function closeSlip() {
  slipModal?.setAttribute("aria-hidden", "true");
  if (slipImg) slipImg.src = "";
  if (slipOpen) slipOpen.removeAttribute("href");
}
slipModal?.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) closeSlip();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSlip(); });

btnPaid?.addEventListener("click", async () => {
  // ฟีเจอร์การชำระเงินถูกเอาออกจากระบบ
  alert('ฟีเจอร์การชำระเงินถูกเอาออกจากระบบ');
  closeSlip();
});
btnUnpaid?.addEventListener("click", async () => {
  // ฟีเจอร์การชำระเงินถูกเอาออกจากระบบ
  alert('ฟีเจอร์การชำระเงินถูกเอาออกจากระบบ');
  closeSlip();
});

// ให้ window เรียกเปิดโมดัลจาก onclick ของรูป (เข้ารหัส url ปลอดภัยขึ้น)
window.__openSlip = (id, encUrl) => openSlip(id, decodeURIComponent(encUrl));

// ====== Payments ======
const payListEl = $("payList");
const paySegEl = $("paySeg");
const paySearchEl = $("paySearch");
const payModal = $("payModal");
const payModalImg = $("payModalImg");
const payModalClose = $("payModalClose");

let allPayments = [];
let payFilter = "all";
let paySearchText = "";

// init UI
function initPayments() {
  // ปิดการทำงานของส่วนจัดการการชำระเงินในแอดมิน: ไม่โหลดข้อมูล และซ่อน UI ที่เกี่ยวข้อง
  if (payListEl) payListEl.innerHTML = '<div class="muted">ฟีเจอร์การชำระเงินถูกปิดใช้งาน</div>';
  if (paySegEl) paySegEl.style.display = 'none';
  if (paySearchEl) paySearchEl.style.display = 'none';
  // ไม่มีการผูก snapshot หรือ event ใด ๆ
}

function renderPayments() {
  if (!payListEl) return;
  const frag = document.createDocumentFragment();

  const filtered = allPayments.filter(({ payment, booking }) => {
    const status = (payment.status || "pending").toLowerCase();
    if (payFilter !== "all" && status !== payFilter) return false;

    if (!paySearchText) return true;

    const fields = [
      payment.id,
      payment.bookingId,
      payment.userId,
      payment.payerName || "",
      (payment.amount?.toString() || ""),
      (payment.adminNote || ""),
      (booking?.userEmail || ""),
      (booking?.userName || "")
    ].join(" ").toLowerCase();

    return fields.includes(paySearchText);
  });

  for (const row of filtered) {
    const { payment: p, booking: b } = row;
    const status = (p.status || "pending").toLowerCase();
    const created = p.createdAt?.toDate?.() ? p.createdAt.toDate() : null;

    const card = document.createElement("div");
    card.className = "card";

    // thumb
    const th = document.createElement("div");
    th.className = "thumb";
    if (p.slipUrl) {
      const img = document.createElement("img");
      img.src = p.slipUrl;
      img.alt = "slip";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("click", () => {
        payModalImg.src = p.slipUrl;
        payModal.classList.add("open");
      });
      th.appendChild(img);
    } else {
      th.textContent = "ไม่มีสลิป";
    }

    // meta
    const meta = document.createElement("div");
    meta.className = "meta";

    const row1 = document.createElement("div");
    row1.className = "row";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = `Payment #${p.id.slice(0, 6)} · Booking: ${p.bookingId || "-"}`;
    const pill = document.createElement("span");
    pill.className = `pill ${status}`;
    pill.textContent = status === "approved" ? "อนุมัติแล้ว"
      : status === "rejected" ? "ไม่อนุมัติ"
        : "รอตรวจสอบ";
    row1.appendChild(title);
    row1.appendChild(pill);

    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = created ? `ส่งเมื่อ ${created.toLocaleString()}` : "ยังไม่ทราบเวลา";

    const kv = document.createElement("div");
    kv.className = "kv";
    kv.innerHTML = `
      <span>ยอดชำระ</span><strong>${p.amount ?? "-"} ฿</strong>
      <span>ผู้จ่าย</span><span>${p.payerName || b?.userName || "-"}</span>
      <span>อีเมล</span><span>${b?.userEmail || "-"}</span>
      <span>หมายเหตุแอดมิน</span><span>${p.adminNote || "-"}</span>
    `;

    const btns = document.createElement("div");
    btns.className = "btns";

    const vbtn = document.createElement("button");
    vbtn.className = "btn view";
    vbtn.textContent = "ดูสลิปใหญ่";
    vbtn.addEventListener("click", () => {
      if (!p.slipUrl) return alert("ไม่มีสลิปแนบมา");
      payModalImg.src = p.slipUrl;
      payModal.classList.add("open");
    });

    const approve = document.createElement("button");
    approve.className = "btn approve";
    approve.textContent = "อนุมัติ";
    approve.disabled = status === "approved";
    approve.addEventListener("click", () => handleApprovePayment(p, b));

    const reject = document.createElement("button");
    reject.className = "btn reject";
    reject.textContent = "ไม่อนุมัติ";
    reject.disabled = status === "rejected";
    reject.addEventListener("click", () => handleRejectPayment(p, b));

    btns.appendChild(vbtn);
    btns.appendChild(approve);
    btns.appendChild(reject);

    meta.appendChild(row1);
    meta.appendChild(tag);
    meta.appendChild(kv);
    meta.appendChild(btns);

    card.appendChild(th);
    card.appendChild(meta);
    frag.appendChild(card);
  }

  payListEl.innerHTML = "";
  payListEl.appendChild(frag);

  if (filtered.length === 0) {
    payListEl.innerHTML = `<div class="muted">ไม่พบรายการที่ตรงกับเงื่อนไข</div>`;
  }
}

async function handleApprovePayment(p, b) {
  const note = prompt("เพิ่มหมายเหตุ (ถ้ามี):", p.adminNote || "");
  try {
    await updateDoc(doc(db, "payments", p.id), {
      status: "approved",
      adminNote: note || null,
      adminAt: serverTimestamp(),
      adminUid: auth.currentUser?.uid || null,
      adminEmail: auth.currentUser?.email || null
    });
    if (b?.id) {
      await updateDoc(doc(db, "bookings", b.id), {
        paymentStatus: "paid"
      });
    }
    alert("อนุมัติเรียบร้อย");
  } catch (err) {
    console.error(err);
    alert("เกิดข้อผิดพลาดในการอนุมัติ");
  }
}

async function handleRejectPayment(p, b) {
  const note = prompt("สาเหตุการไม่อนุมัติ (จำเป็น):", "");
  if (!note) return alert("กรุณากรอกสาเหตุ");

  try {
    await updateDoc(doc(db, "payments", p.id), {
      status: "rejected",
      adminNote: note,
      adminAt: serverTimestamp(),
      adminUid: auth.currentUser?.uid || null,
      adminEmail: auth.currentUser?.email || null
    });
    if (b?.id) {
      await updateDoc(doc(db, "bookings", b.id), {
        paymentStatus: "failed"
      });
    }
    alert("ทำเครื่องหมายไม่อนุมัติเรียบร้อย");
  } catch (err) {
    console.error(err);
    alert("เกิดข้อผิดพลาดในการทำเครื่องหมายไม่อนุมัติ");
  }
}

// ====== Calendar ======
const calMonthLabel = $("calMonthLabel");
const calPrevBtn = $("calPrevMonth");
const calNextBtn = $("calNextMonth");
const calGrid = $("calGrid");

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
];

let calBase = new Date(); // เดือนปัจจุบัน
calBase.setDate(1);

function ymd(d) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function renderCalendar() {
  if (!calGrid) return;

  const year = calBase.getFullYear();
  const month = calBase.getMonth();

  // label เดือน / ปี พ.ศ.
  if (calMonthLabel) {
    calMonthLabel.textContent = `${TH_MONTHS[month]} ${year + 543}`;
  }

  calGrid.innerHTML = "";

  const first = new Date(year, month, 1);
  const startDow = first.getDay(); // 0=อา .. 6=ส
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // map วันไหนมี booking (pending/approved) พร้อมชื่อสินค้า
  const bookedDaysMap = {}; // { "YYYY-MM-DD": ["สินค้า1", "สินค้า2", ...] }
  bookingsCache.forEach(b => {
    if (!["pending", "approved"].includes(b.status)) return;
    if (!b.startDate || !b.endDate) return;

    // Parse startDate และ endDate
    const start = new Date(b.startDate);
    const end = new Date(b.endDate);
    if (isNaN(start) || isNaN(end)) return;

    // วนลูปจากวันเริ่มถึงวันสิ้นสุด
    const curr = new Date(start);
    while (curr <= end) {
      const key = ymd(curr);
      if (!bookedDaysMap[key]) bookedDaysMap[key] = [];
      bookedDaysMap[key].push(b.product || "สินค้า");
      curr.setDate(curr.getDate() + 1);
    }
  });

  const totalCells = 42;
  let currentDay = 1 - startDow; // เริ่มจากวันก่อนหน้าเดือนนี้

  for (let i = 0; i < totalCells; i++, currentDay++) {
    const cell = document.createElement("div");
    cell.className = "cal-cell";

    const d = new Date(year, month, currentDay);
    const key = ymd(d);

    if (currentDay < 1 || currentDay > daysInMonth) {
      cell.classList.add("cal-outside");
      cell.textContent = d.getDate();
    } else {
      cell.classList.add("cal-in-month");
      const num = document.createElement("div");
      num.className = "cal-day-num";
      num.textContent = currentDay;

      cell.appendChild(num);

      if (bookedDaysMap[key] && bookedDaysMap[key].length > 0) {
        // แสดงรายชื่อสินค้าที่จองในวันนั้น
        const products = [...new Set(bookedDaysMap[key])]; // remove duplicates
        products.forEach(product => {
          const dot = document.createElement("div");
          dot.className = "cal-dot booked";
          dot.textContent = product;
          dot.title = product; // hover tooltip
          cell.appendChild(dot);
        });
      }
    }

    calGrid.appendChild(cell);
  }
}

function initCalendar() {
  if (!calGrid) return;

  calPrevBtn?.addEventListener("click", () => {
    calBase.setMonth(calBase.getMonth() - 1);
    renderCalendar();
  });
  calNextBtn?.addEventListener("click", () => {
    calBase.setMonth(calBase.getMonth() + 1);
    renderCalendar();
  });

  renderCalendar();
}

// ====== Boot ======
function boot() {
  wireBookingsSnapshot();
  wireProductsSnapshot();
  initPayments();
  initCalendar(); // ✅ เรียก Calendar ตอนบูตด้วย
}
