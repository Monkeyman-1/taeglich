const CACHE = "taeglich-v8";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png"];
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).catch(() => {}));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("./index.html")))
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
