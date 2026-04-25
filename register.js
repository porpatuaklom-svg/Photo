
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, setPersistence, browserLocalPersistence, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

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
await setPersistence(auth, browserLocalPersistence);
// Ensure auth state is persisted in the browser so index.html can read it after redirect
setPersistence(auth, browserLocalPersistence).catch((e) => {
    console.warn('Failed to set auth persistence:', e && e.message ? e.message : e);
});

function showMessage(message, type = 'signup') {
    var messageDiv = document.getElementById(type === 'login' ? 'signinmessage' : 'signupmessage');
    if (!messageDiv) {
        console.warn('Message div not found for type', type, 'message:', message);
        return;
    }
    messageDiv.style.display = 'block';
    messageDiv.innerHTML = message;
    messageDiv.style.opacity = 1;
    setTimeout(function () {
        messageDiv.style.opacity = 0;
    }, 5000);
}

console.log('register.js loaded');

const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const name = document.getElementById('name').value.trim();

        try {
            const { user } = await createUserWithEmailAndPassword(auth, email, password);
            try { await updateProfile(user, { displayName: name }); } catch (e) { console.warn('updateProfile failed', e); }

            // เขียน users/{uid}
            try {
                await setDoc(doc(db, "users", user.uid), { email, name });
            } catch (e) {
                if (e?.code === 'permission-denied') {
                    // โปรไฟล์ยังไม่ถูกเขียนเพราะ rules — ให้ไปต่อได้แต่แจ้งไว้
                    console.warn('users setDoc permission denied, will continue', e);
                    showMessage('สมัครสำเร็จ แต่ยังบันทึกโปรไฟล์ไม่สมบูรณ์ จะลองอีกครั้งหลังเข้าสู่ระบบ');
                } else {
                    throw e; // error อื่นค่อยเด้ง
                }
            }

            // เก็บข้อมูลพื้นฐานให้หน้า index ใช้ได้ทันที
            localStorage.setItem('loggedinuserid', user.uid);
            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('userEmail', user.email || email);
            localStorage.setItem('loggedusername', user.displayName || name);

            // ไปหน้าแรก
            window.location.href = 'index.html';
        } catch (err) {
            console.error(err);
            if (err?.code === 'auth/email-already-in-use') {
                showMessage('อีเมลนี้ถูกใช้งานแล้ว');
            } else {
                showMessage('สมัครไม่สำเร็จ: ' + (err?.message || err));
            }
        }
    });

}


// Use the login form submit event to reliably handle login
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', function (event) {
        event.preventDefault();
        const emailInput = document.getElementById('loginEmail');
        const passwordInput = document.getElementById('loginPassword');
        if (!emailInput || !passwordInput) {
            showMessage('ไม่พบฟอร์มเข้าสู่ระบบ', 'login');
            return;
        }
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) {
            showMessage('กรุณากรอกอีเมลและรหัสผ่าน', 'login');
            return;
        }
        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                showMessage("เข้าสู่ระบบสำเร็จ กำลังไปหน้าโปรไฟล์...", 'index');
                // ensure auth state is available to other pages before redirect
                const unsubscribe = onAuthStateChanged(auth, (u) => {
                    if (u) {
                        localStorage.setItem('loggedinuserid', u.uid);
                        localStorage.setItem('isLoggedIn', 'true');
                        if (u.email) localStorage.setItem('userEmail', u.email);
                        unsubscribe();
                        // respect return URL (e.g., ?next=admin)
                        try {
                            const params = new URLSearchParams(window.location.search);
                            const next = params.get('next');
                            if (next === 'admin') {
                                // check client-side admin list if present
                                const admins = Array.isArray(window.APP_ADMIN_UIDS) ? window.APP_ADMIN_UIDS : [];
                                if (admins.includes(u.uid)) {
                                    window.location.href = 'admin.html';
                                    return;
                                } else {
                                    // not an admin, fall back to index
                                    window.location.href = 'index.html';
                                    return;
                                }
                            }
                        } catch (e) { console.warn('checking next param failed', e); }
                        window.location.href = "index.html";
                    }
                });
            })
            .catch((error) => {
                const errorCode = error.code;
                if (errorCode === 'auth/invalid-credential' || errorCode === 'auth/wrong-password' || errorCode === 'auth/user-not-found') {
                    showMessage("ข้อมูลเข้าสู่ระบบไม่ถูกต้อง", 'login');
                } else {
                    showMessage('ไม่สามารถเข้าสู่ระบบได้: ' + error.message, 'login');
                }
            });
    });
}
