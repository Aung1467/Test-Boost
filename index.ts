
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown) =>
  new Response(JSON.stringify(b), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

const URL_RE = /^https:\/\/www\.tiktok\.com\/@[\w.]+\/video\/\d{8,25}$/;
const MAX_AGE_MS = 30 * 60_000;    
const TRIES = 3;                  
const GAP_MS = 2500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function likeCount(url: string): Promise<number | null> {
  try {
    const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    });
    if (!r.ok) return null;
    const n = (await r.json())?.data?.digg_count;
    return typeof n === "number" ? n : null;
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: u } = await userDb.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return json({ ok: false, code: "JWT" });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const taskId = String(body.task_id ?? "");
    const videoUrl = String(body.video_url ?? "");
    const trending = !!body.trending;
    if (!taskId || !URL_RE.test(videoUrl.split("?")[0])) return json({ ok: false, code: "NO_TASK" });
    const cleanUrl = videoUrl.split("?")[0];

    // ---- start: Like အရေအတွက် အစမှတ်ယူ ----
    if (action === "start") {
      let n = await likeCount(cleanUrl);
      if (n === null) { await sleep(1200); n = await likeCount(cleanUrl); }   // tikwm: 1 req/sec
      if (n === null) return json({ ok: false, code: "VERIFY_UNAVAILABLE" });
      const { error } = await admin.from("like_checks").upsert(
        { user_id: uid, task_id: taskId, video_url: cleanUrl, baseline: n, created_at: new Date().toISOString() },
        { onConflict: "user_id,task_id" },
      );
      return json(error ? { ok: false, code: "VERIFY_UNAVAILABLE" } : { ok: true });
    }

    // ---- claim: Like တိုးမတိုးစစ်ပြီးမှ Credit ထည့် ----
    if (action === "claim") {
      const { data: row } = await admin.from("like_checks").select("*")
        .eq("user_id", uid).eq("task_id", taskId).maybeSingle();
      if (!row || row.video_url !== cleanUrl) return json({ ok: false, code: "NO_BASELINE" });
      if (Date.now() - new Date(row.created_at).getTime() > MAX_AGE_MS) {
        await admin.from("like_checks").delete().eq("user_id", uid).eq("task_id", taskId);
        return json({ ok: false, code: "NO_BASELINE" });
      }

      let liked = false, reachable = false;
      for (let i = 0; i < TRIES && !liked; i++) {
        if (i) await sleep(GAP_MS);
        const n = await likeCount(cleanUrl);
        if (n === null) continue;
        reachable = true;
        if (n > row.baseline) liked = true;
      }
      if (!liked) return json({ ok: false, code: reachable ? "LIKE_NOT_FOUND" : "VERIFY_UNAVAILABLE" });

      
      const { data, error } = trending
        ? await userDb.rpc("complete_trending_task", { p_task: taskId, p_duration: null })
        : await userDb.rpc("complete_order_task", { p_task: taskId, p_watched: 3, p_dur: 3 });
      if (error) return json({ ok: false, code: error.message ?? "FAILED" });

      await admin.from("like_checks").delete().eq("user_id", uid).eq("task_id", taskId);
      return json({ ok: true, credit: data });
    }

    return json({ ok: false, code: "NO_TASK" });
  } catch (_e) {
    return json({ ok: false, code: "VERIFY_UNAVAILABLE" });
  }
});
