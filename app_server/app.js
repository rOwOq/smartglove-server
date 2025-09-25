'use strict';

// MIDAS 단일 서버 (회원가입/로그인, Vision/Translate, FCM, 위치 저장/조회 통합)

const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

// Google Cloud SDKs
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const { TranslationServiceClient } = require('@google-cloud/translate').v3;

// Firebase Admin (FCM)
const admin = require('firebase-admin');

const app = express();
app.disable('x-powered-by');

// ---------------- CONFIG ----------------
const GCP_KEY_FILE = process.env.GCP_KEY_FILE
  || path.resolve(__dirname, '');
const FCM_KEY_FILE = process.env.FCM_ADMIN_KEY
  || path.resolve(__dirname, '');

const PROJECT_ID = process.env.GCP_PROJECT_ID || (require(GCP_KEY_FILE).project_id);
const LOCATION = process.env.GCP_LOCATION || 'global';
const PORT = process.env.PORT || 3000;

const DB_HOST = process.env.DB_HOST || '';
const DB_PORT = +(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || '';
const DB_PASS = process.env.DB_PASS || '';
const DB_NAME = process.env.DB_NAME || '';

// Firebase Admin 초기화
const SERVICE_ACCOUNT = require(FCM_KEY_FILE);
admin.initializeApp({
  credential: admin.credential.cert(SERVICE_ACCOUNT),
  projectId: SERVICE_ACCOUNT.project_id,
});
console.log(`[OK] Firebase Admin 초기화 완료 : ${SERVICE_ACCOUNT.project_id}`);

// GCP Clients
const visionClient = new ImageAnnotatorClient({ keyFilename: GCP_KEY_FILE });
const translateClient = new TranslationServiceClient({ keyFilename: GCP_KEY_FILE });

// MySQL 풀
let pool;
(async () => {
  pool = await mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z',
    charset: 'utf8mb4',
  });
  console.log(`[OK] MySQL 연결 성공 : ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);
})().catch((e) => {
  console.error('❌ MySQL 연결 실패:', e);
  process.exit(1);
});

// ---------------- MIDDLEWARE ----------------
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------------- HEALTH CHECK ----------------
app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'vision+translate+fcm',
    fcm_project: SERVICE_ACCOUNT.project_id,
    gcp_project: PROJECT_ID,
    db: DB_NAME,
    ts: Date.now(),
  });
});

// ---------------- AUTH ----------------
app.post('/api/register', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { login_id, password, role } = req.body || {};
    if (!login_id || !password || !role) {
      return res.status(400).json({ ok: false, error: 'login_id, password, role 필요' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const [rows] = await conn.execute('SELECT * FROM user WHERE login_id = ?', [login_id]);
    if (rows.length > 0) return res.status(409).json({ ok: false, error: '이미 존재하는 login_id' });

    await conn.execute(
      'INSERT INTO user (login_id, password, role) VALUES (?, ?, ?)',
      [login_id, hashed, role]
    );
    return res.json({ ok: true, message: '회원가입 성공' });
  } catch (e) {
    console.error('/api/register error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  } finally { conn.release(); }
});

app.post('/api/login', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { login_id, password } = req.body || {};
    if (!login_id || !password) {
      return res.status(400).json({ ok: false, error: 'login_id, password 필요' });
    }
    const [rows] = await conn.execute('SELECT * FROM user WHERE login_id = ?', [login_id]);
    if (rows.length === 0) return res.status(401).json({ ok: false, error: '아이디 없음' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ ok: false, error: '비밀번호 불일치' });

    return res.json({ ok: true, user_id: user.user_id, role: user.role });
  } catch (e) {
    console.error('/api/login error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  } finally { conn.release(); }
});

// ---------------- Vision + Translate ----------------
function compactLabels(labelAnnotations) {
  const sorted = [...(labelAnnotations || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
  const uniq = [];
  const seen = new Set();
  for (const l of sorted) {
    const t = (l?.description || '').trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      uniq.push(t);
    }
    if (uniq.length >= 30) break;
  }
  return uniq.slice(0, 5);
}
function toImageBuffer(b64OrDataUrl) {
  const m = /^data:.*;base64,(.+)$/i.exec(b64OrDataUrl || '');
  return Buffer.from(m ? m[1] : (b64OrDataUrl || ''), 'base64');
}
app.post('/api/generate-description', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ description: '이미지 없음' });
    const imgBuffer = toImageBuffer(image);
    const [visionRes] = await visionClient.labelDetection({ image: { content: imgBuffer } });
    const topLabels = compactLabels(visionRes?.labelAnnotations);
    if (topLabels.length === 0) return res.json({ description: '인식된 객체 없음' });

    let koList = [];
    try {
      const [tres] = await translateClient.translateText({
        parent: `projects/${PROJECT_ID}/locations/${LOCATION}`,
        contents: topLabels,
        mimeType: 'text/plain',
        sourceLanguageCode: 'en',
        targetLanguageCode: 'ko',
      });
      koList = (tres.translations || []).map(t => t.translatedText).filter(Boolean);
    } catch { koList = topLabels; }

    return res.json({ description: `사진 객체: ${koList.join(', ')}` });
  } catch (err) {
    console.error('generate-description error:', err);
    return res.status(500).json({ description: '오류 발생' });
  }
});

// ---------------- FCM + Guardian Link ----------------
// FCM 토큰 등록
app.post('/api/fcm/register-token', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { user_id, fcm_token } = req.body || {};
    if (!user_id || !fcm_token) return res.status(400).json({ ok: false, error: 'user_id, fcm_token 필요' });
    await conn.execute('UPDATE `user` SET fcm_token=? WHERE user_id=?', [fcm_token, user_id]);
    await conn.execute(
      'INSERT INTO user_tokens (user_id, fcm_token, created_at) VALUES (?, ?, NOW())',
      [user_id, fcm_token]
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('register-token error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  } finally { conn.release(); }
});

// 보호자 알림 전송
app.post('/api/fcm/notify', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { user_id, title, body, data } = req.body || {};
    if (!user_id) return res.status(400).json({ ok: false, error: 'user_id 필요' });
    const [rows] = await conn.execute(
      `SELECT u.fcm_token FROM guardian_link gl
       JOIN user u ON u.user_id = gl.guardian_user_id
       WHERE gl.gloves_user_id=? AND u.fcm_token IS NOT NULL AND u.fcm_token<>''`,
      [user_id]
    );
    const tokens = rows.map(r => r.fcm_token);
    if (tokens.length === 0) return res.status(404).json({ ok: false, error: '토큰 없음' });

    const resp = await admin.messaging().sendEachForMulticast({
      notification: { title: title || 'MIDAS 알림', body: body || '' },
      tokens,
      data: data ? Object.fromEntries(Object.entries(data)) : undefined,
    });
    return res.json({ ok: true, success: resp.successCount, failure: resp.failureCount });
  } catch (e) {
    console.error('/api/fcm/notify error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  } finally { conn.release(); }
});
// Flutter 호환 alias
app.post('/api/send-notification', (req, res) => {
  req.url = '/api/fcm/notify';
  return app._router.handle(req, res, () => {});
});

// 사용자 ↔ 보호자 연동
app.post('/api/link-user', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { gloves_user_id, guardian_user_id } = req.body || {};
    if (!gloves_user_id || !guardian_user_id) {
      return res.status(400).json({ ok: false, error: 'gloves_user_id, guardian_user_id 필요' });
    }
    await conn.execute(
      'INSERT IGNORE INTO guardian_link (gloves_user_id, guardian_user_id) VALUES (?, ?)',
      [gloves_user_id, guardian_user_id]
    );
    return res.json({ ok: true, message: '연동 성공' });
  } catch (e) {
    console.error('/api/link-user error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  } finally { conn.release(); }
});

// ---------------- 위치 저장 / 조회 ----------------
app.post('/api/position', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { user_id, latitude, longitude } = req.body || {};
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (!user_id || isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ ok: false, error: '유효한 좌표 필요' });
    }

    // 무조건 저장 (중복 체크 제거) -> event 테이블 사용
    await conn.execute(
      `INSERT INTO event (user_id, latitude, longitude, timestamp, motion_type, alert_type, glove_connected, sensor_status)
       VALUES (?, ?, ?, NOW(), 'location', 'auto', 1, 'ok')`,
      [user_id, lat, lon]
    );

    console.log(`✅ 위치 저장: user_id=${user_id}, lat=${lat}, lon=${lon}`);
    return res.json({ ok: true, message: '위치 저장 완료' });
  } catch (e) {
    console.error('/api/position error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  } finally {
    conn.release();
  }
});

//  최신 위치 조회
app.get('/api/position/latest/:userId', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = parseInt(req.params.userId, 10);
    const [rows] = await conn.execute(
      `
      SELECT
        CAST(latitude  AS DECIMAL(10,8)) AS latitude,
        CAST(longitude AS DECIMAL(11,8)) AS longitude,
        timestamp
      FROM event
      WHERE user_id = ?
        AND motion_type = 'location'
      ORDER BY timestamp DESC
      LIMIT 1
      `,
      [userId]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: '위치 기록 없음' });

    const r = rows[0];
    return res.json({
      ok: true,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      timestamp: r.timestamp,
    });
  } catch (e) {
    console.error('/api/position/latest error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  } finally { conn.release(); }
});
// 위치 이력 조회
app.get('/api/position/history/:userId', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const userId = parseInt(req.params.userId, 10);
    const [rows] = await conn.execute(
      `
      SELECT
        CAST(latitude  AS DECIMAL(10,8)) AS latitude,
        CAST(longitude AS DECIMAL(11,8)) AS longitude,
        timestamp
      FROM event
      WHERE user_id = ?
        AND motion_type = 'location'
      ORDER BY timestamp DESC
      LIMIT 50
      `,
      [userId]
    );

    const locations = rows.map(r => ({
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      timestamp: r.timestamp,
    }));

    return res.json({ ok: true, count: locations.length, locations });
  } catch (e) {
    console.error('/api/position/history error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  } finally { conn.release(); }
});
// 보호자 → 연동 사용자들의 최신 위치 목록 (목록용)
app.get('/api/guardian/:guardianId/users-location', async (req, res) => {
  const guardianId = parseInt(req.params.guardianId, 10);
  if (Number.isNaN(guardianId)) {
    return res.status(400).json({ ok: false, error: 'invalid guardianId' });
  }

  // 기본 5개, 1~200 사이로만 허용
  let limit = parseInt(String(req.query.limit ?? '5'), 10);
  if (!Number.isFinite(limit)) limit = 5;
  if (limit < 1) limit = 1;
  if (limit > 200) limit = 200;

  try {
    const [rows] = await pool.execute(
      `
      SELECT
        e.event_id  AS id,
        e.user_id,
        CAST(e.latitude  AS DECIMAL(10,8)) AS latitude,
        CAST(e.longitude AS DECIMAL(11,8)) AS longitude,
        e.timestamp AS timestamp
      FROM event e
      INNER JOIN guardian_link gl
        ON gl.gloves_user_id = e.user_id
      WHERE gl.guardian_user_id = ?
        AND e.motion_type = 'location'
      ORDER BY e.timestamp DESC
      LIMIT ${limit}
      `,
      [guardianId]
    );

    const data = rows.map(r => ({
      id: Number(r.id),
      user_id: Number(r.user_id),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      timestamp: r.timestamp,
    }));

    return res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error('[users-location] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});
// ---------------- START ----------------
app.listen(PORT, () => {
  console.log(`[OK] MIDAS 단일 서버 실행 중 :${PORT}`);
  console.log(`PROJECT_ID=${PROJECT_ID} LOCATION=${LOCATION}`);
  console.log(`DB ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);
});
