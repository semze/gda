// Keys
const USERS_KEY = "gba_users";
const BOUNTIES_KEY = "gba_bounties";
const CURRENT_USER_KEY = "gba_current_user";
const DARK_MODE_KEY = "gba_dark_mode";

// DOM
const bountyList = document.getElementById("bountyList");
const bountyModal = document.getElementById("bountyModal");
const newBountyBtn = document.getElementById("newBountyBtn");
const closeBountyModal = document.getElementById("closeBountyModal");
const createBountyBtn = document.getElementById("createBounty");

const loginModal = document.getElementById("loginModal");
const loginBtn = document.getElementById("loginBtn");
const closeLoginModal = document.getElementById("closeLoginModal");
const loginSubmit = document.getElementById("loginSubmit");
const createAccountBtn = document.getElementById("createAccount");

const currentUserDisplay = document.getElementById("currentUserDisplay");
const currentUserNameSpan = document.getElementById("currentUserName");
const avatarCircle = document.getElementById("avatarCircle");

const survivedBars = document.getElementById("survivedBars");
const collectedBars = document.getElementById("collectedBars");
const profileCard = document.getElementById("profileCard");

const navButtons = document.querySelectorAll(".nav-btn");
const views = document.querySelectorAll(".view");
const darkModeToggle = document.getElementById("darkModeToggle");

// State
// Prefer remote (Firebase) data. Fall back to localStorage only if Firebase init fails.
let users = {};
let bounties = [];
let currentUser = null;
let externalAccounts = {}; // loaded from accounts.json (username -> { pin, ... })
// Firebase runtime
let firebaseEnabled = false;
let db = null;
let auth = null;
let localFallbackLoaded = false;

// Helpers
function saveUsers() {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

async function saveUsersRemote() {
    if (!firebaseEnabled || !db) return;
    try {
        const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js');
        const promises = Object.keys(users).map(name => setDoc(doc(db, 'users', name), users[name]));
        await Promise.all(promises);
    } catch (e) {
        // ignore remote errors
    }
}

function saveBounties() {
    localStorage.setItem(BOUNTIES_KEY, JSON.stringify(bounties));
}

async function addBountyRemote(bounty) {
    if (!firebaseEnabled || !db) return;
    const { addDoc, collection, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js');
    const data = Object.assign({}, bounty);
    // prefer server timestamp for createdAt
    data.createdAt = data.createdAt || Date.now();
    try {
        const ref = await addDoc(collection(db, 'bounties'), data);
        return ref.id;
    } catch (e) {
        return null;
    }
}

function setCurrentUser(username) {
    currentUser = username;
    if (username) {
        localStorage.setItem(CURRENT_USER_KEY, username);
        currentUserDisplay.classList.remove("hidden");
        currentUserNameSpan.textContent = username;
        loginBtn.textContent = "Switch User";
        setAvatarColor(username);
    } else {
        localStorage.removeItem(CURRENT_USER_KEY);
        currentUserDisplay.classList.add("hidden");
        loginBtn.textContent = "Login / Account";
    }
    renderProfile();
}

function setAvatarColor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    avatarCircle.style.background = `hsl(${hue}, 70%, 55%)`;
}

function nowMs() {
    return Date.now();
}

function threeDaysFromNow() {
    return nowMs() + 3 * 24 * 60 * 60 * 1000;
}

function formatTimeRemaining(ms) {
    if (ms <= 0) return "Expired";
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / (24 * 3600));
    const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h left`;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${minutes}m left`;
}

// Expire bounties and update survived stats
function processExpirations() {
    const now = nowMs();
    let changed = false;

    bounties.forEach(bounty => {
        if (!bounty.claimedBy && !bounty.expired && bounty.expiresAt <= now) {
            bounty.expired = true;
            changed = true;
            if (bounty.target && users[bounty.target]) {
                users[bounty.target].bountiesSurvived =
                    (users[bounty.target].bountiesSurvived || 0) + 1;
            }
        }
    });

    if (changed) {
        saveBounties();
        saveUsers();
    }
}

