/* ── 나중에 Outlook Graph API + 알림 서버로 교체될 부분 ── */
const PRIORITY = {
  red:{label:"긴급·중요",color:"var(--p-red)"}, orange:{label:"긴급·덜중요",color:"var(--p-orange)"},
  yellow:{label:"덜긴급·중요",color:"var(--p-yellow)"}, green:{label:"덜긴급·덜중요",color:"var(--p-green)"},
  gray:{label:"중요도 없음",color:"var(--p-gray)"},
};
const PRIORITY_ORDER = ["red","orange","yellow","green","gray"];
const REMINDER_OPTIONS = [
  {v:"none",l:"알림 없음"},{v:"0",l:"정시"},{v:"5",l:"5분 전"},{v:"10",l:"10분 전"},
  {v:"15",l:"15분 전"},{v:"30",l:"30분 전"},{v:"60",l:"1시간 전"},{v:"120",l:"2시간 전"},{v:"1440",l:"1일 전"},
];

let EVENTS = {
  "2026-08-09": [ { id:9, start:"11:00", end:"11:30", title:"어제 못한 협력사 통화", priority:"orange", reminder:"15", source:"manual", done:false } ],
  "2026-08-10": [
    { id:1, start:"10:00", end:"12:00", title:"A스타트업 IR 자문", priority:"orange", reminder:"30", source:"outlook", done:false },
    { id:2, start:"14:00", end:"15:30", title:"창업지원기관 멘토링", priority:"red", reminder:"30", source:"outlook", done:false },
    { id:3, start:"16:00", end:"17:00", title:"투자자 미팅 배석", priority:"yellow", reminder:"15", source:"outlook", done:false },
  ],
  "2026-08-11": [ { id:4, start:"09:30", end:"10:00", title:"주간 팀 미팅", priority:"gray", reminder:"30", source:"outlook", done:false } ],
};
let TODOS = {
  "2026-08-09": [ { id:100, title:"어제 마감 못한 견적서 검토", dueTime:"18:00", priority:"red", reminder:"30", done:false, highlight:true } ],
  "2026-08-10": [ { id:101, title:"내 사업 MVP·GTM 딥워크", dueTime:"22:00", priority:"red", reminder:"30", done:false, highlight:false } ],
  "2026-08-11": [ { id:102, title:"주간 보고서 작성", dueTime:"18:00", priority:"yellow", reminder:"60", done:false, highlight:false } ],
};
let nextId = 200;
/* ───────────────────────────────────────── */

let state = { view:"day", cursor:new Date(2026,7,10) };
const todayKey = "2026-08-10";
let modalState = null;
let pickedPriority = null;

function pad(n){ return String(n).padStart(2,'0'); }
function keyOf(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function startOfWeek(d){ const r=new Date(d); const diff=(d.getDay()+6)%7; r.setDate(d.getDate()-diff); return r; }
function nowHM(){ const n=new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; }
function addMinutes(hm, mins){ let [h,m]=hm.split(':').map(Number); let total=((h*60+m+mins)%1440+1440)%1440; return `${pad(Math.floor(total/60))}:${pad(total%60)}`; }

function switchView(v){ state.view=v; render(); }
function shift(delta){
  const c = state.cursor;
  if(state.view==="day") c.setDate(c.getDate()+delta);
  else if(state.view==="week") c.setDate(c.getDate()+7*delta);
  else c.setMonth(c.getMonth()+delta);
  render();
}
function selectDay(key){ state.cursor=new Date(key+"T00:00:00"); state.view="day"; render(); }
function selectDayAndOpen(key){ selectDay(key); openEventModal(key); }

function toggleTodo(key, idx){ TODOS[key][idx].done=!TODOS[key][idx].done; render(); }
function toggleEventDone(key, idx){ EVENTS[key][idx].done=!EVENTS[key][idx].done; render(); }
function toggleHighlight(kind, key, idx){
  const store = kind==='event'?EVENTS:TODOS;
  store[key][idx].highlight = !store[key][idx].highlight;
  render();
}

/* ── 어제까지 미완료 이월 ── */
function withCarry(d){
  const key = keyOf(d);
  let evs = (EVENTS[key]||[]).map((e,idx)=>({...e,_key:key,_idx:idx,carried:false}));
  let todos = (TODOS[key]||[]).map((t,idx)=>({...t,_key:key,_idx:idx,carried:false}));
  if(key===todayKey){
    Object.keys(EVENTS).filter(k=>k<todayKey).sort().forEach(k=>{
      EVENTS[k].forEach((e,idx)=>{ if(!e.done) evs.push({...e,_key:k,_idx:idx,carried:true}); });
    });
    Object.keys(TODOS).filter(k=>k<todayKey).sort().forEach(k=>{
      TODOS[k].forEach((t,idx)=>{ if(!t.done) todos.push({...t,_key:k,_idx:idx,carried:true}); });
    });
  }
  return {evs, todos};
}
function formatMD(key){ const [y,m,d]=key.split('-').map(Number); return `${m}/${d}`; }
function addDaysToKey(key,n){ const d=new Date(key+"T00:00:00"); d.setDate(d.getDate()+n); return keyOf(d); }
function daysBetween(a,b){ return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000); }
function carryInfo(origKey){
  const delay = Math.max(1, daysBetween(origKey, todayKey));
  const label = delay<=1 ? formatMD(origKey) : `${formatMD(origKey)}~${formatMD(addDaysToKey(todayKey,-1))}`;
  const size = Math.min(8 + 0.5*(delay-1), 11);
  const weight = Math.min(500 + 150*(delay-1), 900);
  return { label, size, weight };
}

