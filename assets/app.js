/* ===============================
   The Unique Winner - 안정판
   =============================== */

const CFG = {
  SERIES_SIZE: 100,
  REWARD: 10000,
  STORAGE_KEY: "tuw_state"
};

function seriesLabel(n){ return String(n).padStart(2,"0"); }
function formatTicket(n){ return String(n).padStart(3,"0"); }
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

function formatKST(ts){
  return new Date(ts).toLocaleString("ko-KR",{
    timeZone:"Asia/Seoul",
    year:"numeric",
    month:"numeric",
    day:"numeric",
    hour:"numeric",
    minute:"2-digit",
    hour12:true
  });
}

function maskName(name){
  const c=[...name];
  if(c.length<=1) return name;
  if(c.length===2) return c[0]+"X";
  if(c.length===3) return c[0]+"X"+c[2];
  if(c.length===4) return c[0]+"XX"+c[3];
  return c[0]+"X".repeat(c.length-2)+c[c.length-1];
}

function load(){
  try{
    return JSON.parse(localStorage.getItem(CFG.STORAGE_KEY));
  }catch{ return null; }
}
function save(s){ localStorage.setItem(CFG.STORAGE_KEY,JSON.stringify(s)); }

function init(){
  return {
    seriesNo:1,
    seriesId:"01",
    sold:0,
    tickets:Array(100).fill(null),
    myTickets:[],
    results:[]
  };
}

let state = load() || init();
save(state);

const $ = id=>document.getElementById(id);

function updateUI(){
  $("seriesId").textContent = state.seriesId;
  $("soldCount").textContent = state.sold;
  $("leftCount").textContent = 100 - state.sold;

  $("progressBar").style.width = (state.sold)+"%";
  $("progressBar").style.background =
    "linear-gradient(90deg,#ff4b4b,#ff7a7a)";

  $("rewardUt").textContent = CFG.REWARD;

  // 내 티켓
  if(state.myTickets.length===0){
    $("myTickets").innerHTML =
      `<div class="muted">아직 보유한 티켓이 없습니다.</div>`;
  }else{
    $("myTickets").innerHTML = state.myTickets
      .slice().reverse()
      .map(t=>`<span class="ticket ticket--me">시리즈 ${t.series} · #${formatTicket(t.no)}</span>`)
      .join("");
  }

  // 최근 결과
  if(state.results.length===0){
    $("recentResults").innerHTML =
      `<div class="muted">아직 종료된 시리즈가 없습니다.</div>`;
  }else{
    $("recentResults").innerHTML = state.results
      .map(r=>`
        <div class="card" style="background:rgba(255,255,255,.06)">
          <div class="row row--space">
            <div>
              <b>결과 · 시리즈 ${r.series}</b>
              <div class="muted">${r.name} · ${r.reward.toLocaleString()} UT 획득</div>
            </div>
            <div class="muted" style="font-size:12px">${formatKST(r.time)}</div>
          </div>
        </div>
      `).join("");
  }
}

function calc(){
  const qty = clamp(parseInt($("qtyInput").value||1),1,100-state.sold);
  $("qtyInput").value = qty;
  $("costUt").textContent = 0;
  const p = (1-Math.pow(99/100,qty))*100;
  $("winChance").textContent = p.toFixed(2);
}

$("qtyMinus").onclick=()=>{ $("qtyInput").value--; calc(); };
$("qtyPlus").onclick =()=>{ $("qtyInput").value++; calc(); };
$("qtyInput").oninput = calc;

$("buyBtn").onclick=()=>{
  const qty = clamp(parseInt($("qtyInput").value),1,100-state.sold);
  const available=[];
  state.tickets.forEach((v,i)=>{ if(!v) available.push(i); });
  available.sort(()=>Math.random()-0.5);

  for(let i=0;i<qty;i++){
    const idx = available[i];
    state.tickets[idx]=true;
    state.myTickets.push({series:state.seriesId,no:idx+1});
  }
  state.sold += qty;

  if(state.sold>=100){
    const win = Math.floor(Math.random()*100)+1;
    state.results.unshift({
      series:state.seriesId,
      name:maskName("이민율"),
      reward:CFG.REWARD,
      time:new Date().toISOString()
    });

    // 다음 시리즈
    state.seriesNo++;
    state.seriesId = seriesLabel(state.seriesNo);
    state.sold=0;
    state.tickets=Array(100).fill(null);
    state.myTickets=[];
  }

  save(state);
  updateUI();
  calc();
};

updateUI();
calc();