// Leaderboards
function renderLeaderboards() {
    const userEntries = Object.entries(users).map(([name, data]) => ({
        name,
        survived: data.bountiesSurvived || 0,
        collected: data.bountiesCollected || 0
    }));

    const survivedSorted = [...userEntries].sort((a, b) => b.survived - a.survived);
    const collectedSorted = [...userEntries].sort((a, b) => b.collected - a.collected);

    survivedBars.innerHTML = "";
    collectedBars.innerHTML = "";

    if (userEntries.length === 0) {
        survivedBars.innerHTML = `<p style="font-size:13px;color:var(--muted);">No data yet.</p>`;
        collectedBars.innerHTML = `<p style="font-size:13px;color:var(--muted);">No data yet.</p>`;
        return;
    }

    const maxSurvived = Math.max(...survivedSorted.map(u => u.survived), 1);
    const maxCollected = Math.max(...collectedSorted.map(u => u.collected), 1);

    survivedSorted.forEach(u => {
        const row = document.createElement("div");
        row.className = "bar-row";
        row.innerHTML = `
            <span class="bar-label">${u.name}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width:${(u.survived / maxSurvived) * 100}%"></div>
            </div>
            <span class="bar-value">${u.survived}</span>
        `;
        survivedBars.appendChild(row);
    });

    collectedSorted.forEach(u => {
        const row = document.createElement("div");
        row.className = "bar-row";
        row.innerHTML = `
            <span class="bar-label">${u.name}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width:${(u.collected / maxCollected) * 100}%"></div>
            </div>
            <span class="bar-value">${u.collected}</span>
        `;
        collectedBars.appendChild(row);
    });
}

// Bounties
function renderBounties() {
    processExpirations();
    bountyList.innerHTML = "";

    if (bounties.length === 0) {
        bountyList.innerHTML = `<p style="color:var(--muted);font-size:14px;">No bounties yet. Hit “+ Bounty” to add one.</p>`;
        renderLeaderboards();
        return;
    }

    const now = nowMs();

    bounties.forEach((bounty, index) => {
        const card = document.createElement("div");
        card.className = "card";

        let statusClass = "status-active";
        let statusText = "Active";

        if (bounty.claimedBy) {
            statusClass = "status-claimed";
            statusText = `Claimed by ${bounty.claimedBy}`;
        } else if (bounty.expired || bounty.expiresAt <= now) {
            statusClass = "status-expired";
            statusText = "Expired";
        }

        const remaining = bounty.claimedBy
            ? "Completed"
            : formatTimeRemaining(bounty.expiresAt - now);

        card.innerHTML = `
            <div class="status-tag ${statusClass}">${statusText}</div>
            <h3>${bounty.target}</h3>
            <div class="badge">${bounty.difficulty}</div>
            <p><strong>Reward:</strong> ${bounty.reward} caps</p>
            <p><strong>Issued By:</strong> ${bounty.issuer}</p>
            <p><strong>Time:</strong> ${remaining}</p>
            <div class="card-footer">
                <button class="secondary" data-delete="${index}">Delete</button>
                ${
                    !bounty.claimedBy && !bounty.expired && bounty.expiresAt > now
                        ? `<button data-claim="${index}">Claim</button>`
                        : ""
                }
            </div>
        `;

        bountyList.appendChild(card);
    });

    // Delete handlers: support both local index-based and remote doc-id-based
    bountyList.querySelectorAll("button[data-delete], button[data-delete-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-delete-id");
            if (id && firebaseEnabled && db) {
                const { deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js');
                await deleteDoc(doc(db, 'bounties', id));
                return;
            }
            const index = parseInt(btn.getAttribute("data-delete"), 10);
            if (!isNaN(index)) {
                bounties.splice(index, 1);
                saveBounties();
                renderBounties();
            }
        });
    });

    bountyList.querySelectorAll("button[data-claim], button[data-claim-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
            if (!currentUser) {
                alert("You must be logged in to claim a bounty.");
                return;
            }
            const id = btn.getAttribute("data-claim-id");
            if (id && firebaseEnabled && db) {
                const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js');
                const bountyRef = doc(db, 'bounties', id);
                await updateDoc(bountyRef, { claimedBy: currentUser });
                // increment user's collected count remotely
                try {
                    const { increment } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js');
                    const userRef = doc(db, 'users', currentUser);
                    await updateDoc(userRef, { bountiesCollected: (users[currentUser]?.bountiesCollected || 0) + 1 });
                } catch (e) {}
                return;
            }
            const index = parseInt(btn.getAttribute("data-claim"), 10);
            const bounty = bounties[index];
            if (!bounty || bounty.claimedBy || bounty.expired) return;

            bounty.claimedBy = currentUser;
            if (users[currentUser]) {
                users[currentUser].bountiesCollected =
                    (users[currentUser].bountiesCollected || 0) + 1;
            }
            saveBounties();
            saveUsers();
            renderBounties();
        });
    });

    renderLeaderboards();
    renderProfile();
}

