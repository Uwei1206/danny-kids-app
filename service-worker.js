// 丹尼互動美語文件小幫手 - Service Worker
//
// 目的：讓老師安裝到手機主畫面後，即使沒有網路也能開啟 App、
// 並正常使用所有「讀範本、填資料、產生檔案」的功能（這些功能全部
// 都在手機本機運算，本來就不需要網路，只是「打開 App 本身」跟
// 「讀取範本檔案」這兩步驟如果沒有快取，沒網路時會失敗）。
//
// 每次發布新版本，請把下面這個版本號 +1，否則手機上快取的舊版本
// 不會自動更新。

const CACHE_VERSION = "danny-kids-v7";
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
      await cache.addAll(APP_SHELL);
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
// - App 本體與範本檔案（同網域）：cache-first，有快取先用快取，
//   同時在背景偷偷更新快取，下次開啟就是新版本。
// - 其他（例如 CDN）：cache-first，但找不到快取時才走網路。
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const networkFetch = fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return resp;
        })
        .catch(() => null);

      if (cached) {
        // 有快取：立刻回傳快取內容，背景更新快取（不等待）
        networkFetch;
        return cached;
      }
      // 沒快取：等網路回應；網路也失敗的話，若是在要求頁面本身，
      // 退回 index.html，避免顯示瀏覽器預設的離線錯誤頁。
      const networkResp = await networkFetch;
      if (networkResp) return networkResp;
      if (req.mode === "navigate") {
        return caches.match("./index.html");
      }
      return new Response("離線狀態，且找不到快取內容", { status: 503 });
    })()
  );
});
