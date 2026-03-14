const { app, BrowserWindow, ipcMain, Notification, nativeImage, Tray, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

// ── 데이터 저장 경로 ──────────────────────────────────────
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BANNER_FILE = path.join(DATA_DIR, 'banner.dat');
const STICKERS_FILE = path.join(DATA_DIR, 'stickers.json');
const GCAL_TOKEN_FILE = path.join(DATA_DIR, 'gcal_token.json');
const DIARY_FILE = path.join(DATA_DIR, 'diary.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── 윈도우 알림 스케줄러 ─────────────────────────────────
let notifTimers = [];

function scheduleNotifications() {
  notifTimers.forEach(t => clearTimeout(t));
  notifTimers = [];

  const todos = readJSON(TODOS_FILE, []);
  const now = new Date();
  const todayStr = toDateStr(now);

  todos
    .filter(t => t.time && t.dates && t.dates.includes(todayStr) && !t.done)
    .forEach(t => {
      const [h, m] = t.time.split(':').map(Number);
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
      const diff = target - now;
      if (diff > 0) {
        const tid = setTimeout(() => {
          sendNotification(
            `${t.important ? '⭐ ' : ''}${t.text}`,
            `${t.time} 일정 알림`
          );
        }, diff);
        notifTimers.push(tid);
      }
    });
}

function sendNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show();
  }
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── 메인 윈도우 ───────────────────────────────────────────
let mainWindow;
let tray;

function createWindow() {
  const iconPath = path.join(__dirname, 'src', 'icon.ico');
  const iconExists = fs.existsSync(iconPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 1000,
    title: '내 캘린더',
    backgroundColor: '#f0ede8',
    icon: iconExists ? iconPath : undefined,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: false,
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    const cfg = readJSON(SETTINGS_FILE, {});
    const zoom = cfg.zoom || 1.0;
    const w = Math.round(1200 * zoom);
    const h = Math.round(1000 * zoom);
    mainWindow.setResizable(true);
    mainWindow.setAspectRatio(0);
    mainWindow.setSize(w, h);
    mainWindow.setResizable(false);
    mainWindow.center();
    mainWindow.show();
    scheduleNotifications();
  });

  // 트레이 아이콘
  try {
    if (iconExists) {
      tray = new Tray(iconPath);
      const ctxMenu = Menu.buildFromTemplate([
        { label: '열기', click: () => mainWindow.show() },
        { label: '종료', click: () => { app.isQuiting = true; app.quit(); } },
      ]);
      tray.setToolTip('내 캘린더');
      tray.setContextMenu(ctxMenu);
      tray.on('double-click', () => mainWindow.show());
    }
  } catch {}

  mainWindow.on('close', e => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// GPU 디스크 캐시 접근 오류 방지
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

// ── 단일 인스턴스 (중복 실행 방지) ───────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}

// ── IPC 핸들러 ────────────────────────────────────────────

// 윈도우 제어
ipcMain.on('win-minimize', () => mainWindow.minimize());
ipcMain.on('win-maximize', () => {}); // 최대화 비활성화
ipcMain.on('win-close', () => mainWindow.hide());

// 할 일 CRUD
ipcMain.handle('todos:get', () => readJSON(TODOS_FILE, []));
ipcMain.handle('todos:save', (_, todos) => {
  writeJSON(TODOS_FILE, todos);
  scheduleNotifications();
  return true;
});

// 설정
ipcMain.handle('settings:get', () => readJSON(SETTINGS_FILE, {}));
ipcMain.handle('settings:save', (_, settings) => { writeJSON(SETTINGS_FILE, settings); return true; });

// 배너 (base64)
ipcMain.handle('banner:get', () => {
  try { return fs.readFileSync(BANNER_FILE, 'utf8'); } catch { return null; }
});
ipcMain.handle('banner:save', (_, data) => {
  fs.writeFileSync(BANNER_FILE, data, 'utf8');
  return true;
});
ipcMain.handle('banner:clear', () => {
  try { fs.unlinkSync(BANNER_FILE); } catch {}
  return true;
});

// 스티커
ipcMain.handle('stickers:get', () => readJSON(STICKERS_FILE, []));
ipcMain.handle('stickers:save', (_, stickers) => { writeJSON(STICKERS_FILE, stickers); return true; });

// 일기
ipcMain.handle('diary:get', () => readJSON(DIARY_FILE, {}));
ipcMain.handle('diary:save', (_, diary) => { writeJSON(DIARY_FILE, diary); return true; });

// 창 크기 조절 (배율)
ipcMain.handle('win:setZoom', (_, zoom) => {
  const w = Math.round(1200 * zoom);
  const h = Math.round(1000 * zoom);
  mainWindow.setResizable(true);
  mainWindow.setAspectRatio(0);
  mainWindow.setSize(w, h);
  mainWindow.setResizable(false);
  mainWindow.center();
  return true;
});

// 알림 즉시 발송 (타이머/뽀모도로)
ipcMain.on('notify', (_, { title, body }) => sendNotification(title, body));

// 알림 재스케줄 (앱 재시작 없이)
ipcMain.on('reschedule', () => scheduleNotifications());

// ── 시작 프로그램 ──────────────────────────────────────────
ipcMain.handle('startup:get', () => {
  if (!app.isPackaged) return false; // 개발 중엔 항상 false
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('startup:set', (_, enable) => {
  if (!app.isPackaged) {
    return { ok: false, reason: '개발 모드에서는 설정할 수 없습니다.' };
  }
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: app.getPath('exe'),
  });
  return { ok: true };
});

// ── Google Calendar (외부 브라우저 + PKCE) ────────────────

// TODO: 아래 문자열을 네 Google Cloud OAuth "데스크톱 앱" 클라이언트 ID로 교체하세요.
// 예시 형태: 1234567890-abcdefghijklmopqrstuv.apps.googleusercontent.com
const GOOGLE_CLIENT_ID     = '1';
const GOOGLE_CLIENT_SECRET = '1';
const GCAL_SCOPES    = 'https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function readGcalToken() {
  return readJSON(GCAL_TOKEN_FILE, null);
}

function writeGcalToken(token) {
  writeJSON(GCAL_TOKEN_FILE, token);
}

async function refreshAccessToken(stored) {
  if (!stored.refresh_token) throw new Error('refresh_token이 없습니다. 다시 로그인해주세요.');
  const params = new URLSearchParams();
  params.set('client_id',     GOOGLE_CLIENT_ID);
  params.set('client_secret', GOOGLE_CLIENT_SECRET);
  params.set('grant_type',    'refresh_token');
  params.set('refresh_token', stored.refresh_token);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) { const t = await res.text().catch(()=>''); throw new Error(t || `Token refresh failed: ${res.status}`); }
  const token = await res.json();
  const updated = { access_token: token.access_token, refresh_token: stored.refresh_token, expires_at: token.expires_in ? Date.now() + token.expires_in * 1000 : null };
  writeGcalToken(updated);
  return updated.access_token;
}

