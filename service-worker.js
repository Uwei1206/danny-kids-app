// 丹尼互動美語文件小幫手 - Service Worker
//
// 目的：讓老師安裝到手機主畫面後，即使沒有網路也能開啟 App、
// 並正常使用所有「讀範本、填資料、產生檔案」的功能（這些功能全部
// 都在手機本機運算，本來就不需要網路，只是「打開 App 本身」跟
// 「讀取範本檔案」這兩步驟如果沒有快取，沒網路時會失敗）。
//
// 每次發布新版本，請把下面這個版本號 +1，否則手機上快取的舊版本
// 不會自動更新。

const CACHE_VERSION = "danny-kids-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./templates/template_attendance.xlsx",
  "./templates/template_nametag.xlsx",
  "./templates/template_assessment_cover.xlsx",
  "./templates/template_progress.xlsx",
  "./templates/template_notice_general.docx",
  "./templates/template_notice_winterbreak.docx"
];

// 外部 CDN 函式庫（JSZip）：離線時也要能用，另外用一個 cache 存放，
// 版本號跟著 index.html 裡引用的版本一起更新。
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // cache:"reload"：略過瀏覽器自己的HTTP快取，確保抓到的是伺服器上最新的檔案
      await cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: "reload" })));
      // CDN 資源個別抓取，單一檔案失敗不影響整體安裝
      await Promise.all(
        CDN_ASSETS.map(async (url) => {
          try {
            const resp = await fetch(url, { mode: "cors" });
            if (resp.ok) await cache.put(url, resp);
          } catch (e) {
            // 安裝當下沒網路也沒關係，之後上線時 fetch 會自動補快取
          }
        })
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

// 策略：
// - App 本體與範本檔案（同網域）：「網路優先」。有網路就一定抓最新版（並更新快取），
//   網路很慢（超過4秒）或沒有網路時才改用手機裡存的快取版本，離線也能用。
//   （原本是「快取優先」，會一直先給舊版，更新後要開兩次才會換成新版，
//   造成老師手機上跑的不是最新版。）
// - 其他（例如 CDN 的 JSZip）：快取優先，找不到才走網路。
async function networkFirst(req){
  const cache = await caches.open(CACHE_VERSION);
  const net = fetch(req.url, { cache: "no-cache" }).then((resp) => {
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  });
  net.catch(() => {}); // 避免逾時之後才失敗造成未處理的錯誤
  try {
    return await Promise.race([
      net,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))
    ]);
  } catch (e) {
    const cached = (await cache.match(req)) || (await caches.match(req));
    if (cached) return cached;
    if (req.mode === "navigate") {
      const home = await caches.match("./index.html");
      if (home) return home;
    }
    try { return await net; } catch (_) {
      return new Response("離線狀態，且找不到快取內容", { status: 503 });
    }
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return resp;
      } catch (e) {
        return new Response("離線狀態，且找不到快取內容", { status: 503 });
      }
    })()
  );
});
