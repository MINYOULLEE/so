/* =========================================================
   Unique Winner (Stable Patch)
   - 구매하기/최근결과 렌더가 "먹통" 되는 가장 흔한 원인(런타임 에러)을 방어
   - 로컬스토리지 구버전 데이터(v2/v3/v4) 섞여도 안 죽게 마이그레이션/가드
   ========================================================= */

const CFG = {
  SERIES_SIZE: 100,
  TICKET_PRICE: 0,
  REWARD: 10000,
  STORAGE_KEY: "uw_state", // ✅ 키를 하나로 통일해서 버전 꼬임 줄임
};

function seriesLabel(n) { return String(n).padStart(2, "0"); }
function formatTicketNo(n){ return String(n).padStart(3, "0"); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function safeJSONParse(raw){
  try { return JSON.parse(raw); } catch { return null; }
}

function loadState(){
  // ✅ 이전 키들도 읽어서 최대한 살림
  const keys = [
    CFG.STORAGE_KEY,
    "uw_test_state_v4",
    "uw_test_state_v3",
    "uw_demo_state_v2"
  ];

  for (const k of keys){
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    const parsed = safeJSONParse(raw);
    if (parsed) return { parsed, fromKey: k };
  }
  return { parsed: null, fromKey: null };
}

function saveState(state){
  localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify(state));
}