async function getValidAccessToken() {
  const stored = readGcalToken();
  if (!stored?.access_token) throw new Error('Google 계정이 연결되어 있지 않습니다.');
  if (stored.expires_at && stored.expires_at < Date.now() + 60 * 1000) return await refreshAccessToken(stored);
  return stored.access_token;
}

ipcMain.handle('gcal:startAuth', async () => {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('Google Client ID가 설정되지 않았습니다.');
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);

  const server = http.createServer();

  const { code, redirectUri } = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      try {
        const urlObj = new URL(req.url, 'http://127.0.0.1');
        const authCode = urlObj.searchParams.get('code');
        const error = urlObj.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body><h2>로그인이 완료되었습니다.</h2><p>이 창을 닫고 앱으로 돌아가세요.</p></body></html>');

        if (error) {
          reject(new Error(error));
        } else if (authCode) {
          const addr = server.address();
          const redirect = addr ? `http://127.0.0.1:${addr.port}` : null;
          resolve({ code: authCode, redirectUri: redirect });
        } else {
          reject(new Error('No code in callback'));
        }
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const redirect = addr ? `http://127.0.0.1:${addr.port}` : null;

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirect);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', GCAL_SCOPES);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      shell.openExternal(authUrl.toString()).catch(reject);
    });

    server.on('error', err => {
      reject(err);
    });
  });

  const params = new URLSearchParams();
  params.set('client_id',     GOOGLE_CLIENT_ID);
  params.set('client_secret', GOOGLE_CLIENT_SECRET);
  params.set('grant_type',    'authorization_code');
  params.set('code', code);
  if (redirectUri) params.set('redirect_uri', redirectUri);
  params.set('code_verifier', verifier);

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Token exchange failed: ${res.status}`);
  }

  const token = await res.json();
  const now = Date.now();
  const stored = {
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    expires_at: token.expires_in ? now + token.expires_in * 1000 : null,
  };
  writeGcalToken(stored);

  return { success: true };
});

ipcMain.handle('gcal:disconnect', () => {
  try { fs.unlinkSync(GCAL_TOKEN_FILE); } catch {}
  return true;
});

ipcMain.handle('gcal:getEvents', async (_event, { timeMin, timeMax }) => {
  const accessToken = await getValidAccessToken();

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  if (timeMin) url.searchParams.set('timeMin', timeMin);
  if (timeMax) url.searchParams.set('timeMax', timeMax);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Google API error: ${res.status}`);
  }

  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
});