/* ---------- 대기행렬(M/M/c) 계산 ---------- */
// λ: 시간당 도착 고객수, μ: ITM 1대의 시간당 처리량, c: ITM 대수
function factorial(n){let r=1;for(let i=2;i<=n;i++)r*=i;return r;}
function erlang(lambda, mu, c){
  const a = lambda/mu;        // 제공 부하(Erlang)
  const rho = a/c;            // 이용률
  if(rho >= 1) return {rho, wqMin:Infinity, lq:Infinity, stable:false};
  let sum=0;
  for(let k=0;k<c;k++) sum += Math.pow(a,k)/factorial(k);
  const top = Math.pow(a,c)/factorial(c) * (1/(1-rho));
  const pWait = top/(sum+top);          // 기다릴 확률 (Erlang C)
  const wqHr = pWait/(c*mu - lambda);   // 평균 대기(시간)
  const lq = lambda*wqHr;               // 평균 대기 인원 (Little의 법칙)
  return {rho, wqMin:wqHr*60, lq, stable:true};
}

const COST = {install:2500, monthly:30, minC:2, maxC:6}; // 만원 / 대
const state = {bank:'hana', lambda:40, svcMin:5, targetMin:5, recC:4, chosenC:4};

function mu(){ return 60/state.svcMin; } // 분→시간당 처리량

/* ---------- STEP 3 ---------- */
function computeRec(){
  const m = mu();
  let rec = null;
  for(let c=COST.minC;c<=COST.maxC;c++){
    const r = erlang(state.lambda, m, c);
    if(r.stable && r.wqMin <= state.targetMin){ rec=c; break; }
  }
  if(rec===null) rec=COST.maxC; // 목표 못 맞추면 최대치
  state.recC = rec;
  return rec;
}

function renderStep3(){
  document.getElementById('oLam').textContent = state.lambda;
  document.getElementById('oSvc').textContent = state.svcMin;
  document.getElementById('oTgt').textContent = state.targetMin;

  const rec = computeRec();
  const m = mu();
  const rr = erlang(state.lambda, m, rec);
  document.getElementById('recNum').textContent = rec;
  document.getElementById('recNote').innerHTML =
    `목표 대기 <b>${state.targetMin}분</b> 이내를 만족하는 <b>최소 대수</b>입니다.<br>`+
    `예상 평균 대기 <b>${rr.wqMin.toFixed(1)}분</b> · 이용률 <b>${(rr.rho*100).toFixed(0)}%</b>. `+
    `더 늘리면 대기는 줄지만 투자·운영비가 커집니다.`;

  // 비교 표
  const body = document.getElementById('cmpBody');
  body.innerHTML = '';
  for(let c=COST.minC;c<=COST.maxC;c++){
    const r = erlang(state.lambda, m, c);
    const tr = document.createElement('tr');
    if(c===rec) tr.className='pick';
    else if(!r.stable) tr.className='bad';
    const wait = r.stable ? r.wqMin.toFixed(1)+'분' : '폭증';
    const rho  = r.stable ? (r.rho*100).toFixed(0)+'%' : '100%+';
    const lqMonth = r.stable ? Math.round(r.lq*22*8) : '—'; // 월 근사(22일·8h)
    const meet = r.stable && r.wqMin<=state.targetMin;
    const tag = c===rec ? '<span class="pill ok">권고</span>' : (!r.stable ? '<span class="pill no">불가</span>' : '');
    tr.innerHTML =
      `<td>${c}대${tag}</td><td>${rho}</td><td>${wait}</td>`+
      `<td>${lqMonth==='—'?'—':lqMonth.toLocaleString()+'명'}</td>`+
      `<td>${(c*COST.install).toLocaleString()}만원</td>`+
      `<td>${(c*COST.monthly)}만원</td>`;
    body.appendChild(tr);
  }

  // 개요/헤더 동기화
  document.getElementById('ovRec').innerHTML = rec+'<small>대 권고</small>';
  document.getElementById('ovWait').innerHTML = rr.wqMin.toFixed(1)+'<small>분</small>';
  const cb = BANKS[state.bank];
  document.getElementById('topVerdict').innerHTML = cb.hold
    ? `<span class="r">종합 판정</span> ${cb.verdict}`
    : `<span class="r">종합 판정</span> ${cb.verdict} · ITM ${rec}대`;

  // STEP4 선택값이 범위 밖이면 권고값으로
  if(state.chosenC < COST.minC || state.chosenC > COST.maxC) state.chosenC = rec;
  renderStep4();
}

['lam','svc','tgt'].forEach(id=>{
  document.getElementById(id).addEventListener('input', e=>{
    const v = parseFloat(e.target.value);
    if(id==='lam') state.lambda=v;
    if(id==='svc') state.svcMin=v;
    if(id==='tgt') state.targetMin=v;
    state.chosenC = computeRec(); // 가정 바뀌면 시뮬도 권고값 따라감
    renderStep3();
    renderOverview(BANKS[state.bank]);
  });
});

