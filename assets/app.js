/* =========================================================
   Unique Winner (Static Test)
   - Series: 100 tickets
   - Purchase assigns RANDOM ticket numbers from remaining pool
   - For now: all money-linked values are 0 (no balance check / no deduction)
   - Commit-Reveal verification stays (hash commit -> seed reveal)
   - Storage: localStorage (demo)
   ========================================================= */

const CFG = {
  SERIES_SIZE: 100,

  // 🔧 테스트 단계: 연동값 전부 0
  TICKET_PRICE: 0,
  REWARD: 0,

  STORAGE_KEY: "uw_demo_state_v2",
};

function seriesLabel(n) {
  // "01", "02", ...
  return String(n).padStart(2, "0");
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function loadState() {
  const raw = localStorage.getItem(CFG.STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveState(state) {
  localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify(state));
}

function randomHex(len=32) {
  const bytes = new Uint8Array(len/2);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2,"0")).join("");
}

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}

// crypto 기반 안전한 셔플
function shuffleInPlace(arr){
  for (let i = arr.length - 1; i > 0; i--) {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function defaultState() {
  return {
    seriesNo: 1,
    seriesId: seriesLabel(1),
    sold: 0,
    // tickets[0..99] = null | userId
    tickets: Array(CFG.SERIES_SIZE).fill(null),

    userId: "USER-LOCAL",

    // 🔧 테스트 단계: 0 고정 (차감/검증 안 함)
    utBalance: 0,

    // commit-reveal
    serverSeed: randomHex(32),
    commitHash: "", // sha256(serverSeed)
    revealed: false,
    winnerTicket: null, // 1..100
    winnerUserId: null,
    finishedAt: null,
  };
}

async function ensureCommit(state) {
  if (!state.commitHash) {
    state.commitHash = await sha256Hex(state.serverSeed);
    saveState(state);
  }
}

function getMyTickets(state) {
  const arr = [];
  for (let i=0; i<CFG.SERIES_SIZE; i++){
    if (state.tickets[i] === state.userId) arr.push(i+1);
  }
  return arr;
}

function computeChancePercent(n) {
  // 1 - (99/100)^n
  const p = 1 - Math.pow((CFG.SERIES_SIZE-1)/CFG.SERIES_SIZE, n);
  return (p * 100);
}

function formatTicketNo(n){
  return String(n).padStart(3,"0");
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

function updateUI(state) {
  const percent = (state.sold / CFG.SERIES_SIZE) * 100;
  const left = CFG.SERIES_SIZE - state.sold;

  setText("seriesId", state.seriesId);
  setText("soldCount", state.sold);
  setText("leftCount", left);
  setText("utBalance", state.utBalance);

  // 가격/보상 표시 (테스트 단계 0)
  setText("ticketPriceUt", CFG.TICKET_PRICE);
  setText("rewardUt", CFG.REWARD);

  setText("commitHash", state.commitHash ? state.commitHash.slice(0,16)+"…" : "-");

  const bar = document.getElementById("progressBar");
  if (bar) bar.style.width = `${percent}%`;

  // my tickets
  const my = getMyTickets(state);
  const box = document.getElementById("myTickets");
  if (box) {
    if (my.length === 0) {
      box.innerHTML = `<div class="muted">아직 보유한 티켓이 없습니다.</div>`;
    } else {
      box.innerHTML = my
        .sort((a,b)=>a-b)
        .map(n => `<span class="ticket ticket--me">#${formatTicketNo(n)}</span>`)
        .join("");
    }
  }

  // disable buy when finished
  const buyBtn = document.getElementById("buyBtn");
  if (buyBtn) buyBtn.disabled = state.sold >= CFG.SERIES_SIZE;

  // qty bounds
  const qtyInput = document.getElementById("qtyInput");
  if (qtyInput) qtyInput.max = String(Math.max(1, left));
}

function updateCalc(state) {
  const qtyInput = document.getElementById("qtyInput");
  if (!qtyInput) return;

  const left = CFG.SERIES_SIZE - state.sold;
  const qty = clamp(parseInt(qtyInput.value || "1", 10), 1, Math.max(1, left));

  const cost = qty * CFG.TICKET_PRICE; // 테스트 단계 0
  const chance = computeChancePercent(qty);

  setText("costUt", cost);
  setText("winChance", chance.toFixed(2));
}

function pickWinnerFromSeed(state) {
  // Deterministic + verifiable:
  // winner = (int(commitHash[0..11],16) % 100) + 1
  const hex = state.commitHash.slice(0, 12);
  const num = parseInt(hex, 16);
  const idx = (num % CFG.SERIES_SIZE);
  return idx + 1;
}

async function finishSeriesIfNeeded(state) {
  if (state.sold < CFG.SERIES_SIZE) return;

  if (!state.revealed) {
    state.revealed = true;
    state.finishedAt = new Date().toISOString();

    const winnerTicket = pickWinnerFromSeed(state);
    state.winnerTicket = winnerTicket;
    state.winnerUserId = state.tickets[winnerTicket - 1];

    // 🔧 테스트 단계: 보상 0이라 잔액 변화 없음
    saveState(state);
    openResultModal(state);
  }
}

function openResultModal(state){
  const modal = document.getElementById("resultModal");
  if (!modal) return;

  const myId = state.userId;
  const winner = state.winnerUserId;
  const isMe = (winner === myId);

  const body = `
    <div class="muted">시리즈: <b>${state.seriesId}</b> · 종료 시각: <b>${new Date(state.finishedAt).toLocaleString()}</b></div>
    <div style="height:12px"></div>

    <div class="card" style="background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.08);">
      <div class="row row--space">
        <div>
          <div class="pill">유니크 위너</div>
          <div style="font-size:22px; font-weight:900; margin-top:8px;">
            당첨 티켓: #${formatTicketNo(state.winnerTicket)}
          </div>
          <div class="muted" style="margin-top:6px;">
            보상: <b>${CFG.REWARD.toLocaleString()} UT</b>
          </div>
        </div>
        <div style="text-align:right">
          <div class="muted">내 결과</div>
          <div style="font-size:18px; font-weight:900; margin-top:8px; color:${isMe ? "rgba(39,211,162,0.95)" : "rgba(255,91,122,0.95)"}">
            ${isMe ? "당첨" : "미당첨"}
          </div>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="muted">공정성 검증 정보</div>
    <div style="margin-top:8px; display:grid; gap:10px;">
      <div class="card" style="background: rgba(0,0,0,0.18); border-color: rgba(255,255,255,0.08);">
        <div class="muted">커밋 해시(사전 고정)</div>
        <div class="mono" style="margin-top:6px; word-break:break-all;">${state.commitHash}</div>
      </div>
      <div class="card" style="background: rgba(0,0,0,0.18); border-color: rgba(255,255,255,0.08);">
        <div class="muted">시드(종료 후 공개)</div>
        <div class="mono" style="margin-top:6px; word-break:break-all;">${state.serverSeed}</div>
      </div>
      <div class="muted" style="font-size:12px;">
        * 검증: SHA-256(시드)=커밋 해시 확인 → 커밋 해시 앞 12자(16진수)를 정수로 변환 → (값 % 100)+1 = 당첨 티켓
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

function nextSeries(state){
  state.seriesNo += 1;
  state.seriesId = seriesLabel(state.seriesNo);

  state.sold = 0;
  state.tickets = Array(CFG.SERIES_SIZE).fill(null);

  state.serverSeed = randomHex(32);
  state.commitHash = "";
  state.revealed = false;
  state.winnerTicket = null;
  state.winnerUserId = null;
  state.finishedAt = null;
}

function resetSeries(state){
  state.sold = 0;
  state.tickets = Array(CFG.SERIES_SIZE).fill(null);

  state.serverSeed = randomHex(32);
  state.commitHash = "";
  state.revealed = false;
  state.winnerTicket = null;
  state.winnerUserId = null;
  state.finishedAt = null;
}

function buyTicketsRandom(state, qty){
  const left = CFG.SERIES_SIZE - state.sold;
  qty = clamp(qty, 1, left);

  // 남은 티켓 인덱스(0..99) 모아서 랜덤 셔플 후 qty개 선택
  const available = [];
  for (let i=0; i<CFG.SERIES_SIZE; i++){
    if (state.tickets[i] === null) available.push(i);
  }
  shuffleInPlace(available);

  const picked = available.slice(0, qty);
  for (const idx of picked){
    state.tickets[idx] = state.userId;
  }

  state.sold += picked.length;
  saveState(state);

  // 화면 표시용: 티켓 번호(1..100)로 변환 후 정렬
  const ticketNos = picked.map(i => i+1).sort((a,b)=>a-b);
  const first = ticketNos[0];

  return {
    ok:true,
    msg:`구매 완료: ${ticketNos.length}장 (랜덤 배정: #${formatTicketNo(first)}${ticketNos.length>1 ? ` 외 ${ticketNos.length-1}장` : ""})`,
    kind:"good"
  };
}

async function main(){
  const onPlay = document.getElementById("qtyInput");
  if (!onPlay) return;

  let state = loadState();
  if (!state) {
    state = defaultState();
    saveState(state);
  }

  await ensureCommit(state);
  updateUI(state);
  updateCalc(state);

  const qtyInput = document.getElementById("qtyInput");
  const plus = document.getElementById("qtyPlus");
  const minus = document.getElementById("qtyMinus");
  const buyBtn = document.getElementById("buyBtn");

  function setQty(v){
    const left = CFG.SERIES_SIZE - state.sold;
    const max = Math.max(1, left);
    const n = clamp(v, 1, max);
    qtyInput.value = String(n);
    updateCalc(state);
  }

  qtyInput.addEventListener("input", () => {
    setQty(parseInt(qtyInput.value || "1", 10));
  });
  plus.addEventListener("click", () => setQty(parseInt(qtyInput.value || "1", 10) + 1));
  minus.addEventListener("click", () => setQty(parseInt(qtyInput.value || "1", 10) - 1));

  buyBtn.addEventListener("click", async () => {
    showHint("");

    await ensureCommit(state);

    const qty = parseInt(qtyInput.value || "1", 10);

    // ✅ 랜덤 티켓 배정
    const res = buyTicketsRandom(state, qty);

    showHint(res.msg, res.kind);

    await ensureCommit(state);
    updateUI(state);
    updateCalc(state);

    await finishSeriesIfNeeded(state);
  });

  // modal close
  document.getElementById("modalClose")?.addEventListener("click", closeModal);
  document.getElementById("modalCloseBtn")?.addEventListener("click", closeModal);

  // series controls (test)
  document.getElementById("resetSeries")?.addEventListener("click", async () => {
    resetSeries(state);
    saveState(state);
    await ensureCommit(state);
    updateUI(state);
    updateCalc(state);
    showHint("시리즈가 리셋되었습니다(테스트).", "good");
  });

  document.getElementById("newSeries")?.addEventListener("click", async () => {
    nextSeries(state);
    saveState(state);
    await ensureCommit(state);
    updateUI(state);
    updateCalc(state);
    showHint("새 시리즈가 시작되었습니다(테스트).", "good");
  });

  if (state.revealed && state.finishedAt){
    showHint("이 시리즈는 이미 종료되었습니다. 결과를 확인할 수 있습니다.", "good");
  }
}

main();
