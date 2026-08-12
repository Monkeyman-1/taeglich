const CACHE = "taeglich-v14";
const FILES = ["./", "./index.html", "./vocab.json", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png"];
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).catch(() => {}));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // The app is one HTML file and one data file. Serving either cache-first pins
  // users to an old build — or an old word list — forever. Network-first keeps
  // them current and still falls back to cache when offline.
  const isShell = e.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
  const isVocab = url.pathname.endsWith("/vocab.json");
  if (isShell || isVocab) {
    const key = isVocab ? "./vocab.json" : "./index.html";
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(key).then((hit) => hit || (isShell ? caches.match("./") : undefined)))
    );
    return;
  }
  // icons and the manifest are versioned by the cache name, so cache-first is fine
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }))
  );
});

/* ---------- local reminders (best-effort, no server involved) ---------- */
function idbGetState() {
  return new Promise((resolve) => {
    const req = indexedDB.open("taeglich-notif", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("state");
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction("state", "readonly");
        const rq = tx.objectStore("state").get("current");
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    };
    req.onerror = () => resolve(null);
  });
}
function idbPutState(doc) {
  return new Promise((resolve) => {
    const req = indexedDB.open("taeglich-notif", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("state");
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction("state", "readwrite");
        tx.objectStore("state").put(doc, "current");
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    };
    req.onerror = () => resolve();
  });
}
async function checkAndNotify() {
  const doc = await idbGetState();
  if (!doc) return;
  const today = new Date().toISOString().slice(0, 10);
  if (doc.lastDay === today) return;
  if (doc.lastNotified === today) return;
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const streakLate = doc.streakOn && now.getHours() >= 20;
  const dailyDue = doc.dailyOn && hhmm >= (doc.dailyTime || "18:00");
  if (!streakLate && !dailyDue) return;
  await self.registration.showNotification(streakLate ? "Dein Streak ist in Gefahr" : "Zeit für Täglich", {
    body: streakLate ? (doc.streak || 0) + " Tage Streak — heute noch nicht geübt." : "Ein paar Minuten Deutsch üben?",
    icon: "icon-192.png",
    tag: "taeglich-reminder"
  });
  doc.lastNotified = today;
  await idbPutState(doc);
}
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "daily-check") e.waitUntil(checkAndNotify());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});