/* ---------- STEP 4 ---------- */
function renderSeg(){
  const seg = document.getElementById('seg');
  seg.innerHTML='';
  for(let c=COST.minC;c<=COST.maxC;c++){
    const b=document.createElement('button');
    b.textContent=c+'대';
    if(c===state.chosenC) b.className='on';
    b.onclick=()=>{state.chosenC=c;renderStep4();};
    seg.appendChild(b);
  }
}

function renderStep4(){
  renderSeg();
  const c = state.chosenC;
  const m = mu();
  const r = erlang(state.lambda, m, c);

  document.getElementById('segHint').textContent =
    c===state.recC ? '← 권고안' : (c<state.recC?'권고보다 적음 (대기 위험)':'권고보다 많음 (여유 투자)');

  // 기계
  const machines = document.getElementById('machines');
  machines.innerHTML='';
  const busyCount = r.stable ? Math.min(c, Math.round(r.rho*c)) : c;
  for(let i=0;i<c;i++){
    const d=document.createElement('div');
    d.className='itm'+(i<busyCount?' busy':'');
    d.innerHTML=`<div class="scr"></div>ITM${i<busyCount?'<div class="who"></div>':''}`;
    machines.appendChild(d);
  }

  // 대기 줄
  const q=document.getElementById('queue');
  q.innerHTML='';
  const waiting = r.stable ? Math.min(Math.round(r.lq), 20) : 20;
  if(waiting===0){ q.innerHTML='<span class="empty">대기 없음 — 바로 이용</span>'; }
  else for(let i=0;i<waiting;i++){
    const d=document.createElement('div');d.className='cust';
    d.style.animationDelay=(i*0.04)+'s';q.appendChild(d);
  }
  if(!r.stable){ q.innerHTML='<span class="empty" style="color:var(--risk)">⚠ 대기 줄 폭증 — 처리 불가</span>'; }

  // 지표
  const stats=document.getElementById('stats');
  const invest=c*COST.install, monthly=c*COST.monthly;
  const meet = r.stable && r.wqMin<=state.targetMin;
  stats.innerHTML=`
    <div class="stat ${meet?'hl':'bad'}"><div class="k">평균 대기시간</div><div class="v">${r.stable?r.wqMin.toFixed(1):'∞'}<span>분</span></div></div>
    <div class="stat ${r.stable&&r.rho<0.85?'hl':(r.stable?'':'bad')}"><div class="k">ITM 이용률</div><div class="v">${r.stable?(r.rho*100).toFixed(0):'100+'}<span>%</span></div></div>
    <div class="stat"><div class="k">초기 투자비</div><div class="v">${invest.toLocaleString()}<span>만원</span></div></div>
    <div class="stat"><div class="k">월 운영비</div><div class="v">${monthly}<span>만원</span></div></div>
  `;
}

/* ---------- 네비게이션 ---------- */
function go(s){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.s===s));
  document.querySelectorAll('.screen').forEach(sc=>sc.classList.toggle('active',sc.dataset.s===s));
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('.nav-item').forEach(n=>n.onclick=()=>go(n.dataset.s));
document.querySelectorAll('.step').forEach(st=>st.onclick=()=>go(st.dataset.go));

/* ---------- 은행별 데이터 ---------- */
/* BANKS 객체는 banks.js 로 분리했습니다. (index.html에서 먼저 로드) */

/* ---------- 색상 헬퍼 ---------- */
function gradeKind(g){ return g==='A'?'ok':g==='B'?'warn':'risk'; }
function scoreKind(s){ return s>70?'risk':(s>=40?'warn':'ok'); }
function kindVar(k){ return k==='ok'?'var(--accent)':k==='warn'?'var(--warn)':'var(--risk)'; }
function kindSoft(k){ return k==='ok'?'var(--accent-soft)':k==='warn'?'var(--warn-soft)':'var(--risk-soft)'; }
function kindHex(k){ return k==='ok'?'#0E7C6B':k==='warn'?'#B26A00':'#C0392B'; }
function setNavDot(s,k){
  const el=document.querySelector(`.nav-item[data-s="${s}"] .st`);
  if(el) el.className='st st-'+k;
}

/* ---------- PAIRS 연동 헬퍼 ---------- */
// PAIRS는 data/pairs.js 에서 전역으로 로드됨 (index.html에서 먼저 로드)

/** 가장 가까운 대체 시설까지의 거리(km) 반환. 없으면 null */
function getNearest(pairKey){
  const entry = (typeof PAIRS !== 'undefined') ? PAIRS[pairKey] : null;
  if(!entry?.인근?.length) return null;
  return entry.인근[0].거리;
}

/** 10km 이내 대체 시설 배열 전체 반환. 없으면 [] */
function getNearbyList(pairKey){
  const entry = (typeof PAIRS !== 'undefined') ? PAIRS[pairKey] : null;
  return entry?.인근 ?? [];
}

