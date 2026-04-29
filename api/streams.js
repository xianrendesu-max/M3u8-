import ytdl from "@distube/ytdl-core";

export default async function handler(req, res) {
  const { id: videoId } = req.query;
  if (!videoId || !ytdl.validateID(videoId)) {
    return res.status(400).json({ error: "有効な videoId が必要です" });
  }
  try {
    const info = await ytdl.getInfo(videoId);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: "動画情報の取得中にエラーが発生しました" });
  }
}
