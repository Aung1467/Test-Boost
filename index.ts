// Supabase Edge Function: resolve-tiktok
// Deploy:  supabase functions deploy resolve-tiktok
// (JWT verify ဖွင့်ထားပါ — login ဝင်ထားသူသာ ခေါ်နိုင်မယ်)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com", "m.tiktok.com", "www.tiktok.com", "tiktok.com"]);
const FULL = /^\/@([^\/?#]+)\/video\/(\d{8,25})/;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function canonical(u: URL): string | null {
  const m = u.pathname.match(FULL);
  return m ? `https://www.tiktok.com/@${m[1]}/video/${m[2]}` : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { url } = await req.json();
    let cur = new URL(String(url).trim());

    for (let hop = 0; hop < 6; hop++) {
      // SSRF ကာကွယ်: https + TikTok host သာ
      if (cur.protocol !== "https:" || !HOSTS.has(cur.hostname)) return json({ error: "INVALID_LINK" }, 400);

      const c = canonical(cur);
      if (c) return json({ url: c });

      const r = await fetch(cur.toString(), { redirect: "manual", headers: { "User-Agent": UA } });
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) {
        cur = new URL(loc, cur);
        continue;
      }
      // redirect မရှိရင် page ထဲက canonical / og:url ကို ရှာ
      const html = await r.text();
      const m = html.match(/(?:rel="canonical"\s+href|property="og:url"\s+content)="([^"]+)"/i);
      if (m) {
        const c2 = canonical(new URL(m[1]));
        if (c2) return json({ url: c2 });
      }
      break;
    }
    return json({ error: "INVALID_LINK" }, 422);
  } catch (_e) {
    return json({ error: "INVALID_LINK" }, 400);
  }
});