// Profile
function renderProfile() {
    if (!currentUser || !users[currentUser]) {
        profileCard.innerHTML = `<p>You’re not logged in yet. Use the “Login / Account” button in the header.</p>`;
        return;
    }

    const u = users[currentUser];
    const survived = u.bountiesSurvived || 0;
    const collected = u.bountiesCollected || 0;

    const badges = [];
    if (survived >= 5) badges.push("Unstoppable");
    if (collected >= 5) badges.push("Hunter");
    if (survived === 0 && collected === 0) badges.push("Fresh Meat");
    if (survived >= 1 && collected >= 1) badges.push("Balanced Threat");

    profileCard.innerHTML = `
        <div class="profile-header">
            <div class="avatar"></div>
            <div>
                <div><strong>${currentUser}</strong></div>
                <div style="font-size:13px;color:var(--muted);">Local player</div>
            </div>
        </div>
        <p><strong>Bounties Survived:</strong> ${survived}</p>
        <p><strong>Bounties Collected:</strong> ${collected}</p>
        ${
            badges.length
                ? `<div class="badge-row">${badges
                      .map(b => `<span class="badge-pill">${b}</span>`)
                      .join("")}</div>`
                : ""
        }
    `;
    const avatar = profileCard.querySelector(".avatar");
    if (avatar) {
        avatar.style.background = avatarCircle.style.background;
    }
}

// Modals
function openModal(modal) {
    modal.classList.remove("hidden");
}

function closeModal(modal) {
    modal.classList.add("hidden");
}

// Bounty modal
newBountyBtn.onclick = () => {
    if (!currentUser) {
        alert("You must be logged in to create a bounty.");
        return;
    }
    openModal(bountyModal);
};

// --- Username suggestions (autocomplete / fuzzy match) ---
const targetInput = document.getElementById("target");
const suggestionsBox = document.getElementById("targetSuggestions");