/* ── 모달 ── */
function openEventModal(key){ modalState={type:'event',key}; renderModal(); }
function openTodoModal(key){ modalState={type:'todo',key}; renderModal(); }
function closeModal(){ modalState=null; document.getElementById('modalRoot').innerHTML=''; }

function renderModal(){
  const root = document.getElementById('modalRoot');
  if(!modalState){ root.innerHTML=''; return; }
  const { type, key } = modalState;
  const swatches = PRIORITY_ORDER.map(p=>`<div class="swatch" data-p="${p}" title="${PRIORITY[p].label}" style="background:${PRIORITY[p].color}" onclick="pickPriority('${p}')"></div>`).join('');

  if(type==='event'){
    const start = nowHM();
    root.innerHTML = `
      <div class="overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h4>새 일정 추가</h4>
          <div class="field"><label>제목</label><input type="text" id="ev-title" placeholder="일정 제목"></div>
          <div class="field"><label>날짜</label><input type="date" id="ev-date" value="${key}"></div>
          <div class="field"><label>시작 시간</label><input type="time" id="ev-start" value="${start}" onchange="document.getElementById('ev-end-hint').textContent='종료 '+addMinutes(this.value,30)"></div>
          <div class="field" style="color:var(--mid); font-size:11px; margin-top:-6px;">종료 시간은 자동으로 시작 30분 후 (<span id="ev-end-hint">종료 ${addMinutes(start,30)}</span>)</div>
          <div class="field"><label>중요도</label><div class="prio-row" id="prio-row">${swatches}</div></div>
          <div class="field"><label>알림</label>
            <select id="ev-reminder">${REMINDER_OPTIONS.map(o=>`<option value="${o.v}" ${o.v==='30'?'selected':''}>${o.l}</option>`).join('')}</select>
          </div>
          <div class="modal-actions"><button class="btn-cancel" onclick="closeModal()">취소</button><button class="btn-save" onclick="saveEvent()">추가</button></div>
        </div>
      </div>`;
    pickPriority('red');
  } else {
    root.innerHTML = `
      <div class="overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h4>새 투두 추가</h4>
          <div class="field"><label>할 일</label><input type="text" id="td-title" placeholder="할 일 내용"></div>
          <div class="row2">
            <div class="field"><label>기한 날짜</label><input type="date" id="td-date" value="${key}"></div>
            <div class="field"><label>기한 시간</label><input type="time" id="td-time" value="18:00"></div>
          </div>
          <div class="field"><label>중요도</label><div class="prio-row" id="prio-row">${swatches}</div></div>
          <div class="field"><label>알림</label>
            <select id="td-reminder">${REMINDER_OPTIONS.map(o=>`<option value="${o.v}" ${o.v==='30'?'selected':''}>${o.l}</option>`).join('')}</select>
          </div>
          <div class="modal-actions"><button class="btn-cancel" onclick="closeModal()">취소</button><button class="btn-save" onclick="saveTodo()">추가</button></div>
        </div>
      </div>`;
    pickPriority('gray');
  }
}
function pickPriority(p){
  pickedPriority = p;
  document.querySelectorAll('#prio-row .swatch').forEach(el=>el.classList.toggle('selected', el.dataset.p===p));
}
function saveEvent(){
  const title = document.getElementById('ev-title').value.trim();
  if(!title) return;
  const date = document.getElementById('ev-date').value;
  const start = document.getElementById('ev-start').value;
  const end = addMinutes(start,30);
  const reminder = document.getElementById('ev-reminder').value;
  if(!EVENTS[date]) EVENTS[date]=[];
  EVENTS[date].push({ id:nextId++, start, end, title, priority:pickedPriority||'gray', reminder, source:'manual', done:false, highlight:false });
  state.cursor = new Date(date+"T00:00:00");
  closeModal(); render();
}
function saveTodo(){
  const title = document.getElementById('td-title').value.trim();
  if(!title) return;
  const date = document.getElementById('td-date').value;
  const time = document.getElementById('td-time').value;
  const reminder = document.getElementById('td-reminder').value;
  if(!TODOS[date]) TODOS[date]=[];
  TODOS[date].push({ id:nextId++, title, dueTime:time, priority:pickedPriority||'gray', reminder, done:false, highlight:false });
  state.cursor = new Date(date+"T00:00:00");
  closeModal(); render();
}

