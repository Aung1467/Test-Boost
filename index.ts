// Supabase Edge Function: verify-like  (deploy: supabase functions deploy verify-like)
// Like တကယ်ပေးမပေး စစ်ပြီးမှ Credit ထည့်ပေးသည်။
// နည်းလမ်း: Video ရဲ့ Like အရေအတွက်ကို "စတင်ချိန်" နဲ့ "ရယူချိန်" နှိုင်းယှဉ် (tikwm.com သုံး)
// ⚠️ TikTok တရားဝင် API မဟုတ်ပါ။ အရေအတွက် တိုးမတိုး ကြည့်ခြင်းသာဖြစ်ပြီး "ဘယ်သူ ပေးသလဲ" ကို အတိအကျ မသိနိုင်ပါ။
// Video URL ကို Client ကပို့တာ မယုံ — Task ကနေ Server ကိုယ်တိုင် ရှာသည်။
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown) =>
  new Response(JSON.stringify(b), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

const URL_RE = /^https:\/\/www\.tiktok\.com\/@[\w.]+\/video\/\d{8,25}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE_MS = 30 * 60_000;     // စတင်ပြီး မိနစ် ၃၀ ကျော်ရင် မရတော့
const TRIES = 3;                    // TikTok count update နောက်ကျတတ်လို့ ၃ ကြိမ်စစ်
const GAP_MS = 2500;

const LOCK_AFTER = 3;               // Like မပေးဘဲ claim လုပ်တာ ၃ ကြိမ်ဆက်တိုက်ဖြစ်ရင်
const LOCK_SEC = 180;               // ၃ မိနစ် ပိတ်ထား

// deno-lint-ignore no-explicit-any
async function lockLeft(admin: any, uid: string): Promise<number> {
  const { data } = await admin.from("like_strikes").select("locked_until").eq("user_id", uid).maybeSingle();
  if (!data?.locked_until) return 0;
  const left = new Date(data.locked_until).getTime() - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}
// deno-lint-ignore no-explicit-any
async function addStrike(admin: any, uid: string): Promise<number> {   // lock ကျသွားရင် စက္ကန့်ပြန်
  const { data } = await admin.from("like_strikes").select("strikes").eq("user_id", uid).maybeSingle();
  const n = (data?.strikes ?? 0) + 1;
  if (n >= LOCK_AFTER) {
    await admin.from("like_strikes").upsert(
      { user_id: uid, strikes: 0, locked_until: new Date(Date.now() + LOCK_SEC * 1000).toISOString() },
      { onConflict: "user_id" },
    );
    return LOCK_SEC;
  }
  await admin.from("like_strikes").upsert({ user_id: uid, strikes: n, locked_until: null }, { onConflict: "user_id" });
  return 0;
}
// deno-lint-ignore no-explicit-any
async function clearStrikes(admin: any, uid: string) {
  await admin.from("like_strikes").upsert({ user_id: uid, strikes: 0, locked_until: null }, { onConflict: "user_id" });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tikData(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    });
    if (!r.ok) return null;
    return (await r.json())?.data ?? null;
  } catch (_e) {
    return null;
  }
}
async function likeCount(url: string): Promise<number | null> {
  const n = (await tikData(url))?.digg_count;
  return typeof n === "number" ? n : null;
}
async function videoDuration(url: string): Promise<number | null> {
  const n = (await tikData(url))?.duration;       // စက္ကန့်
  return typeof n === "number" ? n : null;
}

