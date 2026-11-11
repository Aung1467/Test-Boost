// Supabase Edge Function: fetch-trending
// Deploy:  supabase functions deploy fetch-trending
// Trending TikTok video တွေကို ပြင်ပ source ကနေ ဆွဲပြီး trending_videos table ထဲ သိမ်းပေးသည်
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ကို Supabase က အလိုအလျောက် ပေးထားပြီးသား)

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const REGIONS = ["US", "GB", "SG", "TH", "ID", "PH"];   // ဘယ် region က trending ယူမလဲ
const COOLDOWN_MIN = 10;                                 // source ကို မကြာခဏ မခေါ်အောင်
const KEEP_DAYS = 3;                                     // ဟောင်းတာတွေ ဖျက်

type Item = { video_id?: string; id?: string; author?: { unique_id?: string } };

async function pull(region: string): Promise<{ url: string; id: string }[]> {
  // ⚠️ တရားဝင် TikTok API မဟုတ်ပါ — ပြင်ပ service တစ်ခု၊ ရပ်သွား/ပြောင်းသွားနိုင်သည်
  const r = await fetch(`https://www.tikwm.com/api/feed/list?region=${region}&count=30`, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
  });
  if (!r.ok) return [];
  const j = await r.json();
  const out: { url: string; id: string }[] = [];
  for (const it of (j?.data ?? []) as Item[]) {
    const id = String(it.video_id ?? it.id ?? "");
    const user = it.author?.unique_id;
    if (/^\d{8,25}$/.test(id) && user && /^[\w.]+$/.test(user)) {
      out.push({ url: `https://www.tiktok.com/@${user}/video/${id}`, id });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // cooldown: မကြာသေးခင်က ဆွဲပြီးသားဆိုရင် ထပ်မဆွဲ
    const { data: last } = await db.from("trending_videos")
      .select("fetched_at").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.fetched_at).getTime() < COOLDOWN_MIN * 60_000) {
      return json({ added: 0, cached: true });
    }

    const seen = new Set<string>();
    const rows: { video_url: string; video_id: string; active: boolean; fetched_at: string }[] = [];
    for (const region of REGIONS) {
      try {
        for (const v of await pull(region)) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          rows.push({ video_url: v.url, video_id: v.id, active: true, fetched_at: new Date().toISOString() });
        }
      } catch (_e) { /* region တစ်ခု မရရင် ကျော် */ }
      if (rows.length >= 60) break;
    }
    if (!rows.length) return json({ error: "SOURCE_UNAVAILABLE" }, 502);

    await db.from("trending_videos").upsert(rows, { onConflict: "video_url" });
    await db.from("trending_videos").delete()
      .lt("fetched_at", new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString());

    return json({ added: rows.length });
  } catch (_e) {
    return json({ error: "FETCH_FAILED" }, 500);
  }
});