function randomHex(len=32){
  const bytes = new Uint8Array(len/2);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function sha256Hex(text){
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}

function shuffleInPlace(arr){
  for (let i = arr.length - 1; i > 0; i--) {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setText(id, v){
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

function setHtml(id, v){
  const el = document.getElementById(id);
  if (el) el.innerHTML = v;
}

function showHint(text, kind=""){
  const el = document.getElementById("buyHint");
  if (!el) return;
  el.classList.remove("hint--bad","hint--good");
  if (kind==="bad") el.classList.add("hint--bad");
  if (kind==="good") el.classList.add("hint--good");
  el.textContent = text || "";
}

function leftCount(state){ return CFG.SERIES_SIZE - (state.sold || 0); }

function computeChancePercent(n){
  const p = 1 - Math.pow((CFG.SERIES_SIZE-1)/CFG.SERIES_SIZE, n);
  return p * 100;
}

function formatKST(isoString){
  // ✅ ts 없거나 이상한 값이어도 안 터지게
  const d = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function maskName(name){
  const s = (name || "").trim();
  if (!s) return "익명";
  const chars = [...s];
  const n = chars.length;

  if (n === 1) return chars[0];
  if (n === 2) return `${chars[0]}X`;
  if (n === 3) return `${chars[0]}X${chars[2]}`;
  if (n === 4) return `${chars[0]}XX${chars[3]}`;
  return `${chars[0]}${"X".repeat(n-2)}${chars[n-1]}`;
}

function defaultState(){
  return {
    seriesNo: 1,
    seriesId: "01",
    sold: 0,
    tickets: Array(CFG.SERIES_SIZE).fill(null),
    userId: "USER-LOCAL",

    utBalance: 0,
    myTicketLog: [],

    // ✅ 최근 결과는 항상 배열
    resultsLog: [],

    serverSeed: randomHex(32),
    commitHash: "",
  };
}

async function ensureCommit(state){
  if (!state.commitHash){
    state.commitHash = await sha256Hex(state.serverSeed || randomHex(32));
    saveState(state);
  }
}

function migrateState(old){
  const s = defaultState();

  // 최대한 이전값 살리기
  if (old && typeof old === "object"){
    s.seriesNo = Number.isFinite(old.seriesNo) ? old.seriesNo : s.seriesNo;
    s.seriesId = old.seriesId || seriesLabel(s.seriesNo);
    s.sold = Number.isFinite(old.sold) ? old.sold : 0;

    if (Array.isArray(old.tickets) && old.tickets.length === CFG.SERIES_SIZE){
      s.tickets = old.tickets;
    }

    s.userId = old.userId || s.userId;
    s.utBalance = Number.isFinite(old.utBalance) ? old.utBalance : 0;

    // 내티켓 로그
    if (Array.isArray(old.myTicketLog)) s.myTicketLog = old.myTicketLog;

    // 최근결과 로그 (구조가 달라도 방어)
    if (Array.isArray(old.resultsLog)) s.resultsLog = old.resultsLog;

    s.serverSeed = old.serverSeed || s.serverSeed;
    s.commitHash = old.commitHash || s.commitHash;
  }

  // seriesId 정합성
  if (!s.seriesId) s.seriesId = seriesLabel(s.seriesNo);

  // sold 안전
  if (s.sold < 0) s.sold = 0;
  if (s.sold > CFG.SERIES_SIZE) s.sold = CFG.SERIES_SIZE;

  // resultsLog 안전
  if (!Array.isArray(s.resultsLog)) s.resultsLog = [];

  return s;
}

function updateProgressBar(state){
  const bar = document.getElementById("progressBar");
  if (!bar) return;
  const sold = state.sold || 0;
  const percent = (sold / CFG.SERIES_SIZE) * 100;
  bar.style.width = `${percent}%`;
  bar.style.background = "linear-gradient(90deg, rgba(255,70,70,0.95), rgba(255,130,130,0.9))";
}

function renderMyTickets(state){
  const box = document.getElementById("myTickets");
  if (!box) return;

  const log = Array.isArray(state.myTicketLog) ? state.myTicketLog : [];
  if (log.length === 0){
    box.innerHTML = `<div class="muted">아직 보유한 티켓이 없습니다.</div>`;
    return;
  }

  const items = [...log].reverse();
  box.innerHTML = items.map(it => {
    const sid = it.seriesId || state.seriesId || "01";
    const tn = Number(it.ticketNo) || 0;
    return `<span class="ticket ticket--me">시리즈 ${sid} · #${formatTicketNo(tn)}</span>`;
  }).join("");
}

function renderRecentResults(state){
  const box = document.getElementById("recentResults");
  if (!box) return;

  const logs = Array.isArray(state.resultsLog) ? state.resultsLog : [];
  if (logs.length === 0){
    box.innerHTML = `<div class="muted">아직 종료된 시리즈 결과가 없습니다.</div>`;
    return;
  }

  box.innerHTML = logs.map((r) => {
    const seriesId = r.seriesId || "??";
    const name = r.winnerNameMasked || r.winner || "익명";
    const reward = Number(r.reward ?? CFG.REWARD) || 0;
    const ts = r.ts || r.time || null;
    const timeStr = ts ? formatKST(ts) : "";

    return `
      <div class="card" style="background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.10); padding: 12px 14px;">
        <div class="row row--space" style="gap:10px;">
          <div style="min-width:0;">
            <div style="font-weight:900;">결과 · 시리즈 ${seriesId}</div>
            <div class="muted" style="margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${name} · ${reward.toLocaleString()} UT 획득
            </div>
          </div>
          <div class="muted" style="font-size:12px; flex:0 0 auto;">${timeStr}</div>
        </div>
      </div>
    `;
  }).join("");
}

function updateUI(state){
  setText("seriesId", state.seriesId || "01");
  setText("soldCount", state.sold || 0);
  setText("leftCount", leftCount(state));
  setText("utBalance", state.utBalance || 0);

  setText("ticketPriceUt", CFG.TICKET_PRICE);
  setText("rewardUt", CFG.REWARD);

  setText("commitHash", state.commitHash ? state.commitHash.slice(0,16)+"…" : "-");

  updateProgressBar(state);
  renderMyTickets(state);
  renderRecentResults(state);

  const buyBtn = document.getElementById("buyBtn");
  if (buyBtn) buyBtn.disabled = ((state.sold || 0) >= CFG.SERIES_SIZE);

  const qtyInput = document.getElementById("qtyInput");
  if (qtyInput) qtyInput.max = String(Math.max(1, leftCount(state)));
}

function updateCalc(state){
  const qtyInput = document.getElementById("qtyInput");
  if (!qtyInput) return;

  const max = Math.max(1, leftCount(state));
  const qty = clamp(parseInt(qtyInput.value || "1", 10), 1, max);
  qtyInput.value = String(qty);

  const cost = qty * CFG.TICKET_PRICE;
  const chance = computeChancePercent(qty);

  setText("costUt", cost);
  setText("winChance", chance.toFixed(2));
}

function openResultModal({seriesId, winnerTicketNo, winnerNameMasked, reward}){
  const modal = document.getElementById("resultModal");
  const panel = document.getElementById("resultPanel");
  if (!modal || !panel) return;

  // 불투명
  panel.style.background = "rgba(10, 12, 18, 0.98)";
  panel.style.borderColor = "rgba(255,255,255,0.12)";
  panel.style.backdropFilter = "none";

  const body = `
    <div class="muted">시리즈: <b>${seriesId}</b></div>
    <div style="height:12px"></div>
    <div class="card" style="background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.12);">
      <div style="font-size:18px; font-weight:900;">유니크 위너</div>
      <div style="margin-top:10px; font-size:22px; font-weight:900;">
        당첨 티켓: #${formatTicketNo(winnerTicketNo)}
      </div>
      <div class="muted" style="margin-top:8px;">
        당첨자: <b>${winnerNameMasked}</b>
      </div>
      <div class="muted" style="margin-top:6px;">
        보상: <b>${Number(reward).toLocaleString()} UT</b>
      </div>
    </div>
  `;
  setHtml("resultBody", body);

  modal.setAttribute("aria-hidden", "false");
}

function closeModal(){
  const modal = document.getElementById("resultModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
}

function buyTicketsRandom(state, qty){
  const left = leftCount(state);
  qty = clamp(qty, 1, left);

  const available = [];
  for (let i=0; i<CFG.SERIES_SIZE; i++){
    if (state.tickets[i] === null) available.push(i);
  }
  shuffleInPlace(available);

  const pickedIdx = available.slice(0, qty);
  const pickedNos = [];

  for (const idx of pickedIdx){
    state.tickets[idx] = state.userId;
    const ticketNo = idx + 1;
    pickedNos.push(ticketNo);
    state.myTicketLog.push({ seriesId: state.seriesId, ticketNo });
  }

  state.sold = (state.sold || 0) + pickedIdx.length;
  saveState(state);

  pickedNos.sort((a,b)=>a-b);
  return {
    ok: true,
    pickedNos,
    msg: `구매 완료: ${pickedNos.length}장 (랜덤 배정: #${formatTicketNo(pickedNos[0])}${pickedNos.length>1 ? ` 외 ${pickedNos.length-1}장` : ""})`,
    kind: "good"
  };
}

function autoAdvanceSeries(state){
  state.seriesNo = (state.seriesNo || 1) + 1;
  state.seriesId = seriesLabel(state.seriesNo);
  state.sold = 0;
  state.tickets = Array(CFG.SERIES_SIZE).fill(null);
  state.myTicketLog = [];
  state.serverSeed = randomHex(32);
  state.commitHash = "";
  saveState(state);
}

async function finishSeriesIfNeeded(state){
  if ((state.sold || 0) < CFG.SERIES_SIZE) return;

  await ensureCommit(state);

  const hex = (state.commitHash || "").slice(0, 12) || "0";
  const num = parseInt(hex, 16) || 0;
  const winnerTicketNo = (num % CFG.SERIES_SIZE) + 1;

  const rawName = "이민율"; // 테스트용
  const winnerNameMasked = maskName(rawName);

  const seriesId = state.seriesId;
  const reward = CFG.REWARD;

  state.resultsLog = Array.isArray(state.resultsLog) ? state.resultsLog : [];
  state.resultsLog.unshift({
    seriesId,
    winnerNameMasked,
    reward,
    ts: new Date().toISOString(),
  });
  saveState(state);

  openResultModal({ seriesId, winnerTicketNo, winnerNameMasked, reward });

  autoAdvanceSeries(state);
  await ensureCommit(state);
  updateUI(state);
  updateCalc(state);
}

async function main(){
  const qtyInput = document.getElementById("qtyInput");
  if (!qtyInput) return;

  // ✅ 로드 + 마이그레이션
  const { parsed } = loadState();
  let state = migrateState(parsed);
  saveState(state);

  await ensureCommit(state);
  updateUI(state);
  updateCalc(state);

  const plus = document.getElementById("qtyPlus");
  const minus = document.getElementById("qtyMinus");
  const buyBtn = document.getElementById("buyBtn");

  function setQty(v){
    const max = Math.max(1, leftCount(state));
    const n = clamp(v, 1, max);
    qtyInput.value = String(n);
    updateCalc(state);
  }

  qtyInput.addEventListener("input", () => setQty(parseInt(qtyInput.value || "1", 10)));
  minus?.addEventListener("click", () => setQty(parseInt(qtyInput.value || "1", 10) - 1));
  plus?.addEventListener("click", () => setQty(parseInt(qtyInput.value || "1", 10) + 1));

  buyBtn?.addEventListener("click", async () => {
    try{
      showHint("");

      if ((state.sold || 0) >= CFG.SERIES_SIZE){
        showHint("이미 종료된 시리즈입니다.", "bad");
        return;
      }

      await ensureCommit(state);

      const max = Math.max(1, leftCount(state));
      const qty = clamp(parseInt(qtyInput.value || "1", 10), 1, max);

      const res = buyTicketsRandom(state, qty);
      showHint(res.msg, res.kind);

      await ensureCommit(state);
      updateUI(state);
      setQty(1);

      await finishSeriesIfNeeded(state);

      // state 갱신 (autoAdvance 이후)
      state = migrateState(loadState().parsed);
      saveState(state);
      updateUI(state);
      updateCalc(state);
    } catch (e){
      console.error(e);
      showHint("에러가 발생했습니다. 콘솔(F12)에서 오류를 확인해 주세요.", "bad");
    }
  });

  // modal close
  document.getElementById("modalClose")?.addEventListener("click", closeModal);
  document.getElementById("modalCloseBtn")?.addEventListener("click", closeModal);

  // test buttons
  document.getElementById("resetSeries")?.addEventListener("click", async () => {
    const keepResults = true;
    const results = keepResults ? (state.resultsLog || []) : [];
    state = defaultState();
    state.resultsLog = results;
    saveState(state);

    await ensureCommit(state);
    updateUI(state);
    setQty(1);
    showHint("시리즈가 리셋되었습니다(테스트).", "good");
  });

  document.getElementById("newSeries")?.addEventListener("click", async () => {
    state.seriesNo = (state.seriesNo || 1) + 1;
    state.seriesId = seriesLabel(state.seriesNo);
    state.sold = 0;
    state.tickets = Array(CFG.SERIES_SIZE).fill(null);
    state.myTicketLog = [];
    state.serverSeed = randomHex(32);
    state.commitHash = "";
    saveState(state);

    await ensureCommit(state);
    updateUI(state);
    setQty(1);
    showHint("새 시리즈가 시작되었습니다(테스트).", "good");
  });
}

main();