/* ── 아이템 로우 렌더 ── */
function iconBtns(kind, key, idx, reminder, highlight){
  return `
    <span class="icon-btn ${highlight?'active':''}" onclick="toggleHighlight('${kind}','${key}',${idx})" title="중요 표시">🖍️</span>
    <span class="icon-btn ${reminder && reminder!=='none' ? 'active':''}" title="알림 ${reminder && reminder!=='none' ? REMINDER_OPTIONS.find(o=>o.v===reminder)?.l||'' : '없음'}">🔔</span>
  `;
}

function dayAgendaHtml(d){
  const key = keyOf(d);
  const { evs, todos } = withCarry(d);

  const evHtml = evs.length ? evs.map(e => `
    <div class="item-row">
      <div class="prio-bar" style="background:${PRIORITY[e.priority].color}"></div>
      <div class="checkbox ${e.done?'checked':''}" onclick="toggleEventDone('${e._key}',${e._idx})">${e.done?'✓':''}</div>
      <div class="item-time">${e.start}\n~${e.end}</div>
      <div class="title-wrap">
        ${e.carried? (ci=>`<span class="carry-super" style="font-size:${ci.size}px; font-weight:${ci.weight};">${ci.label}</span>`)(carryInfo(e._key)) : ''}
        <span class="item-title ${e.done?'done':''} ${e.highlight?'highlighted':''}">${e.title}</span>
      </div>
      ${iconBtns('event', e._key, e._idx, e.reminder, e.highlight)}
    </div>`).join('') : `<div class="empty">일정 없음</div>`;

  const todoHtml = todos.length ? todos.map(t => `
    <div class="item-row">
      <div class="prio-bar" style="background:${PRIORITY[t.priority].color}"></div>
      <div class="checkbox ${t.done?'checked':''}" onclick="toggleTodo('${t._key}',${t._idx})">${t.done?'✓':''}</div>
      <div class="item-time todo-time">${t.dueTime||''}</div>
      <div class="title-wrap">
        ${t.carried? (ci=>`<span class="carry-super" style="font-size:${ci.size}px; font-weight:${ci.weight};">${ci.label}</span>`)(carryInfo(t._key)) : ''}
        <span class="item-title ${t.done?'done':''} ${t.highlight?'highlighted':''}">${t.title}</span>
      </div>
      ${iconBtns('todo', t._key, t._idx, t.reminder, t.highlight)}
    </div>`).join('') : `<div class="empty">투두 없음</div>`;

  return `
    <div class="section-head"><span>오늘의 일정</span>
      <div class="right"><span class="count">${evs.length}건</span><button class="add-btn" onclick="openEventModal('${key}')">+</button></div>
    </div>
    ${evHtml}
    <div class="section-head"><span>투두</span>
      <div class="right"><span class="count">${todos.filter(t=>!t.done).length}건 남음</span><button class="add-btn" onclick="openTodoModal('${key}')">+</button></div>
    </div>
    ${todoHtml}
  `;
}

/* ── 상단 nav 라벨 ── */
function navLabel(){
  if(state.view==='day'){ const d=state.cursor; return `${d.getMonth()+1}.${d.getDate()} (${'일월화수목금토'[d.getDay()]})`; }
  if(state.view==='week'){ const s=startOfWeek(state.cursor); const e=new Date(s); e.setDate(s.getDate()+4); return `${s.getMonth()+1}.${s.getDate()}-${e.getMonth()+1}.${e.getDate()}`; }
  return `${state.cursor.getFullYear()}.${pad(state.cursor.getMonth()+1)}`;
}

