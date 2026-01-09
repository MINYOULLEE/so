/* =========================================================
   Unique Winner (Test Build v4)
   변경사항:
   1) 팝업(모달) 투명도 제거(불투명)
   2) 당첨자 이름 마스킹:
      - 3글자: 이민율 -> 이X율
      - 4글자: 이민율조 -> 이XX조
      - 2글자: 이민 -> 이X
      - 5글자 이상: 앞1 + X...(중간) + 마지막1
   3) 공정성 검증 정보 제거 (모달에서 표시 안 함)
   4) 시리즈 종료(100장) 시:
      - 결과 저장(최근 결과 목록)
      - 자동으로 다음 시리즈로 넘어가며 초기화
   5) 최근 결과:
      - 화면엔 최대 5개만 "상단 고정" 느낌으로 먼저 보여주고
      - 전체는 스크롤 리스트로 모두 확인 가능 (UI는 max-height + overflow)
   ========================================================= */

const CFG = {
  SERIES_SIZE: 100,
  TICKET_PRICE: 0,
  REWARD: 10000, // 선생님 요구대로 “10,000 UT” 표기 원하면 여기만 10000 유지
  STORAGE_KEY: "uw_test_state_v4",
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

function maskName(name){
  const s = (name || "").trim();
  if (!s) return "익명";

  const chars = [...s]; // 유니코드 안전
  const n = chars.length;

  if (n === 1) return chars[0];
  if (n === 2) return `${chars[0]}X`;
  if (n === 3) return `${chars[0]}X${chars[2]}`;      // 이민율 -> 이X율
  if (n === 4) return `${chars[0]}XX${chars[3]}`;     // 이민율조 -> 이XX조
  // 5 이상: 앞1 + X... + 마지막1
  return `${chars[0]}${"X".repeat(n-2)}${chars[n-1]}`;
}

function defaultState(){
  return {
    seriesNo: 1,
    seriesId: seriesLabel(1),
    sold: 0,
    tickets: Array(CFG.SERIES_SIZE).fill(null),
    userId: "USER-LOCAL",

    // 테스트 단계: 잔액 0, 계산만
    utBalance: 0,

    // 내 티켓 표시용
    myTicketLog: [],

    // 최근 결과 기록 (최신이 앞)
    resultsLog: [], // {seriesId, winnerNameMasked, reward, ts}

    // commit-reveal 값은 유지하되 UI에서 표시만 안 함
    serverSeed: randomHex(32),
    commitHash: "",
  };
}

async function ensureCommit(state){
  if (!state.commitHash){
    state.commitHash = await sha256Hex(state.serverSeed);
    saveState(state);
  }
}

function updateProgressBar(state){
  const bar = document.getElementById("progressBar");
  if (!bar) return;
  const percent = (state.sold / CFG.SERIES_SIZE) * 100;
  bar.style.width = `${percent}%`;
  bar.style.background = "linear-gradient(90deg, rgba(255,70,70,0.95), rgba(255,130,130,0.9))";
}

function renderMyTickets(state){
  const box = document.getElementById("myTickets");
  if (!box) return;

  if (!state.myTicketLog?.length){
    box.innerHTML = `<div class="muted">아직 보유한 티켓이 없습니다.</div>`;
    return;
  }

  const items = [...state.myTicketLog].slice().reverse();
  box.innerHTML = items.map(it =>
    `<span class="ticket ticket--me">시리즈 ${it.seriesId} · #${formatTicketNo(it.ticketNo)}</span>`
  ).join("");
}

function renderRecentResults(state){
  const box = document.getElementById("recentResults");
  if (!box) return;

  const logs = state.resultsLog || [];
  if (logs.length === 0){
    box.innerHTML = `<div class="muted">아직 종료된 시리즈 결과가 없습니다.</div>`;
    return;
  }

  // UI: 최신 5개가 위에 먼저 보이게(전체는 스크롤로 계속)
  box.innerHTML = logs.map((r, idx) => {
    const date = new Date(r.ts);
    const timeStr = date.toLocaleString();
    return `
      <div class="card" style="
        background: rgba(255,255,255,0.06);
        border-color: rgba(255,255,255,0.10);
        padding: 12px 14px;
        ${idx < 5 ? "" : "opacity: 0.92;"}
      ">
        <div class="row row--space" style="gap:10px;">
          <div style="min-width:0;">
            <div style="font-weight:900;">결과 · 시리즈 ${r.seriesId}</div>
            <div class="muted" style="margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${r.winnerNameMasked} · ${Number(r.reward).toLocaleString()} UT 획득
            </div>
          </div>
          <div class="muted" style="font-size:12px; flex:0 0 auto;">${timeStr}</div>
        </div>
      </div>
    `;
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
  renderRecentResults(state);

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

  const cost = qty * CFG.TICKET_PRICE;
  const chance = computeChancePercent(qty);

  setText("costUt", cost);
  setText("winChance", chance.toFixed(2));
}

function openResultModal({seriesId, winnerTicketNo, winnerNameMasked, reward}){
  const modal = document.getElementById("resultModal");
  const panel = document.getElementById("resultPanel");
  if (!modal || !panel) return;

  // ✅ 모달 패널을 완전 불투명에 가깝게
  panel.style.background = "rgba(10, 12, 18, 0.98)";
  panel.style.borderColor = "rgba(255,255,255,0.12)";
  panel.style.backdropFilter = "none";

  // ✅ 공정성 검증 정보 제거하고 핵심만
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

  state.sold += pickedIdx.length;
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
  // 다음 시리즈로 증가 + 전체 초기화(티켓/판매/내티켓)
  state.seriesNo += 1;
  state.seriesId = seriesLabel(state.seriesNo);
  state.sold = 0;
  state.tickets = Array(CFG.SERIES_SIZE).fill(null);
  state.myTicketLog = [];

  // commit 값 갱신
  state.serverSeed = randomHex(32);
  state.commitHash = "";

  saveState(state);
}

async function finishSeriesIfNeeded(state){
  if (state.sold < CFG.SERIES_SIZE) return;

  // 당첨 티켓(커밋해시 기반 결정)
  const hex = state.commitHash.slice(0, 12);
  const num = parseInt(hex, 16);
  const winnerTicketNo = (num % CFG.SERIES_SIZE) + 1;

  // ✅ “당첨자 이름”은 지금 단계에서 사용자 이름을 임시로 쓰자.
  // 실제 서비스에서는 구매자 DB에서 winnerTicketNo의 소유자 이름을 가져오면 됨.
  // 지금은 테스트니까: 내 이름이 있다고 가정한 예시(원하면 입력 UI도 붙여줌)
  const rawName = "이민율"; // ← 테스트용. 나중에 로그인/닉네임 연동
  const winnerNameMasked = maskName(rawName);

  const seriesId = state.seriesId;
  const reward = CFG.REWARD;

  // ✅ 최근 결과 로그에 저장(최신이 앞)
  state.resultsLog = state.resultsLog || [];
  state.resultsLog.unshift({
    seriesId,
    winnerNameMasked,
    reward,
    ts: new Date().toISOString(),
  });
  saveState(state);

  // ✅ 모달 즉시 오픈
  openResultModal({ seriesId, winnerTicketNo, winnerNameMasked, reward });

  // ✅ 다음 시리즈로 자동 전환 + 초기화
  // 모달 띄운 상태에서 바로 넘어가도 되지만, 사용자 혼란을 줄이려고
  // "모달을 닫으면 다음 시리즈가 이미 시작되어 있는 형태"로 유지.
  autoAdvanceSeries(state);

  // UI 갱신
  await ensureCommit(state);
  updateUI(state);
  updateCalc(state);
}

async function main(){
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

  qtyInput.addEventListener("input", () => setQty(parseInt(qtyInput.value || "1", 10)));
  minus.addEventListener("click", () => setQty(parseInt(qtyInput.value || "1", 10) - 1));
  plus.addEventListener("click", () => setQty(parseInt(qtyInput.value || "1", 10) + 1));

  buyBtn.addEventListener("click", async () => {
    showHint("");

    if (state.sold >= CFG.SERIES_SIZE){
      showHint("이미 종료된 시리즈입니다.", "bad");
      return;
    }

    // commit 보장
    await ensureCommit(state);

    const max = Math.max(1, leftCount(state));
    const qty = clamp(parseInt(qtyInput.value || "1", 10), 1, max);

    const res = buyTicketsRandom(state, qty);
    showHint(res.msg, res.kind);

    // UI 갱신
    await ensureCommit(state);
    updateUI(state);
    setQty(1);

    // 시리즈 종료 체크
    await finishSeriesIfNeeded(state);

    // state가 autoAdvance로 바뀌었을 수 있으니 다시 로드
    state = loadState() || state;
  });

  // modal close
  document.getElementById("modalClose")?.addEventListener("click", closeModal);
  document.getElementById("modalCloseBtn")?.addEventListener("click", closeModal);

  // test buttons
  document.getElementById("resetSeries")?.addEventListener("click", async () => {
    const keepResults = true; // 리셋해도 결과는 남기는게 자연스러움
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
    // 새 시리즈 시작: 결과는 유지
    const results = state.resultsLog || [];
    state.seriesNo += 1;
    state.seriesId = seriesLabel(state.seriesNo);
    state.sold = 0;
    state.tickets = Array(CFG.SERIES_SIZE).fill(null);
    state.myTicketLog = [];
    state.serverSeed = randomHex(32);
    state.commitHash = "";
    state.resultsLog = results;

    saveState(state);
    await ensureCommit(state);
    updateUI(state);
    setQty(1);
    showHint("새 시리즈가 시작되었습니다(테스트).", "good");
  });
}

main();
