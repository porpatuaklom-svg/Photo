// approvals.js (clean & fixed)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDugjVmL2TfZpbjdaRh9w5anCMS01XwAOQ",
  authDomain: "glowgram-49b76.firebaseapp.com",
  projectId: "glowgram-49b76",
  storageBucket: "glowgram-49b76.firebasestorage.app",
  messagingSenderId: "923913334247",
  appId: "1:923913334247:web:7aab859132f2d5d1cd6142"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id");

// ปุ่มชำระเงินถูกเอาออกจากระบบ — ไม่มีการแสดงปุ่มชำระเงินอีกต่อไป

const statusMap = {
  pending: {
    text: "จองแล้ว", cls: "pending",
    icon: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  },
  approved: {
    text: "รับของแล้ว", cls: "approved",
    icon: '<svg viewBox="0 0 24 24" fill="none"><path d="M20 7L10 17l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  },
  rejected: {
    text: "คืนของแล้ว", cls: "rejected",
    icon: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  },
};

const fmtTHB = (n) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 })
    .format(Number(n || 0));

function setStatus(s = "pending") {
  const { text, cls, icon } = statusMap[s] || statusMap.pending;
  const pill = $("statusPill");
  if (!pill) return;
  pill.className = `pill ${cls}`;
  pill.innerHTML = `${icon}<span id="statusText">${text}</span>`;
}

// ===== main =====
if (!id) {
  $("statusSub").textContent = "ไม่พบรหัสการจอง (โปรดเปิดลิงก์จากหน้ากดจอง)";
} else {
  onAuthStateChanged(auth, (u) => {
    if (!u) {
      $("statusSub").textContent = "กรุณาเข้าสู่ระบบก่อนดูสถานะการจอง";
      return;
    }
  });

  const ref = doc(db, "bookings", id);
  onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      $("statusSub").textContent = "ไม่พบข้อมูลการจองนี้";
      if (paySection) paySection.style.display = "none";
      return;
    }

    const d = snap.data();

    // อัปเดตสถานะ (ป้ายบนขวา)
    setStatus(d.status);

    // คำบรรยายใต้หัว
    let sub =
      d.status === "pending" ? "คำขอของคุณถูกบันทึกเป็น จองแล้ว" :
        d.status === "approved" ? "ผู้ดูแลยืนยันว่าได้รับของแล้ว" :
          "ผู้ดูแลบันทึกว่าได้คืนของแล้ว";

    const ts = d.statusUpdatedAt?.toDate ? d.statusUpdatedAt.toDate() : null;
    if (ts) {
      const dt = ts.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
      sub += ` · อัปเดตล่าสุด ${dt}`;
    }
    if (d.approvedBy) sub += ` · โดย ${d.approvedBy}`;
    $("statusSub").textContent = sub;

    // เติมข้อมูลรายละเอียด
    $("userName").textContent = d.userName || "-";
    $("userEmail").textContent = d.userEmail || "-";
    $("product").textContent = d.product || "-";
    $("total").textContent = d.total ? fmtTHB(d.total) : "-";
    $("dates").textContent = (d.startDate && d.endDate) ? `${d.startDate} → ${d.endDate}` : "-";
    $("days").textContent = d.days ?? "-";
    $("userFacebook").textContent = d.facebookName || "-";

    // ฟีเจอร์การชำระเงินถูกเอาออก — ไม่แสดงปุ่มชำระเงินและไม่มีการนำทางไปยังหน้าชำระเงิน
  }, (err) => {
    console.error(err);
    $("statusSub").textContent = "เกิดข้อผิดพลาดในการโหลดข้อมูล";
    if (paySection) paySection.style.display = "none";
  });
}