// Task ရဲ့ Video URL ကို DB ကနေ ရှာ (ကိုယ့် Task၊ မ claim ရသေးတာ၊ Like အမျိုးအစားသာ)
// deno-lint-ignore no-explicit-any
async function taskUrl(admin: any, uid: string, taskId: string, trending: boolean): Promise<string | null> {
  if (trending) {
    const { data: t } = await admin.from("trending_tasks")
      .select("video_id, claimed, kind").eq("id", taskId).eq("user_id", uid).maybeSingle();
    if (!t || t.claimed || t.kind !== "like") return null;
    const { data: v } = await admin.from("trending_videos")
      .select("video_url").eq("video_id", t.video_id).maybeSingle();
    return v?.video_url ?? null;
  }
  const { data: t } = await admin.from("video_order_tasks")
    .select("order_id, claimed").eq("id", taskId).eq("user_id", uid).maybeSingle();
  if (!t || t.claimed) return null;
  const { data: o } = await admin.from("video_orders")
    .select("video_url, kind, status").eq("id", t.order_id).maybeSingle();
  if (!o || o.kind !== "like" || o.status !== "open") return null;
  return o.video_url ?? null;
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
    // ---- info: Video အရှည် (စက္ကန့်) — ကြည့်ရှုမှု order မှာ ကြာချိန်ကန့်သတ်ဖို့ ----
    if (action === "info") {
      const vu = String(body.video_url ?? "").split("?")[0];
      if (!URL_RE.test(vu)) return json({ ok: false, code: "NO_TASK" });
      let d = await videoDuration(vu);
      if (d === null) { await sleep(1200); d = await videoDuration(vu); }
      return json(d === null ? { ok: false, code: "VERIFY_UNAVAILABLE" } : { ok: true, duration: Math.round(d) });
    }

    // ---- lock ကျနေရင် start / claim မရ ----
    if (action === "start" || action === "claim") {
      const left = await lockLeft(admin, uid);
      if (left > 0) return json({ ok: false, code: "LOCKED", wait: left });
    }

    const taskId = String(body.task_id ?? "");
    const trending = !!body.trending;
    if (!UUID_RE.test(taskId)) return json({ ok: false, code: "NO_TASK" });

    const videoUrl = await taskUrl(admin, uid, taskId, trending);
    if (!videoUrl || !URL_RE.test(videoUrl)) return json({ ok: false, code: "NO_TASK" });

    // ---- start: Like အရေအတွက် အစမှတ်ယူ ----
    if (action === "start") {
      let n = await likeCount(videoUrl);
      if (n === null) { await sleep(1200); n = await likeCount(videoUrl); }   // tikwm: 1 req/sec
      if (n === null) return json({ ok: false, code: "VERIFY_UNAVAILABLE" });
      const { error } = await admin.from("like_checks").upsert(
        { user_id: uid, task_id: taskId, video_url: videoUrl, baseline: n,
          created_at: new Date().toISOString(), verified_at: null },
        { onConflict: "user_id,task_id" },
      );
      return json(error ? { ok: false, code: "VERIFY_UNAVAILABLE" } : { ok: true });
    }

    // ---- claim: Like တိုးမတိုးစစ် → verified မှတ် → RPC (RPC ကလည်း verified မှတ်ကို ထပ်စစ်) ----
    if (action === "claim") {
      const { data: row } = await admin.from("like_checks").select("*")
        .eq("user_id", uid).eq("task_id", taskId).maybeSingle();
      if (!row) return json({ ok: false, code: "NO_BASELINE" });
      if (Date.now() - new Date(row.created_at).getTime() > MAX_AGE_MS) {
        await admin.from("like_checks").delete().eq("user_id", uid).eq("task_id", taskId);
        return json({ ok: false, code: "NO_BASELINE" });
      }

      if (!row.verified_at) {
        let liked = false, reachable = false;
        for (let i = 0; i < TRIES && !liked; i++) {
          if (i) await sleep(GAP_MS);
          const n = await likeCount(videoUrl);
          if (n === null) continue;
          reachable = true;
          if (n > row.baseline) liked = true;
        }
        if (!liked) {
          if (!reachable) return json({ ok: false, code: "VERIFY_UNAVAILABLE" });
          // Like မတွေ့: ဒီ task ကို ပြန်မစစ်စေ (baseline ဖျက်)၊ ကြိမ်ရေတိုး၊ များရင် lock
          await admin.from("like_checks").delete().eq("user_id", uid).eq("task_id", taskId);
          const lock = await addStrike(admin, uid);
          return json({ ok: false, code: "LIKE_NOT_FOUND", lock });
        }
        await admin.from("like_checks").update({ verified_at: new Date().toISOString() })
          .eq("user_id", uid).eq("task_id", taskId);
      }

      // user ရဲ့ JWT နဲ့ ရှိပြီးသား RPC ခေါ် (RPC က verified_at ရှိမှ Credit ပေး၊ ပြီးရင် မှတ်တမ်းဖျက်)
      const { data, error } = trending
        ? await userDb.rpc("complete_trending_task", { p_task: taskId, p_duration: null })
        : await userDb.rpc("complete_order_task", { p_task: taskId });
      if (error) return json({ ok: false, code: error.message ?? "FAILED" });
      await clearStrikes(admin, uid);          // Like မှန်ရင် ကြိမ်ရေ ပြန်သုညထား
      return json({ ok: true, credit: data });
    }

    return json({ ok: false, code: "NO_TASK" });
  } catch (_e) {
    return json({ ok: false, code: "VERIFY_UNAVAILABLE" });
  }
});
