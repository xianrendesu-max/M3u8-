import express from "express";
import https from "https";
import fetch from "node-fetch";
import ytdl from "@distube/ytdl-core";

const router = express.Router();
const app = express();

const CONFIG_URL = "https://raw.githubusercontent.com/siawaseok3/wakame/master/video_config.json";
const BASE_URL = "https://proxy-siawaseok.duckdns.org";

// YouTube ID バリデーション
function validateYouTubeId(req, res, next) {
  const { id } = req.params;
  if (!/^[\w-]{11}$/.test(id)) {
    return res.status(400).json({ error: "validateYouTubeIdでエラー" });
  }
  next();
}

// 設定ファイル取得
function fetchConfigJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("fetchConfigJsonでエラー"));
      }
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error("fetchConfigJsonでエラー")); }
      });
    }).on("error", () => reject(new Error("fetchConfigJsonでエラー")));
  });
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (xff ? xff.split(',')[0] : req.socket.remoteAddress)?.trim();
}

// レートリミット（Vercel内での簡易実装。本格的にはRedis推奨）
const rateLimiters = new Map();
function ipRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const timestamps = (rateLimiters.get(ip) || []).filter(ts => now - ts < 60000);
  if (timestamps.length >= 4) return res.status(429).json({ error: 'Rate limit exceeded' });
  timestamps.push(now);
  rateLimiters.set(ip, timestamps);
  next();
}

// Routes
router.get("/:id", validateYouTubeId, async (req, res) => {
  const { id } = req.params;
  try {
    const config = await fetchConfigJson(CONFIG_URL);
    const params = config.params || "";
    res.json({ url: `https://www.youtubeeducation.com/embed/${id}${params}` });
  } catch { res.status(500).json({ error: "type1でエラー" }); }
});

router.get("/:id/type2", validateYouTubeId, async (req, res) => {
  const { id } = req.params;
  // Vercel上の自分自身のstreams APIを叩く
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const apiUrl = `${protocol}://${req.headers.host}/api/streams/${id}`;

  const parseHeight = (format) => {
    if (typeof format.height === "number") return format.height;
    const match = /x(\d+)/.exec(format.resolution || "");
    return match ? parseInt(match[1]) : null;
  };

  const selectUrlLocal = (urls) => {
    if (!urls?.length) return null;
    const jaUrl = urls.find((u) => decodeURIComponent(u).includes("lang=ja"));
    return jaUrl || urls[0];
  };

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`local API取得エラー: ${response.status}`);
    const data = await response.json();
    const formats = Array.isArray(data.formats) ? data.formats : [];
    const videourl = {};
    const m3u8 = {};
    const audioUrls = formats.filter((f) => f.acodec !== "none" && f.vcodec === "none").map((f) => f.url);
    const audioOnlyUrl = selectUrlLocal(audioUrls);
    const extPriority = ["webm", "mp4", "av1"];
    const formatsByHeight = {};
    for (const f of formats) {
      const height = parseHeight(f);
      if (!height || f.vcodec === "none" || !f.url) continue;
      const label = `${height}p`;
      if (!formatsByHeight[label]) formatsByHeight[label] = [];
      formatsByHeight[label].push(f);
    }
    for (const [label, list] of Object.entries(formatsByHeight)) {
      const m3u8List = list.filter((f) => f.url.includes(".m3u8"));
      if (m3u8List.length > 0) m3u8[label] = { url: { url: selectUrlLocal(m3u8List.map((f) => f.url)) } };
      const normalList = list.filter((f) => !f.url.includes(".m3u8")).sort((a, b) => extPriority.indexOf(a.ext || "") - extPriority.indexOf(b.ext || ""));
      if (normalList.length > 0) videourl[label] = { video: { url: selectUrlLocal([normalList[0].url]) }, audio: { url: audioOnlyUrl } };
    }
    res.json({ videourl, m3u8 });
  } catch (e) { res.status(500).json({ error: "type2でエラー" }); }
});

router.get("/download/:id", async (req, res) => {
  const { id } = req.params;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  try {
    const response = await fetch(`${protocol}://${req.headers.host}/api/streams/${id}`);
    const data = await response.json();
    const result = { "audio only": [], "video only": [], "audio&video": [], "m3u8 raw": [], "m3u8 proxy": [] };
    for (const f of data.formats) {
      if (!f.url) continue;
      const url = f.url.toLowerCase();
      if (url.includes("lang=") && !url.includes("lang=ja")) continue;
      if (url.endsWith(".m3u8")) {
        const m3u8Data = { url: f.url, resolution: f.resolution, vcodec: f.vcodec, acodec: f.acodec };
        result["m3u8 raw"].push(m3u8Data);
        result["m3u8 proxy"].push({ ...m3u8Data, url: `${BASE_URL}/proxy/m3u8?url=${encodeURIComponent(f.url)}` });
        continue;
      }
      if (f.resolution === "audio only" || f.vcodec === "none") result["audio only"].push(f);
      else if (f.acodec === "none") result["video only"].push(f);
      else result["audio&video"].push(f);
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
});

router.get('/v2/:videoId', ipRateLimit, async (req, res) => {
  const { videoId } = req.params;
  const ip = getClientIp(req);
  const cookieHeader = req.headers.cookie || "";
  const webappnameMatch = cookieHeader.match(/webappname=([^;]+)/);
  const webappname = webappnameMatch ? webappnameMatch[1].trim() : null;

  if (!ip) return res.status(403).json({ error: 'Forbidden: blocked (no IP)' });
  if (webappname !== 'siatube') return res.status(403).json({ error: 'Forbidden: blocked (invalid cookie)' });

  try {
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`, {
      requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0...', 'Accept-Language': 'ja-JP,ja;q=0.9' } }
    });
    const result = {};
    const muxed360p = info.formats.find((f) => f.hasVideo && f.hasAudio && f.height === 360);
    result.muxed360p = { url: muxed360p?.url || null };
    const japaneseAudio = info.formats.find((f) => f.itag === 140 && f.hasAudio && !f.hasVideo);
    const targetResolutions = [4320, 2160, 1440, 1080, 720];
    for (const height of targetResolutions) {
      const video = info.formats.find((f) => f.container === 'webm' && f.height === height && f.hasVideo && !f.hasAudio);
      if (video && japaneseAudio) result[`${height}p`] = { video: { url: video.url }, audio: { url: japaneseAudio.url } };
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch' }); }
});

app.use("/api/video", router);
export default app;