/** #s1nearby tbody를 인근 시설 목록으로 채움 */
function renderNearbyTable(pairKey){
  const tbody = document.getElementById('s1nearby');
  if(!tbody) return;
  const list = getNearbyList(pairKey);
  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--ink-3);padding:14px">10km 이내 동종 대체 시설 없음</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(n=>`
    <tr>
      <td style="text-align:left;font-weight:600">${n.지점}</td>
      <td style="text-align:left;font-weight:400;color:var(--ink-2);font-size:12px">${n.주소}</td>
      <td>${n.거리.toFixed(1)} km</td>
    </tr>`).join('');
}

/* ---------- STEP 1 렌더 ---------- */
function renderStep1(b){
  const s=b.s1;
  const pairKey = b.pairKey ?? null;

  // 가장 가까운 대체 점포 거리를 PAIRS에서 실시간으로 덮어씀
  const nearestDist = pairKey ? getNearest(pairKey) : null;
  const rows = s.rows.map(r=>{
    if(r[0] === '가장 가까운 대체 점포'){
      const val = nearestDist !== null ? nearestDist.toFixed(1) : r[1];
      return [r[0], val, r[2]];
    }
    return r;
  });

  document.getElementById('s1table').innerHTML =
    rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}<span class="u">${r[2]}</span></td></tr>`).join('');
  document.getElementById('s1score').textContent = s.score;
  const C=339.29, off=(C*(1-s.score/100)).toFixed(0);
  const arc=document.getElementById('s1arc');
  arc.setAttribute('stroke-dashoffset', off);
  arc.setAttribute('stroke', kindHex(scoreKind(s.score)));
  document.getElementById('s1risks').innerHTML = s.risks.map(r=>
    `<div class="rb-row"><span class="lab">${r[0]}</span><span class="rb-track"><span class="rb-fill" style="width:${r[1]}%;background:${r[2]}"></span></span><span class="val">${r[3]}</span></div>`).join('');
  document.getElementById('s1note').innerHTML = '<b>해석:</b> '+s.note;
  setNavDot('s1', scoreKind(s.score));

  // 인근 시설 테이블 갱신
  renderNearbyTable(pairKey);
}

/* ---------- STEP 2 렌더 ---------- */
function renderStep2(b){
  const s=b.s2;
  const ageLab=['20~30대','40~50대','60대+'];
  document.getElementById('s2ages').innerHTML = s.ages.map((v,i)=>
    `<div class="bar-row"><span class="lab">${ageLab[i]}</span><span class="bar-track"><span class="bar-fill${i===2?' mut':''}" style="width:${v}%"></span></span><span class="pct">${v}%</span></div>`).join('');
  const chLab=['모바일','자동화기기','대면 창구'];
  document.getElementById('s2channels').innerHTML = s.channels.map((v,i)=>
    `<div class="bar-row"><span class="lab">${chLab[i]}</span><span class="bar-track"><span class="bar-fill${i===2?' mut':''}" style="width:${v}%"></span></span><span class="pct">${v}%</span></div>`).join('');
  const k=gradeKind(s.grade);
  const badge=document.getElementById('s2badge');
  badge.textContent=s.grade; badge.style.background=kindSoft(k); badge.style.color=kindVar(k);
  document.getElementById('s2gradetxt').innerHTML=`<b>${s.gradeLabel}</b><p>${s.note}</p>`;
  setNavDot('s2', k);
}

/* ---------- 개요 렌더 ---------- */
function renderOverview(b){
  const rec=state.recC;
  document.getElementById('ovBannerT').textContent = b.ovTitle.replace(/__REC__/g,rec);
  document.getElementById('ovBannerB').textContent = b.ovBody.replace(/__REC__/g,rec).replace(/__TGT__/g,state.targetMin);
  const k=b.ovClass;
  document.getElementById('ovBanner').style.background=kindSoft(k);
  document.getElementById('ovIcon').style.background=kindVar(k);
  document.getElementById('ovStep1').innerHTML=b.s1.score+'<small>/100 영향도</small>';
  document.getElementById('ovStep2').innerHTML=b.s2.grade+'<small> '+b.s2.gradeLabel+'</small>';
  document.getElementById('ovFlag1').className='flag st-'+scoreKind(b.s1.score);
  document.getElementById('ovFlag2').className='flag st-'+gradeKind(b.s2.grade);
}

/* ---------- 은행 전환 ---------- */
function loadBank(id){
  state.bank=id;
  const b=BANKS[id];
  state.lambda=b.s3.lambda; state.svcMin=b.s3.svc;
  document.getElementById('lam').value=b.s3.lambda;
  document.getElementById('svc').value=b.s3.svc;
  state.chosenC=computeRec();       // state.recC 확정
  renderStep1(b);
  renderStep2(b);
  renderStep3();                    // 권고/비교표/헤더 판정/개요 STEP3·4 갱신
  renderOverview(b);                // 확정된 recC로 배너·파이프라인 갱신
  document.getElementById('branchName').textContent=b.branch;
}

/* init */
const bankSel=document.getElementById('bankSel');
Object.entries(BANKS).forEach(([id,b])=>{
  const o=document.createElement('option'); o.value=id; o.textContent=b.name; bankSel.appendChild(o);
});
bankSel.addEventListener('change', e=>loadBank(e.target.value));
loadBank('hana');