function renderDay(){ return dayAgendaHtml(state.cursor); }

function renderWeek(){
  const start = startOfWeek(state.cursor);
  const days = [...Array(5)].map((_,i)=>{ const dd=new Date(start); dd.setDate(start.getDate()+i); return dd; });
  const cols = days.map(d=>{
    const key = keyOf(d);
    const evs = EVENTS[key]||[];
    const todos = TODOS[key]||[];
    const isToday = key===todayKey;
    const chips = [
      ...evs.map((e,idx)=>`<div class="week-chip" data-type="event" data-key="${key}" data-idx="${idx}" style="background:${PRIORITY[e.priority].color}">
          <span class="wc-title ${e.done?'done':''}">${e.start} ${e.title}</span></div>`),
      ...todos.map((t,idx)=>`<div class="week-chip" data-type="todo" data-key="${key}" data-idx="${idx}" style="background:${PRIORITY[t.priority].color}">
          <span class="wc-check ${t.done?'checked':''}" onclick="event.stopPropagation(); toggleTodo('${key}',${idx})"></span>
          <span class="wc-title ${t.done?'done':''}">${t.title}</span></div>`)
    ].join('');
    return `<div class="week-col" data-key="${key}">
        <div class="wh ${isToday?'today':''}" onclick="selectDayAndOpen('${key}')">${'일월화수목금토'[d.getDay()]}<span class="n">${d.getDate()}</span></div>
        ${chips}
      </div>`;
  }).join('');
  return `<div class="week-grid" id="weekGrid">${cols}</div>${dayAgendaHtml(state.cursor)}`;
}

function renderMonth(){
  const y=state.cursor.getFullYear(), m=state.cursor.getMonth();
  const first=new Date(y,m,1); const startDay=first.getDay();
  const daysInMonth=new Date(y,m+1,0).getDate(); const prevDaysInMonth=new Date(y,m,0).getDate();
  let cells=[];
  for(let i=0;i<startDay;i++) cells.push({day:prevDaysInMonth-startDay+1+i,faded:true,date:new Date(y,m-1,prevDaysInMonth-startDay+1+i)});
  for(let d=1; d<=daysInMonth; d++) cells.push({day:d,faded:false,date:new Date(y,m,d)});
  while(cells.length%7!==0){ const n=cells.length-(startDay+daysInMonth)+1; cells.push({day:n,faded:true,date:new Date(y,m+1,n)}); }
  let rows=[];
  for(let r=0;r<cells.length/7;r++){
    const rowCells = cells.slice(r*7,r*7+7).map(c=>{
      const key=keyOf(c.date); const isToday=key===todayKey; const isSelected=key===keyOf(state.cursor)&&!isToday;
      const items=[...(EVENTS[key]||[]),...(TODOS[key]||[])];
      const dots=items.slice(0,6).map(it=>`<div class="dot" style="background:${PRIORITY[it.priority].color}"></div>`).join('');
      return `<td class="${c.faded?'faded':''} ${isToday?'today':''} ${isSelected?'selected':''}" onclick="selectDayAndOpen('${key}')"><span class="num">${c.day}</span><div class="dot-row">${dots}</div></td>`;
    }).join('');
    rows.push(`<tr>${rowCells}</tr>`);
  }
  return `<table class="month-grid"><tr><th>일</th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th><th>토</th></tr>${rows.join('')}</table>${dayAgendaHtml(state.cursor)}`;
}

function render(){
  const body = state.view==="day"?renderDay():state.view==="week"?renderWeek():renderMonth();
  document.getElementById('app').innerHTML = `
    <div class="top">
      <div class="view-switch">
        <button class="${state.view==='day'?'active':''}" onclick="switchView('day')">일간</button>
        <button class="${state.view==='week'?'active':''}" onclick="switchView('week')">주간</button>
        <button class="${state.view==='month'?'active':''}" onclick="switchView('month')">월간</button>
      </div>
      <div class="nav"><button onclick="shift(-1)">‹</button><div class="label">${navLabel()}</div><button onclick="shift(1)">›</button></div>
    </div>
    ${body}
  `;
  if(state.view==='week') bindWeekDrag();
}

