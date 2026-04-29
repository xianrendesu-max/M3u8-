import fetch from "node-fetch";
import { pipeline } from "stream";
import { promisify } from "util";

const streamPipeline = promisify(pipeline);
const BASE_URL = "https://proxy-siawaseok.duckdns.org";

export default async function handler(req, res) {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("url パラメータが必要です");

  try {
    const response = await fetch(targetUrl);
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/vnd.apple.mpegurl") || targetUrl.endsWith(".m3u8")) {
      let body = await response.text();
      body = body.replace(/^([^#\n\r]+\.ts[^\n\r]*)$/gm, (match) => {
        const url = new URL(match.trim(), targetUrl);
        return `${BASE_URL}/proxy/m3u8?url=${encodeURIComponent(url.href)}`;
      });
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(body);
    } else {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Range");
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range");
      await streamPipeline(response.body, res);
    }
  } catch (err) {
    res.status(500).send("エラー: " + err.message);
  }
}
