// 오프라인 저장소(서비스 워커) — 게임 중 인터넷 없이 진행하기 위해 받은 파일을 기기(Cache Storage)에 두고 거기서 꺼내 쓴다.
//   · 설치 때: 배포가 만든 offline-manifest.json 의 앱 화면 파일(html·_next·AR 엔진)을 받아 둔다.
//   · 그 밖의 파일(그림·소리·AR 그림·CMS 몬스터 그림·CDN 엔진)은 앱이 행사 시작 전에 받을 때(arPrefetch) 여기를 지나며 저장된다.
//   · 화면 이동(html)만 인터넷 우선(새 배포 반영) — 4초 안에 안 오면 저장본. 나머지는 저장본 우선.
//   · 서버 API(/play/…) JSON 은 저장하지 않는다(게임 데이터는 앱이 sessionStorage 에 둔다).
// ⚠ 수정 시 주의: 배포 후처리(gh-pages-rewrite)가 따옴표 안의 images·ar 폴더 경로에 basePath 를 붙이므로 이 파일엔 그런 경로를 쓰지 않는다
//   (경로는 등록 범위 scope 기준으로 만든다). 버전(v)은 앱이 등록할 때 붙이는 배포 해시 — 바뀌면 같은 출처 저장본을 새로 받는다.
const V = new URL(self.location.href).searchParams.get('v') || 'dev';
const SAME = 'bm-' + V; // 같은 출처 파일 — 배포마다 새로
const EXT = 'bm-ext'; // CMS 그림·CDN — 주소가 파일마다 달라 배포와 무관하게 유지
const BASE = new URL(self.registration.scope).pathname; // 예: /bookmon-play/
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    fetch(BASE + 'offline-manifest.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((m) => caches.open(SAME).then((c) =>
        // 한 파일이 실패해도 나머지는 저장(설치 자체가 막히면 오프라인이 통째로 안 된다).
        Promise.all(m.files.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

// 예전 배포의 저장본은 여기서 지우지 않는다 — 행사 중 새 배포가 올라가 인터넷 연결 상태에서 새로고침한 기기가 곧바로 끊겨도
//   예전 저장본으로 이어서 할 수 있게. 새 버전으로 전부 받은 뒤 앱이 지운다(offlineCache.pruneOldOfflineCaches).
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim()); // 지금 열린 화면도 바로 맡는다 — 이어서 받는 파일이 저장되게
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  const same = url.origin === self.location.origin;
  if (!same && url.pathname.includes('/play/')) return; // 서버 API — 늘 인터넷
  if (same && (url.pathname === BASE + 'sw.js' || url.pathname === BASE + 'offline-manifest.json')) return;
  if (req.mode === 'navigate') e.respondWith(networkFirst(req));
  else e.respondWith(cacheFirst(req, same ? SAME : EXT, same));
});

// 저장본 찾기 — 같은 출처는 ?쿼리(Next 화면 데이터 ?_rsc= 등)를 빼고도 찾고, 폴더 주소는 index.html 로도 찾는다.
async function lookup(req, cacheName, same) {
  const c = await caches.open(cacheName);
  let hit = await c.match(req.url);
  if (!hit && same) hit = await c.match(req.url, { ignoreSearch: true });
  if (!hit && same) {
    const u = new URL(req.url); u.search = '';
    if (u.pathname.endsWith('/')) hit = await c.match(u.href + 'index.html');
  }
  return hit;
}

async function cacheFirst(req, cacheName, same) {
  const hit = await lookup(req, cacheName, same);
  if (hit) return hit;
  let res;
  try {
    res = await fetch(req);
  } catch (err) {
    const old = await caches.match(req.url, { ignoreSearch: same }); // 인터넷이 없으면 예전 배포 저장본이라도
    if (old) return old;
    throw err;
  }
  // 온전한 응답만 저장 — 일부 구간(206)·내용을 못 읽는 응답(opaque)은 저장하지 않는다.
  if (res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req.url, copy)).catch(() => {});
  }
  return res;
}

async function networkFirst(req) {
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NAV_TIMEOUT_MS)),
    ]);
    if (res.status === 200) { const copy = res.clone(); caches.open(SAME).then((c) => c.put(req.url, copy)).catch(() => {}); }
    return res;
  } catch (err) {
    const hit = (await lookup(req, SAME, true)) || (await caches.match(req.url, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}