/* ── 주간뷰 꾹눌러 이동 ── */
let drag = null; // {type,key,idx,el,ghost,srcEl}
let pressTimer = null;
const EDGE_ZONE = 42, EDGE_HOLD_MS = 2000;
let edgeSide = null, edgeEnterTime = null, rafId = null;

function bindWeekDrag(){
  document.querySelectorAll('.week-chip').forEach(chip=>{
    chip.addEventListener('pointerdown', onChipPointerDown);
  });
}

function onChipPointerDown(e){
  if(e.target.classList.contains('wc-check')) return;
  const chip = e.currentTarget;
  const sx=e.clientX, sy=e.clientY;
  let moved=false;
  const moveWatch = (me)=>{ if(Math.abs(me.clientX-sx)>10||Math.abs(me.clientY-sy)>10){ moved=true; clearTimeout(pressTimer); cleanup(); } };
  const upWatch = ()=>{ clearTimeout(pressTimer); cleanup(); };
  function cleanup(){ document.removeEventListener('pointermove',moveWatch); document.removeEventListener('pointerup',upWatch); }
  document.addEventListener('pointermove', moveWatch);
  document.addEventListener('pointerup', upWatch, {once:true});

  pressTimer = setTimeout(()=>{
    if(moved) return;
    cleanup();
    startDrag(chip, e.clientX, e.clientY);
  }, 450);
}

function startDrag(chip, x, y){
  drag = { type:chip.dataset.type, key:chip.dataset.key, idx:Number(chip.dataset.idx) };
  chip.classList.add('dragging-src');
  const ghost = chip.cloneNode(true);
  ghost.classList.add('ghost-chip');
  ghost.classList.remove('dragging-src');
  ghost.style.left = x+'px'; ghost.style.top = y+'px';
  document.body.appendChild(ghost);
  drag.ghost = ghost; drag.srcEl = chip;

  edgeSide = null; edgeEnterTime = null;
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd, {once:true});
  rafId = requestAnimationFrame(edgeWatchLoop);
}

function edgeWatchLoop(){
  if(!drag){ rafId=null; return; }
  if(edgeSide && edgeEnterTime!=null && (performance.now()-edgeEnterTime) >= EDGE_HOLD_MS){
    shift(edgeSide==='left' ? -1 : 1);
    bindWeekDrag();
    edgeEnterTime = performance.now(); // 계속 누르고 있으면 반복 이동
  }
  rafId = requestAnimationFrame(edgeWatchLoop);
}

function onDragMove(e){
  if(!drag) return;
  drag.ghost.style.left = e.clientX+'px';
  drag.ghost.style.top = e.clientY+'px';

  document.querySelectorAll('.week-col').forEach(c=>c.classList.remove('drop-target'));
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const col = under && under.closest('.week-col');
  if(col) col.classList.add('drop-target');

  const w = window.innerWidth;
  let side = null;
  if(e.clientX < EDGE_ZONE) side='left';
  else if(e.clientX > w-EDGE_ZONE) side='right';

  document.getElementById('edgeLeft').classList.toggle('show', side==='left');
  document.getElementById('edgeRight').classList.toggle('show', side==='right');

  if(side !== edgeSide){
    edgeSide = side;
    edgeEnterTime = side ? performance.now() : null;
  }
}

function onDragEnd(e){
  document.removeEventListener('pointermove', onDragMove);
  if(rafId){ cancelAnimationFrame(rafId); rafId=null; }
  edgeSide = null; edgeEnterTime = null;
  document.getElementById('edgeLeft').classList.remove('show');
  document.getElementById('edgeRight').classList.remove('show');
  document.querySelectorAll('.week-col').forEach(c=>c.classList.remove('drop-target'));

  const under = document.elementFromPoint(e.clientX, e.clientY);
  const col = under && under.closest('.week-col');
  if(drag.ghost) drag.ghost.remove();
  if(drag.srcEl) drag.srcEl.classList.remove('dragging-src');

  if(col){
    const targetKey = col.dataset.key;
    if(targetKey && targetKey !== drag.key){
      moveItem(drag.type, drag.key, drag.idx, targetKey);
    }
  }
  drag = null;
  render();
}

function moveItem(type, fromKey, idx, toKey){
  const store = type==='event'?EVENTS:TODOS;
  const item = store[fromKey][idx];
  store[fromKey].splice(idx,1);
  if(!store[toKey]) store[toKey]=[];
  store[toKey].push(item);
}

render();
