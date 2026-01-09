/* =========================================================
   Unique Winner (Test Build)
   요구사항:
   - +/-로 수량 변경 (최소 1 고정, 최대 남은 티켓)
   - 구매하기 클릭:
     - 랜덤 티켓 번호(남은 번호에서) 부여
     - 내 티켓에 "시리즈 01 · #003" 형태로 누적 표시
     - 판매 카운트 증가 / 남은 티켓 감소
     - 진행 바가 퍼센트만큼 채워짐 + 빨간색 게이지
   - 금액/UT 연동 값은 모두 0 (테스트 단계)
   - localStorage 저장(새로고침해도 유지)
   ========================================================= */

const CFG = {
  SERIES_SIZE: 100,
  TICKET_PRICE: 0,
  REWARD: 0,
  STORAGE_KEY: "uw_test_state_v3",
};

function seriesLabel(n) { return String(n).padStart(2, "0"); }
function formatTicketNo(n){ return String(n).padStart(3, "0"); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function loadState(){
  const raw = localStorage.getItem(CFG.STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function saveState(s){ localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify(s)); }

function randomHex(len=32){
  const bytes = new Uint8Array(len/2);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function sha256Hex(text){
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
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

function defaultState(){
  return {
    seriesNo: 1,
    seriesId: seriesLabel(1),
    sold: 0,
    tickets: Array(CFG.SERIES_SIZE).fill(null), // index 0..99 -> owner userId
    userId: "USER-LOCAL",
    utBalance: 0, // 테스트 0

    // 내가 산 티켓 로그(시리즈+번호) - 화면 표시용
    myTicketLog: [], // {seriesId:"01", ticketNo: 3}

    // commit-reveal
    serverSeed: randomHex(32),
    commitHash: "",
    revealed: false,
    winnerTicket: null,
    winnerUserId: null,
    finishedAt: null,
  };
}

async function ensureCommit(state){
  if (!state.commitHash){
    state.commitHash = await sha256Hex(state.serverSeed);
    saveState(state);
  }
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

function computeChancePercent(n){
  const p = 1 - Math.pow((CFG.SERIES_SIZE-1)/CFG.SERIES_SIZE, n);
  return p * 100;
}

function leftCount(state){ return CFG.SERIES_SIZE - state.sold; }

function updateProgressBar(state){
  const bar = document.getElementById("progressBar");
  if (!bar) return;

  const percent = (state.sold / CFG.SERIES_SIZE) * 100;
  bar.style.width = `${percent}%`;

  // ✅ 빨간색 게이지
  bar.style.background = "linear-gradient(90deg, rgba(255,70,70,0.95), rgba(255,130,130,0.9))";
}

function renderMyTickets(state){
  const box = document.getElementById("myTickets");
  if (!box) return;

  if (!state.myTicketLog || state.myTicketLog.length === 0){
    box.innerHTML = `<div class="muted">아직 보유한 티켓이 없습니다.</div>`;
    return;
  }

  // 보기 좋게: 최신 순
  const items = [...state.myTicketLog].slice().reverse();

  box.innerHTML = items.map(it => {
    return `<span class="ticket ticket--me">시리즈 ${it.seriesId} · #${formatTicketNo(it.ticketNo)}</span>`;
  }).join("");
}

function updateUI(state){
  setText("seriesId", state.seriesId);
  setText("soldCount", state.sold);
  setText("leftCount", leftCount(state));
  setText("utBalance", state.utBalance);

  setText("ticketPriceUt", CFG.TICKET_PRICE);
  setText("rewardUt", CFG.REWARD);

  setText("commitHash", state.commitHash ? state.commitHash.slice(0,16)+"…" : "-");

  updateProgressBar(state);
  renderMyTickets(state);

  const buyBtn = document.getElementById("buyBtn");
  if (buyBtn) buyBtn.disabled = (state.sold >= CFG.SERIES_SIZE);

  const qtyInput = document.getElementById("qtyInput");
  if (qtyInput) qtyInput.max = String(Math.max(1, leftCount(state)));
}

function updateCalc(state){
  const qtyInput = document.getElementById("qtyInput");
  if (!qtyInput) return;

  const max = Math.max(1, leftCount(state));
  const qty = clamp(parseInt(qtyInput.value || "1", 10), 1, max);

  qtyInput.value = String(qty);

  const cost = qty * CFG.TICKET_PRICE; // 테스트 단계 0
  const chance = computeChancePercent(qty);

  setText("costUt", cost);
  setText("winChance", chance.toFixed(2));
}

function pickWinnerFromSeed(state){
  const hex = state.commitHash.slice(0, 12);
  const num = parseInt(hex, 16);
  const idx = (num % CFG.SERIES_SIZE);
  return idx + 1;
}

async function finishSeriesIfNeeded(state){
  if (state.sold < CFG.SERIES_SIZE) return;

  if (!state.revealed){
    state.revealed = true;
    state.finishedAt = new Date().toISOString();

    const winnerTicket = pickWinnerFromSeed(state);
    state.winnerTicket = winnerTicket;
    state.winnerUserId = state.tickets[winnerTicket - 1];

    saveState(state);
    openResultModal(state);
  }
}

function openResultModal(state){
  const modal = document.getElementById("resultModal");
  if (!modal) return;

  const isMe = (state.winnerUserId === state.userId);

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
        * 검증: SHA-256(시드)=커밋 해시 확인 → 커밋 해시 앞 12자 정수화 → (값 % 100)+1 = 당첨 티켓
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

function resetSeries(state){
  state.sold = 0;
  state.tickets = Array(CFG.SERIES_SIZE).fill(null);

  // 로그는 유지/초기화 선택 가능. 테스트 편의상 유지 X -> 초기화
  state.myTicketLog = [];

  state.serverSeed = randomHex(32);
  state.commitHash = "";
  state.revealed = false;
  state.winnerTicket = null;
  state.winnerUserId = null;
  state.finishedAt = null;
}

function nextSeries(state){
  state.seriesNo += 1;
  state.seriesId = seriesLabel(state.seriesNo);

  state.sold = 0;
  state.tickets = Array(CFG.SERIES_SIZE).fill(null);
  state.myTicketLog = [];

  state.serverSeed = randomHex(32);
  state.commitHash = "";
  state.revealed = false;
  state.winnerTicket = null;
  state.winnerUserId = null;
  state.finishedAt = null;
}

/** ✅ 핵심: 랜덤 티켓 배정 + 로그 기록 + 카운트/바 갱신 */
function buyTicketsRandom(state, qty){
  const left = leftCount(state);
  qty = clamp(qty, 1, left);

  // 남은 티켓 인덱스(0..99)
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

    // ✅ 내 티켓 로그에 “시리즈 + 티켓번호” 기록
    state.myTicketLog.push({ seriesId: state.seriesId, ticketNo });
  }

  state.sold += pickedIdx.length;
  saveState(state);

  pickedNos.sort((a,b)=>a-b);

  return {
    ok: true,
    msg: `구매 완료: ${pickedNos.length}장 (랜덤 배정: #${formatTicketNo(pickedNos[0])}${pickedNos.length>1 ? ` 외 ${pickedNos.length-1}장` : ""})`,
    kind: "good"
  };
}

async function main(){
  // play page only
  const qtyInput = document.getElementById("qtyInput");
  if (!qtyInput) return;

  let state = loadState();
  if (!state){
    state = defaultState();
    saveState(state);
  }

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

  // ✅ 입력 직접 수정해도 제한 적용
  qtyInput.addEventListener("input", () => {
    setQty(parseInt(qtyInput.value || "1", 10));
  });

  // ✅ - 버튼: 1 아래로 내려가지 않음
  minus.addEventListener("click", () => {
    setQty(parseInt(qtyInput.value || "1", 10) - 1);
  });

  // ✅ + 버튼: 남은 티켓 초과 불가
  plus.addEventListener("click", () => {
    setQty(parseInt(qtyInput.value || "1", 10) + 1);
  });

  // ✅ 구매하기: 랜덤 티켓 + UI 갱신
  buyBtn.addEventListener("click", async () => {
    showHint("");

    if (state.sold >= CFG.SERIES_SIZE){
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

    // 남은 티켓에 맞춰 수량 자동 보정
    setQty(1);

    await finishSeriesIfNeeded(state);
  });

  // modal close
  document.getElementById("modalClose")?.addEventListener("click", closeModal);
  document.getElementById("modalCloseBtn")?.addEventListener("click", closeModal);

  // test buttons
  document.getElementById("resetSeries")?.addEventListener("click", async () => {
    resetSeries(state);
    saveState(state);
    await ensureCommit(state);
    updateUI(state);
    setQty(1);
    showHint("시리즈가 리셋되었습니다(테스트).", "good");
  });

  document.getElementById("newSeries")?.addEventListener("click", async () => {
    nextSeries(state);
    saveState(state);
    await ensureCommit(state);
    updateUI(state);
    setQty(1);
    showHint("새 시리즈가 시작되었습니다(테스트).", "good");
  });

  // 만약 새로고침했는데 이미 종료 상태면
  if (state.revealed && state.finishedAt){
    showHint("이 시리즈는 이미 종료되었습니다. 결과를 확인할 수 있습니다.", "good");
  }
}

main();