function levenshtein(a, b) {
    const an = a.length, bn = b.length;
    if (an === 0) return bn;
    if (bn === 0) return an;
    const matrix = Array.from({ length: an + 1 }, () => new Array(bn + 1));
    for (let i = 0; i <= an; i++) matrix[i][0] = i;
    for (let j = 0; j <= bn; j++) matrix[0][j] = j;
    for (let i = 1; i <= an; i++) {
        for (let j = 1; j <= bn; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[an][bn];
}

function getAllCandidateUsernames() {
    const set = new Set();
    // accounts.json entries
    Object.keys(externalAccounts || {}).forEach(k => set.add(k));
    // localStorage users
    Object.keys(users || {}).forEach(k => set.add(k));
    return Array.from(set);
}

function computeSuggestions(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    const candidates = getAllCandidateUsernames();
    const scored = candidates.map(name => {
        const nameLower = name.toLowerCase();
        let score = 999;
        if (nameLower === q) score = 0;
        else if (nameLower.startsWith(q)) score = 1;
        else if (nameLower.includes(q)) score = 2;
        else {
            const dist = levenshtein(q, nameLower);
            score = dist + 3; // larger than prefix/include
        }
        return { name, score };
    });
    scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    // only keep reasonably close matches
    return scored.filter(s => s.score <= 6).slice(0, 8).map(s => s.name);
}

function showSuggestions(list) {
    suggestionsBox.innerHTML = "";
    if (!list || list.length === 0) {
        suggestionsBox.classList.add("hidden");
        return;
    }
    list.forEach(name => {
        const div = document.createElement("div");
        div.className = "suggestion-item";
        div.textContent = name;
        div.addEventListener("click", () => {
            targetInput.value = name;
            suggestionsBox.classList.add("hidden");
        });
        suggestionsBox.appendChild(div);
    });
    suggestionsBox.classList.remove("hidden");
}

targetInput.addEventListener("input", (e) => {
    const q = e.target.value.trim();
    if (!q) {
        showSuggestions([]);
        return;
    }
    const list = computeSuggestions(q);
    showSuggestions(list);
});

// hide suggestions when clicking outside
document.addEventListener("click", (e) => {
    if (!suggestionsBox.contains(e.target) && e.target !== targetInput) {
        suggestionsBox.classList.add("hidden");
    }
});

// Load accounts.json (if present) and normalize
async function loadExternalAccounts() {
    try {
        const res = await fetch("accounts.json", { cache: "no-cache" });
        if (!res.ok) return;
        const data = await res.json();
        // Normalize: accept either object mapping or array of { name, pin }
        if (Array.isArray(data)) {
            data.forEach(item => {
                if (item && item.name) externalAccounts[item.name] = item;
            });
        } else if (data && typeof data === "object") {
            // could already be mapping
            Object.keys(data).forEach(k => {
                const v = data[k];
                if (v && typeof v === "object" && (v.pin || v.name)) externalAccounts[k] = v;
                else externalAccounts[k] = { name: k, pin: v };
            });
        }
    } catch (err) {
        // silent fail — offline or missing file
    }
}

// Load external accounts early
loadExternalAccounts();

// Local fallback loader: used when Firebase init fails or offline
function loadLocalData() {
    if (localFallbackLoaded) return;
    try {
        const storedUsers = localStorage.getItem(USERS_KEY);
        const storedBounties = localStorage.getItem(BOUNTIES_KEY);
        const storedCurrent = localStorage.getItem(CURRENT_USER_KEY);
        users = storedUsers ? JSON.parse(storedUsers) : {};
        bounties = storedBounties ? JSON.parse(storedBounties) : [];
        currentUser = storedCurrent || null;
        localFallbackLoaded = true;
        if (currentUser && users[currentUser]) {
            setCurrentUser(currentUser);
        } else {
            setCurrentUser(null);
        }
        renderBounties();
    } catch (e) {
        users = {};
        bounties = [];
        currentUser = null;
        renderBounties();
    }
}

// --- Firebase init & realtime ---
async function initFirebase() {
    try {
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js');
        const { getFirestore, collection, onSnapshot } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js');
        const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js');

        const firebaseConfig = {
            apiKey: "AIzaSyA9jKJPXDcwO6o0ggrvKW9RIBhBEGxEjw4",
            authDomain: "tgba-d5982.firebaseapp.com",
            projectId: "tgba-d5982",
            storageBucket: "tgba-d5982.firebasestorage.app",
            messagingSenderId: "661091656830",
            appId: "1:661091656830:web:487766928304f4a353642f",
            measurementId: "G-QDK08C4PRS"
        };

        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        firebaseEnabled = true;

        // users collection live
        onSnapshot(collection(db, 'users'), snapshot => {
            const newUsers = {};
            snapshot.docs.forEach(d => {
                newUsers[d.id] = d.data();
            });
            users = newUsers;
            saveUsers();
            renderLeaderboards();
            renderProfile();
        });

        // bounties collection live
        onSnapshot(collection(db, 'bounties'), snapshot => {
            bounties = snapshot.docs.map(d => Object.assign({ id: d.id }, d.data()));
            saveBounties();
            renderBounties();
        });

        onAuthStateChanged(auth, (u) => {
            if (u && u.email) setCurrentUser(u.email);
        });
    } catch (e) {
        // If Firebase fails to initialize (blocked, offline, or rules), fall back to localStorage
        loadLocalData();
    }
}

// kick off firebase init (uses provided config)
initFirebase();

closeBountyModal.onclick = () => closeModal(bountyModal);

bountyModal.addEventListener("click", (e) => {
    if (e.target === bountyModal) closeModal(bountyModal);
});

createBountyBtn.onclick = () => {
    const target = document.getElementById("target").value.trim();
    const reward = document.getElementById("reward").value.trim();
    const difficulty = document.getElementById("difficulty").value;
    const durationVal = document.getElementById("duration")
        ? document.getElementById("duration").value
        : null;

    if (!currentUser) {
        alert("You must be logged in to create a bounty.");
        return;
    }

    if (!target || !reward) {
        alert("Please fill in all fields.");
        return;
    }

    const createdAt = nowMs();

    const MIN_HOURS = 6;
    const MAX_HOURS = 72; // 3 days

    let durationHours = Number(durationVal);
    if (!durationVal || isNaN(durationHours)) {
        // fallback to max if no duration control present
        durationHours = MAX_HOURS;
    }

    if (durationHours < MIN_HOURS) {
        alert(`Duration must be at least ${MIN_HOURS} hours.`);
        return;
    }
    if (durationHours > MAX_HOURS) {
        alert("Duration cannot exceed 3 days (72 hours).");
        return;
    }

    const expiresAt = createdAt + durationHours * 60 * 60 * 1000;

    const newBounty = {
        target,
        reward: Number(reward),
        issuer: currentUser,
        difficulty,
        createdAt,
        expiresAt,
        claimedBy: null,
        expired: false
    };

    if (firebaseEnabled && db) {
        // push to firestore; listener will update UI
        addBountyRemote(newBounty).then(() => {
            document.getElementById("target").value = "";
            document.getElementById("reward").value = "";
            document.getElementById("difficulty").value = "Easy";
            if (document.getElementById("duration")) document.getElementById("duration").value = "72";
            closeModal(bountyModal);
        });
    } else {
        bounties.push(newBounty);
        saveBounties();
        document.getElementById("target").value = "";
        document.getElementById("reward").value = "";
        document.getElementById("difficulty").value = "Easy";
        if (document.getElementById("duration")) document.getElementById("duration").value = "72";
        closeModal(bountyModal);
        renderBounties();
    }
};

// Login modal
loginBtn.onclick = () => openModal(loginModal);
closeLoginModal.onclick = () => closeModal(loginModal);

loginModal.addEventListener("click", (e) => {
    if (e.target === loginModal) closeModal(loginModal);
});

loginSubmit.onclick = () => {
    const username = document.getElementById("loginUsername").value.trim();
    const pin = document.getElementById("loginPin").value.trim();

    if (!username || !pin) {
        alert("Enter username and PIN.");
        return;
    }

    if (!users[username]) {
        alert("User not found. Use 'Create Account' to register.");
        return;
    }

    if (users[username].pin !== pin) {
        alert("Incorrect PIN.");
        return;
    }

    setCurrentUser(username);
    closeModal(loginModal);
};

createAccountBtn.onclick = () => {
    const username = document.getElementById("loginUsername").value.trim();
    const pin = document.getElementById("loginPin").value.trim();

    if (!username || !pin) {
        alert("Enter username and PIN.");
        return;
    }

    if (pin.length < 4) {
        alert("Use at least 4 digits for PIN.");
        return;
    }

    if (users[username]) {
        alert("User already exists. Try logging in.");
        return;
    }

    users[username] = {
        pin,
        bountiesCollected: 0,
        bountiesSurvived: 0
    };
    saveUsers();
    setCurrentUser(username);
    closeModal(loginModal);
};

// SPA navigation
navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        const view = btn.getAttribute("data-view");
        navButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        views.forEach(v => {
            v.classList.toggle("active", v.id === `view-${view}`);
        });
    });
});

// Dark mode
function applyDarkMode(enabled) {
    if (enabled) {
        document.body.classList.add("dark");
        darkModeToggle.textContent = "☀️";
    } else {
        document.body.classList.remove("dark");
        darkModeToggle.textContent = "🌙";
    }
}

const storedDark = localStorage.getItem(DARK_MODE_KEY);
applyDarkMode(storedDark === "true");

darkModeToggle.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark");
    applyDarkMode(!isDark);
    localStorage.setItem(DARK_MODE_KEY, String(!isDark));
});

// Initialization: UI will be rendered by Firebase snapshots or local fallback loader.

// Refresh timers every minute
setInterval(renderBounties, 60 * 1000);
