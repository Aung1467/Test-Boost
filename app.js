// ================= Supabase =================
const cfg = window.APP_CONFIG || {};
const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
                      !/YOUR[-_]/i.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY));
const sb = configured && window.supabase
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

const ERR = {
  INSUFFICIENT_CREDIT: 'Credit မလုံလောက်ပါ',
  INVALID_LINK:        'TikTok Video Link ကို မှန်ကန်စွာ ထည့်ပါ',
  INVALID_OPTION:      'ရွေးချယ်မှု မှားနေပါသည်',
  TOO_EARLY:           'ခဏစောင့်ပြီး ထပ်နှိပ်ပါ',
  NO_TASK:             'အစကပြန်စပါ'
};
function errText(e) {
  const m = (e && e.message) || '';
  for (const k in ERR) if (m.includes(k)) return ERR[k];
  if (/JWT|expired|not authenticated/i.test(m)) return 'Login သက်တမ်းကုန်သွားပါပြီ၊ ပြန်ဝင်ပါ';
  return 'ချိတ်ဆက်မှု မအောင်မြင်ပါ၊ ထပ်ကြိုးစားပါ';
}


  const REWARD = 3;   // ရရှိမည့် Credit

  const DATA = {
    watch: { title: "ရရှိမည့် Credit", desc: "TikTok ကြည့်ပါ",       btn: "ကြည့်ရန်" },
    like:  { title: "ရရှိမည့် Credit", desc: "TikTok Like ပေးပါ", btn: "Like ပေးရန်" }
  };

  const select = document.getElementById('action');
  const clip   = document.getElementById('clip');
  const hint   = document.getElementById('hint');

  select.addEventListener('change', () => {
    const d = DATA[select.value];
    if (!d) return;

    clip.classList.remove('watch', 'like', 'show');
    void clip.offsetWidth;                 // restart animation
    clip.classList.add(select.value, 'show');

    document.getElementById('clipTitle').innerHTML = d.title + ' <b>' + REWARD + '</b>';
    document.getElementById('clipDesc').textContent  = d.desc;
    hint.style.display = 'none';
    resetWatch();
  });

  // ---------- Credit + 5s watch timer ----------
  const WATCH_SECONDS = 5;
  const creditEl = document.getElementById('credit');
  const clipBtn  = document.getElementById('clipBtn');
  const descEl   = document.getElementById('clipDesc');
  const progress = document.getElementById('progress');
  const fill     = document.getElementById('progressFill');

  let credit = 0;
  function setCredit(n) { credit = n; creditEl.textContent = n; }

  let timer = null;
  let state = 'idle';            // idle | watching | ready

  function resetWatch() {
    clearInterval(timer);
    state = 'idle';
    const d = DATA[select.value];
    clipBtn.disabled = false;
    clipBtn.classList.remove('claim', 'next');
    clipBtn.textContent = d.btn;
    descEl.textContent  = d.desc;
    progress.classList.remove('on');
    fill.style.width = '0';
  }

  function startWatch() {
    state = 'watching';
    let left = WATCH_SECONDS;
    clipBtn.disabled = true;
    clipBtn.textContent = left + 's';
    descEl.textContent  = 'ကြည့်နေသည်... ' + left + ' စက္ကန့်';
    progress.classList.add('on');
    fill.style.transition = 'none';
    fill.style.width = '0';
    void fill.offsetWidth;
    fill.style.transition = 'width 1s linear';

    timer = setInterval(() => {
      if (document.hidden) return;          // tab ကိုမြင်နေမှသာ ရေတွက်မယ်
      left--;
      fill.style.width = ((WATCH_SECONDS - left) / WATCH_SECONDS * 100) + '%';
      if (left > 0) {
        clipBtn.textContent = left + 's';
        descEl.textContent  = 'ကြည့်နေသည်... ' + left + ' စက္ကန့်';
      } else {
        clearInterval(timer);
        showClaim(WATCH_SECONDS + ' စက္ကန့် ပြည့်ပါပြီ!');
      }
    }, 1000);
  }

  function showClaim(msg) {
    state = 'ready';
    clipBtn.disabled = false;
    clipBtn.classList.add('claim');
    clipBtn.textContent = 'Credit ' + REWARD + ' ရယူပါ';
    descEl.textContent  = msg;
  }

  async function claimCredit() {
    const { data, error } = await sb.rpc('claim_reward');
    if (error) {
      descEl.textContent = errText(error);
      if ((error.message || '').includes('NO_TASK')) resetWatch();
      return;
    }
    setCredit(data);
    state = 'done';
    clipBtn.classList.remove('claim');
    clipBtn.classList.add('next');
    clipBtn.textContent = 'နောက်တစ်ပုဒ်';
    descEl.textContent  = '+' + REWARD + ' Credit ရပါပြီ ✓';
  }

  let clipNo = 1;
  function nextClip() {
    clipNo += 1;
    resetWatch();
  }

  let busy = false;
  clipBtn.addEventListener('click', async () => {
    if (!select.value || busy) return;
    busy = true;
    try {
      if (state === 'idle') {
        const { error } = await sb.rpc('start_task', { p_kind: select.value });
        if (error) { descEl.textContent = errText(error); return; }
        if (select.value === 'watch') startWatch();       // 5s timer
        else showClaim('Like ပေးပြီးပါပြီ!');              // Like: timer မပါ
      } else if (state === 'ready') {
        await claimCredit();
      } else if (state === 'done') {
        nextClip();
      }
    } finally { busy = false; }
  });

  // ---------- Credit သုံးရန် ----------
  const useSelect = document.getElementById('useCredit');
  const usePanel  = document.getElementById('usePanel');
  const useTitle  = document.getElementById('useTitle');
  const linkInput = document.getElementById('videoLink');
  const chipsEl   = document.getElementById('chips');
  const doneBtn   = document.getElementById('doneBtn');
  const useMsg    = document.getElementById('useMsg');
  const USE_LABEL = { like: 'TikTok Like', views: 'TikTok ကြည့်ရှုမှု' };
  let amount = 1;
  const durBlock = document.getElementById('durBlock');
  const durChips = document.getElementById('durChips');
  const amountBlock = document.getElementById('amountBlock');
  const costVal = document.getElementById('costVal');
  let viewCost = 8;
  let viewLabel = '6 စက္ကန့်';
  let viewSec = 6;

  function cost() { return useSelect.value === 'views' ? viewCost : amount; }

  function setMsg(text, ok) {
    useMsg.textContent = text;
    useMsg.className = 'msg ' + (ok ? 'ok' : 'err');
  }

  function validTikTok(url) {
    try {
      const u = new URL(url.trim());
      return /(^|\.)tiktok\.com$/i.test(u.hostname);
    } catch (e) { return false; }
  }

  useSelect.addEventListener('change', () => {
    useTitle.textContent = USE_LABEL[useSelect.value];
    const isViews = useSelect.value === 'views';
    durBlock.style.display = isViews ? 'block' : 'none';
    amountBlock.style.display = isViews ? 'none' : 'block';
    usePanel.classList.remove('show');
    void usePanel.offsetWidth;
    usePanel.classList.add('show');
    useMsg.textContent = '';
  });

  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chipsEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    amount = parseInt(chip.dataset.n, 10);
  });

  durChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    durChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    viewCost = parseInt(chip.dataset.cost, 10);
    viewLabel = chip.textContent;
    viewSec = parseInt(chip.dataset.sec, 10);
    costVal.textContent = viewCost + ' Credit';
  });

  doneBtn.addEventListener('click', async () => {
    if (!useSelect.value || doneBtn.disabled) return;
    if (!validTikTok(linkInput.value)) {
      setMsg('TikTok Video Link ကို မှန်ကန်စွာ ထည့်ပါ', false);
      return;
    }
    const price = cost();
    if (credit < price) {
      setMsg('Credit မလုံလောက်ပါ (လက်ကျန် ' + credit + ')', false);
      return;
    }
    const isViews = useSelect.value === 'views';
    doneBtn.disabled = true;
    const { data, error } = await sb.rpc('spend_credit', {
      p_service: useSelect.value,
      p_option:  isViews ? viewSec : amount,
      p_link:    linkInput.value.trim()
    });
    doneBtn.disabled = false;
    if (error) { setMsg(errText(error), false); return; }
    setCredit(data);
    const extra = isViews ? ' (' + viewLabel + ')' : '';
    setMsg('✓ ' + USE_LABEL[useSelect.value] + extra + ' အတွက် Credit ' + price + ' သုံးပြီးပါပြီ', true);
    linkInput.value = '';
  });


  // ================= Dropdown + TikTok logo =================
  const TT_LOGO = '<svg class="tt-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9a7.3 7.3 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5z"/></svg>';

  function enhanceSelect(sel) {
    const wrap = sel.closest('.select-wrap');
    wrap.classList.add('custom');
    sel.hidden = true;

    const box = document.createElement('div');
    box.className = 'cs';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cs-btn';
    const list = document.createElement('ul');
    list.className = 'cs-list';
    box.append(btn, list);
    wrap.appendChild(box);

    const opts = Array.from(sel.options);
    const items = [];

    function paint() {
      const cur = opts.find(o => o.value === sel.value && !o.disabled);
      btn.innerHTML = (cur ? TT_LOGO : '') + '<span></span>';
      btn.lastChild.textContent = cur ? cur.textContent : opts[0].textContent;
      items.forEach(li => li.classList.toggle('sel', li.dataset.v === sel.value));
    }

    opts.filter(o => !o.disabled).forEach(o => {
      const li = document.createElement('li');
      li.dataset.v = o.value;
      li.innerHTML = TT_LOGO + '<span></span>';
      li.lastChild.textContent = o.textContent;
      li.addEventListener('click', () => {
        sel.value = o.value;
        box.classList.remove('open');
        paint();
        sel.dispatchEvent(new Event('change'));
      });
      list.appendChild(li);
      items.push(li);
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.cs.open').forEach(c => { if (c !== box) c.classList.remove('open'); });
      box.classList.toggle('open');
    });
    document.addEventListener('click', () => box.classList.remove('open'));
    paint();
  }

  enhanceSelect(document.getElementById('action'));
  enhanceSelect(document.getElementById('useCredit'));

  // ================= Login / Register =================
  const authScreen = document.getElementById('authScreen');
  const appScreen  = document.getElementById('appScreen');
  const authMode   = document.getElementById('authMode');
  const loginPanel = document.getElementById('loginPanel');
  const regPanel   = document.getElementById('registerPanel');

  function authMsg(id, text, ok) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'msg ' + (ok ? 'ok' : 'err');
  }

  // Supabase Auth က email လိုတာကြောင့် နာမည်ကနေ email တစ်ခုကို တည်ဆောက်ပေးသည်
  async function nameToEmail(name) {
    const key = name.trim().normalize('NFC').toLowerCase();
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    return 'u' + hex.slice(0, 40) + '@' + (cfg.EMAIL_DOMAIN || 'users.tiktokboost.app');
  }

  async function enterApp(user) {
    const { data, error } = await sb.from('profiles')
      .select('username, credit').eq('id', user.id).maybeSingle();
    if (error || !data) return false;
    document.getElementById('who').textContent = data.username;
    setCredit(data.credit);
    authScreen.hidden = true;
    appScreen.hidden = false;
    window.scrollTo(0, 0);
    return true;
  }

  function showPanel(panel) {
    [loginPanel, regPanel].forEach(p => p.classList.remove('show'));
    void panel.offsetWidth;
    panel.classList.add('show');
  }

  authMode.addEventListener('change', () => {
    document.getElementById('loginMsg').textContent = '';
    document.getElementById('regMsg').textContent = '';
    showPanel(authMode.value === 'login' ? loginPanel : regPanel);
  });

  const CONFIRM_MSG = 'Supabase > Authentication > Email ထဲမှာ "Confirm email" ကို ပိတ်ထားပါ';

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const btn  = document.getElementById('loginBtn');
    const name = document.getElementById('loginName').value.trim();
    const pass = document.getElementById('loginPass').value;
    if (!name || !pass) { authMsg('loginMsg', 'နာမည်နှင့် စကားဝှက်ကို ထည့်ပါ', false); return; }
    btn.disabled = true;
    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: await nameToEmail(name), password: pass
      });
      if (error) {
        authMsg('loginMsg', /confirm/i.test(error.message) ? CONFIRM_MSG
                            : 'နာမည် သို့မဟုတ် စကားဝှက် မှားနေပါသည်', false);
        return;
      }
      document.getElementById('loginPass').value = '';
      if (!(await enterApp(data.user))) authMsg('loginMsg', 'အချက်အလက် ရယူမရပါ၊ ထပ်ကြိုးစားပါ', false);
    } catch (e) {
      authMsg('loginMsg', 'ချိတ်ဆက်မှု မအောင်မြင်ပါ (HTTPS သို့မဟုတ် localhost ဖြင့်ဖွင့်ပါ)', false);
    } finally { btn.disabled = false; }
  });

  document.getElementById('regBtn').addEventListener('click', async () => {
    const btn   = document.getElementById('regBtn');
    const name  = document.getElementById('regName').value.trim();
    const pass  = document.getElementById('regPass').value;
    const pass2 = document.getElementById('regPass2').value;

    if (name.length < 3)  { authMsg('regMsg', 'နာမည် အနည်းဆုံး ၃ လုံးထည့်ပါ', false); return; }
    if (name.length > 20) { authMsg('regMsg', 'နာမည် အများဆုံး ၂၀ လုံးသာ ထည့်နိုင်ပါသည်', false); return; }
    if (pass.length < 6)  { authMsg('regMsg', 'စကားဝှက် အနည်းဆုံး ၆ လုံးထည့်ပါ', false); return; }
    if (pass !== pass2)   { authMsg('regMsg', 'စကားဝှက် နှစ်ခု မတူပါ', false); return; }

    btn.disabled = true;
    try {
      const { data, error } = await sb.auth.signUp({
        email: await nameToEmail(name),
        password: pass,
        options: { data: { username: name } }
      });
      if (error) {
        authMsg('regMsg', /already|registered/i.test(error.message)
          ? 'ဒီနာမည်ကို အသုံးပြုပြီးသားပါ' : 'အကောင့်ဖွင့်မရပါ၊ ထပ်ကြိုးစားပါ', false);
        return;
      }
      if (!data.session) { authMsg('regMsg', CONFIRM_MSG, false); return; }

      ['regName', 'regPass', 'regPass2'].forEach(id => document.getElementById(id).value = '');
      if (!(await enterApp(data.user))) authMsg('regMsg', 'အချက်အလက် ရယူမရပါ၊ ပြန်ဝင်ကြည့်ပါ', false);
    } catch (e) {
      authMsg('regMsg', 'ချိတ်ဆက်မှု မအောင်မြင်ပါ (HTTPS သို့မဟုတ် localhost ဖြင့်ဖွင့်ပါ)', false);
    } finally { btn.disabled = false; }
  });

  // show / hide password
  const EYE_ON  = '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M12 7c2.8 0 5 2.2 5 5 0 .6-.1 1.3-.4 1.8l2.9 2.9c1.5-1.3 2.7-3 3.5-4.7-1.7-4.4-6-7.5-11-7.5-1.4 0-2.7.2-4 .7l2.2 2.2c.6-.3 1.2-.4 1.8-.4zM2 4.3l2.3 2.3.5.5C3.1 8.5 1.8 10.2 1 12c1.7 4.4 6 7.5 11 7.5 1.5 0 3-.3 4.4-.8l.4.4 2.9 2.9 1.3-1.3L3.3 3 2 4.3zM7.5 9.8l1.5 1.5c-.1.2-.1.5-.1.7 0 1.7 1.3 3 3 3 .2 0 .5 0 .7-.1l1.5 1.5c-.7.3-1.4.5-2.2.5-2.8 0-5-2.2-5-5 0-.8.2-1.5.6-2.1zm4.3-.8 3.1 3.1v-.2c0-1.7-1.3-3-3-3h-.1z"/></svg>';
  document.querySelectorAll('.eye').forEach(btn => btn.addEventListener('click', () => {
    const inp = document.getElementById(btn.dataset.for);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF : EYE_ON;
  }));

  // Enter key submits
  [['loginName','loginBtn'],['loginPass','loginBtn'],['regName','regBtn'],['regPass','regBtn'],['regPass2','regBtn']]
    .forEach(([i, b]) => document.getElementById(i).addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById(b).click();
    }));

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await sb.auth.signOut(); } catch (e) {}
    location.reload();
  });

  // Login form is shown by default
  showPanel(loginPanel);

  if (!sb) {
    const m = 'config.js ထဲမှာ Supabase URL နှင့် Key ကို အရင်ထည့်ပါ';
    authMsg('loginMsg', m, false);
    authMsg('regMsg', m, false);
    document.getElementById('loginBtn').disabled = true;
    document.getElementById('regBtn').disabled = true;
  } else {
    // Stay logged in after refresh
    (async function restoreSession() {
      const { data } = await sb.auth.getSession();
      if (data.session && !(await enterApp(data.session.user))) await sb.auth.signOut();
    })();
  }
