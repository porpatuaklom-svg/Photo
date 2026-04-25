import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDpZVOQA1YhNgW4CgiRI6WteAi3tiEZhac",
  authDomain: "porpaphoto.firebaseapp.com",
  projectId: "porpaphoto",
  storageBucket: "porpaphoto.firebasestorage.app",
  messagingSenderId: "332750950001",
  appId: "1:332750950001:web:131128b0644eec9f3a15d0"
};

// Init ก่อน แล้วค่อยใช้ในฟังก์ชันอื่น
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function isAdminByFirestore(uid) {
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists() && snap.data()?.isAdmin === true;
  } catch (e) {
    console.error("isAdminByFirestore error:", e);
    return false;
  }
}

async function signInWithGoogleAndRoute() {
  try {
    const provider = new GoogleAuthProvider();
    const { user } = await signInWithPopup(auth, provider);

    // เก็บสถานะล็อกอิน
    localStorage.setItem("loggedinuserid", user.uid);
    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("userEmail", user.email ?? "");
    localStorage.setItem("loggedusername", user.displayName ?? "");

    // ตรวจสิทธิ์: whitelist email หรืออยู่ใน Firestore admins
    const WHITELIST = [
      "lanjakorn13524@gmail.com",
      "admin@glowgram.foto",
      "glowgramfotore@gmail.com",
      "porpatuaklom@gmail.com"
    ];
    const isWhitelisted = WHITELIST.includes(((user.email || "").toLowerCase()));
    const isFsAdmin = await isAdminByFirestore(user.uid);

    // route
    window.location.href = (isWhitelisted || isFsAdmin) ? "admin.html" : "index.html";

  } catch (err) {
    console.error("Google sign-in error:", err);
    alert(err?.message || "Google sign-in failed");
    // ไม่ต้อง redirect ใน catch — ให้ผู้ใช้กดใหม่
  }
}

const googleBtn = document.getElementById("google");
if (googleBtn) {
  googleBtn.addEventListener("click", signInWithGoogleAndRoute);
} else {
  console.warn('#google button not found on this page.');
}

const adminBtn = document.getElementById("admin")
const email = localStorage.getItem("userEmail")
if (adminBtn && (email === "porpatuaklom@gmail.com")) {
  adminBtn.classList.remove('display-none')
}

