import ytdl from "@distube/ytdl-core";

export default async function handler(req, res) {
  const { id: videoId } = req.query;
  if (!videoId || !ytdl.validateID(videoId)) {
    return res.status(400).json({ error: "有効な videoId が必要です" });
  }
  try {
    const info = await ytdl.getInfo(videoId, {
      // Vercel(EROFS)対策: ファイル書き込みを抑制し、キャッシュを無効化
      lang: 'ja',
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'ja-JP,ja;q=0.9',
        }
      }
    });
    res.json(info);
  } catch (err) {
    console.error("❌ getInfo error:", err);
    res.status(500).json({ error: "動画情報の取得中にエラーが発生しました" });
  }
}
