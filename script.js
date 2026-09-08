/* ============================================================
   일정 · 투두 캘린더
   - 데이터: Firebase Firestore(설정 시) 또는 로컬(localStorage) 폴백
   - 역할: 편집 모드(모바일=추가/수정/삭제) / 읽기 모드(전자책=열람+완료체크)
   ============================================================ */

const PRIORITY = {
  red:{label:"긴급·중요"}, orange:{label:"긴급·덜중요"},
  yellow:{label:"덜긴급·중요"}, green:{label:"덜긴급·덜중요"},
  gray:{label:"중요도 없음"},
};
const PRIORITY_ORDER = ["red","orange","yellow","green","gray"];
const REMINDER_OPTIONS = [
  {v:"none",l:"알림 없음"},{v:"0",l:"정시"},{v:"5",l:"5분 전"},{v:"10",l:"10분 전"},
  {v:"15",l:"15분 전"},{v:"30",l:"30분 전"},{v:"60",l:"1시간 전"},{v:"120",l:"2시간 전"},{v:"1440",l:"1일 전"},
];

/* ── 공용 헬퍼 ── */
function pad(n){ return String(n).padStart(2,'0'); }
function keyOf(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function startOfWeek(d){ const r=new Date(d); const diff=(d.getDay()+6)%7; r.setDate(d.getDate()-diff); return r; }
function nowHM(){ const n=new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; }
function addMinutes(hm, mins){ let [h,m]=hm.split(':').map(Number); let total=((h*60+m+mins)%1440+1440)%1440; return `${pad(Math.floor(total/60))}:${pad(total%60)}`; }
function escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ── 상태 ── */
const _today = new Date();
let state = { view:"day", cursor: new Date(_today.getFullYear(), _today.getMonth(), _today.getDate()) };
const todayKey = keyOf(state.cursor);
let modalState = null;
let pickedPriority = null;

/* ── 역할(기기 모드) ── */
function getRole(){ try{ return localStorage.getItem('deviceRole')==='read' ? 'read' : 'edit'; }catch(e){ return 'edit'; } }
function setRole(r){ try{ localStorage.setItem('deviceRole', r); }catch(e){} render(); }
function toggleRole(){ setRole(getRole()==='read' ? 'edit' : 'read'); }
function canEdit(){ return getRole()==='edit'; }

/* ============================================================
   데이터 저장소 (Firestore 또는 로컬)
   ============================================================ */
let EVENTS = {};   // { 'YYYY-MM-DD': [item, ...] }
let TODOS  = {};
let USE_CLOUD = false;
let syncError = false;
let fs = null;
let cloudStarted = false;

function coll(kind){ return kind==='event' ? 'events' : 'todos'; }
function getStore(kind){ return kind==='event' ? EVENTS : TODOS; }

function findItem(kind, id){
  const store = getStore(kind);
  for(const k in store){
    const arr = store[k];
    const idx = arr.findIndex(x=>String(x.id)===String(id));
    if(idx>=0) return { store, arr, key:k, idx, item:arr[idx] };
  }
  return null;
}

/* 로컬 저장 */
function saveLocal(){
  if(USE_CLOUD) return;
  try{
    localStorage.setItem('cal_events', JSON.stringify(EVENTS));
    localStorage.setItem('cal_todos', JSON.stringify(TODOS));
  }catch(e){}
}
function seedData(){
  const t=new Date(); const k=(off)=>{ const d=new Date(t); d.setDate(t.getDate()+off); return keyOf(d); };
  EVENTS = {
    [k(0)]:[ {id:'s1',date:k(0),start:'10:00',end:'12:00',title:'A스타트업 IR 자문',priority:'orange',reminder:'30',source:'manual',done:false,highlight:false} ],
    [k(-1)]:[ {id:'s2',date:k(-1),start:'11:00',end:'11:30',title:'어제 못한 협력사 통화',priority:'orange',reminder:'15',source:'manual',done:false,highlight:false} ],
  };
  TODOS = {
    [k(0)]:[ {id:'s3',date:k(0),title:'내 사업 MVP·GTM 딥워크',dueTime:'22:00',priority:'red',reminder:'30',done:false,highlight:false} ],
    [k(-1)]:[ {id:'s4',date:k(-1),title:'어제 마감 못한 견적서 검토',dueTime:'18:00',priority:'red',reminder:'30',done:false,highlight:true} ],
  };
}
function loadLocal(){
  try{
    const e=localStorage.getItem('cal_events'), td=localStorage.getItem('cal_todos');
    if(e && td){ EVENTS=JSON.parse(e); TODOS=JSON.parse(td); return; }
  }catch(err){}
  seedData(); saveLocal();
}

/* 통합 쓰기 API */
const DB = {
  add(kind, obj){
    if(USE_CLOUD){ return fs.collection(coll(kind)).add(obj).catch(e=>alert('저장 실패: '+e.message)); }
    obj.id = 'l'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    const store=getStore(kind); (store[obj.date]=store[obj.date]||[]).push(obj);
    saveLocal(); render();
  },
  update(kind, id, patch){
    if(USE_CLOUD){ return fs.collection(coll(kind)).doc(id).update(patch).catch(e=>alert('수정 실패: '+e.message)); }
    const f=findItem(kind,id); if(!f) return;
    Object.assign(f.item, patch);
    if(patch.date && patch.date!==f.key){
      f.arr.splice(f.idx,1);
      const store=getStore(kind); (store[patch.date]=store[patch.date]||[]).push(f.item);
    }
    saveLocal(); render();
  },
  remove(kind, id){
    if(USE_CLOUD){ return fs.collection(coll(kind)).doc(id).delete().catch(e=>alert('삭제 실패: '+e.message)); }
    const f=findItem(kind,id); if(!f) return;
    f.arr.splice(f.idx,1); saveLocal(); render();
  }
};

/* Firestore 스냅샷 → 화면 모델 */
function docsToStore(snap, kind){
  const store={};
  snap.forEach(doc=>{
    const it={ id:doc.id, ...doc.data() };
    if(!it.date) return;
    (store[it.date]=store[it.date]||[]).push(it);
  });
  const timeKey = kind==='event' ? 'start' : 'dueTime';
  for(const k in store) store[k].sort((a,b)=> String(a[timeKey]||'').localeCompare(String(b[timeKey]||'')));
  return store;
}
function startCloud(cfg){
  try{ firebase.initializeApp(cfg); }
  catch(e){ console.warn('Firebase 초기화 실패 → 로컬 모드', e); USE_CLOUD=false; loadLocal(); render(); return; }
  fs = firebase.firestore();
  try{ fs.enablePersistence({synchronizeTabs:true}).catch(()=>{}); }catch(e){}
  USE_CLOUD = true;
  firebase.auth().onAuthStateChanged(function(user){
    if(user && !cloudStarted){
      cloudStarted = true;
      fs.collection('events').onSnapshot(
        s=>{ syncError=false; EVENTS=docsToStore(s,'event'); render(); },
        e=>{ console.warn('events 동기화 오류', e); syncError=true; render(); }
      );
      fs.collection('todos').onSnapshot(
        s=>{ syncError=false; TODOS=docsToStore(s,'todo'); render(); },
        e=>{ console.warn('todos 동기화 오류', e); syncError=true; render(); }
      );
    }
  });
  firebase.auth().signInAnonymously().catch(function(e){ console.warn('익명 로그인 실패', e); syncError=true; render(); });
}

/* ── 항목 조작 ── */
function toggleDone(kind, id){ const f=findItem(kind,id); if(!f) return; DB.update(kind, id, {done:!f.item.done}); }
function toggleHighlight(kind, id){ if(!canEdit()) return; const f=findItem(kind,id); if(!f) return; DB.update(kind, id, {highlight:!f.item.highlight}); }
function deleteItem(kind, id){ if(!canEdit()) return; if(!confirm('삭제할까요?')) return; DB.remove(kind, id); closeModal(); render(); }

/* ── 뷰 전환/이동 ── */
function switchView(v){ state.view=v; render(); }
function shift(delta){
  const c=state.cursor;
  if(state.view==="day") c.setDate(c.getDate()+delta);
  else if(state.view==="week") c.setDate(c.getDate()+7*delta);
  else c.setMonth(c.getMonth()+delta);
  render();
}
/* 주간·월간에서 날짜 탭: 뷰 전환 없이 커서/아젠다만 갱신하고, 편집 모드면 추가 팝업 */
function selectDayAndOpen(key){ state.cursor=new Date(key+"T00:00:00"); render(); if(canEdit()) openEventModal(key); }

/* ── 어제까지 미완료 이월 ── */
function withCarry(d){
  const key = keyOf(d);
  let evs = (EVENTS[key]||[]).map((e)=>({...e,_key:key,carried:false}));
  let todos = (TODOS[key]||[]).map((t)=>({...t,_key:key,carried:false}));
  if(key===todayKey){
    Object.keys(EVENTS).filter(k=>k<todayKey).sort().forEach(k=>{
      EVENTS[k].forEach((e)=>{ if(!e.done) evs.push({...e,_key:k,carried:true}); });
    });
    Object.keys(TODOS).filter(k=>k<todayKey).sort().forEach(k=>{
      TODOS[k].forEach((t)=>{ if(!t.done) todos.push({...t,_key:k,carried:true}); });
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
  const size = Math.min(12 + 0.8*(delay-1), 16);
  const weight = Math.min(600 + 120*(delay-1), 900);
  return { label, size, weight };
}

/* ── 모달(추가/수정 공용) ── */
function openEventModal(key){ if(!canEdit()) return; modalState={type:'event',mode:'add',key}; renderModal(); }
function openTodoModal(key){ if(!canEdit()) return; modalState={type:'todo',mode:'add',key}; renderModal(); }
function openEditModal(kind, id){
  if(!canEdit()) return;
  const f=findItem(kind,id); if(!f) return;
  modalState={ type:kind, mode:'edit', id, item:f.item, key:f.item.date||f.key };
  renderModal();
}
function closeModal(){ modalState=null; document.getElementById('modalRoot').innerHTML=''; }

function renderModal(){
  const root=document.getElementById('modalRoot');
  if(!modalState){ root.innerHTML=''; return; }
  const { type, mode } = modalState;
  const item = modalState.item || {};
  const swatches = PRIORITY_ORDER.map(p=>`<div class="swatch pc-${p}" data-p="${p}" title="${PRIORITY[p].label}" onclick="pickPriority('${p}')"></div>`).join('');
  const remOpts = (sel)=>REMINDER_OPTIONS.map(o=>`<option value="${o.v}" ${o.v===sel?'selected':''}>${o.l}</option>`).join('');
  const delBtn = mode==='edit' ? `<button class="btn-del" onclick="deleteItem('${type}','${modalState.id}')">삭제</button>` : '';

  if(type==='event'){
    const start = mode==='edit' ? (item.start||nowHM()) : nowHM();
    const reminder = mode==='edit' ? (item.reminder||'30') : '30';
    root.innerHTML = `
      <div class="overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h4>${mode==='edit'?'일정 수정':'새 일정 추가'}</h4>
          <div class="field"><label>제목</label><input type="text" id="ev-title" placeholder="일정 제목" value="${escAttr(item.title)}"></div>
          <div class="field"><label>날짜</label><input type="date" id="ev-date" value="${modalState.key}"></div>
          <div class="field"><label>시작 시간</label><input type="time" id="ev-start" value="${start}" onchange="document.getElementById('ev-end-hint').textContent='종료 '+addMinutes(this.value,30)"></div>
          <div class="field" style="color:var(--mid); font-size:13px; margin-top:-8px;">종료 시간은 자동으로 시작 30분 후 (<span id="ev-end-hint">종료 ${addMinutes(start,30)}</span>)</div>
          <div class="field"><label>중요도</label><div class="prio-row" id="prio-row">${swatches}</div></div>
          <div class="field"><label>알림</label><select id="ev-reminder">${remOpts(reminder)}</select></div>
          <div class="modal-actions">${delBtn}<button class="btn-cancel" onclick="closeModal()">취소</button><button class="btn-save" onclick="saveEvent()">${mode==='edit'?'저장':'추가'}</button></div>
        </div>
      </div>`;
    pickPriority(mode==='edit' ? (item.priority||'gray') : 'red');
  } else {
    const time = mode==='edit' ? (item.dueTime||'18:00') : '18:00';
    const reminder = mode==='edit' ? (item.reminder||'30') : '30';
    root.innerHTML = `
      <div class="overlay" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h4>${mode==='edit'?'투두 수정':'새 투두 추가'}</h4>
          <div class="field"><label>할 일</label><input type="text" id="td-title" placeholder="할 일 내용" value="${escAttr(item.title)}"></div>
          <div class="row2">
            <div class="field"><label>기한 날짜</label><input type="date" id="td-date" value="${modalState.key}"></div>
            <div class="field"><label>기한 시간</label><input type="time" id="td-time" value="${time}"></div>
          </div>
          <div class="field"><label>중요도</label><div class="prio-row" id="prio-row">${swatches}</div></div>
          <div class="field"><label>알림</label><select id="td-reminder">${remOpts(reminder)}</select></div>
          <div class="modal-actions">${delBtn}<button class="btn-cancel" onclick="closeModal()">취소</button><button class="btn-save" onclick="saveTodo()">${mode==='edit'?'저장':'추가'}</button></div>
        </div>
      </div>`;
    pickPriority(mode==='edit' ? (item.priority||'gray') : 'gray');
  }
}
function pickPriority(p){
  pickedPriority = p;
  document.querySelectorAll('#prio-row .swatch').forEach(el=>el.classList.toggle('selected', el.dataset.p===p));
}
function saveEvent(){
  const title=document.getElementById('ev-title').value.trim(); if(!title) return;
  const date=document.getElementById('ev-date').value;
  const start=document.getElementById('ev-start').value;
  const end=addMinutes(start,30);
  const reminder=document.getElementById('ev-reminder').value;
  const priority=pickedPriority||'gray';
  if(modalState.mode==='edit'){ DB.update('event', modalState.id, {title,date,start,end,reminder,priority}); }
  else { DB.add('event', {date,start,end,title,priority,reminder,source:'manual',done:false,highlight:false,createdAt:Date.now()}); }
  state.cursor=new Date(date+"T00:00:00"); closeModal(); render();
}
function saveTodo(){
  const title=document.getElementById('td-title').value.trim(); if(!title) return;
  const date=document.getElementById('td-date').value;
  const time=document.getElementById('td-time').value;
  const reminder=document.getElementById('td-reminder').value;
  const priority=pickedPriority||'gray';
  if(modalState.mode==='edit'){ DB.update('todo', modalState.id, {title,date,dueTime:time,reminder,priority}); }
  else { DB.add('todo', {date,title,dueTime:time,priority,reminder,done:false,highlight:false,createdAt:Date.now()}); }
  state.cursor=new Date(date+"T00:00:00"); closeModal(); render();
}

/* ── 아이템 로우 액션 버튼 ── */
function actionBtns(kind, id, item){
  const rem = item.reminder;
  const bell = `<span class="icon-btn ${rem && rem!=='none' ? 'active':''}" title="알림 ${rem && rem!=='none' ? (REMINDER_OPTIONS.find(o=>o.v===rem)?.l||'') : '없음'}">🔔</span>`;
  if(!canEdit()) return bell;
  return `
    <span class="icon-btn ${item.highlight?'active':''}" onclick="toggleHighlight('${kind}','${id}')" title="형광">🖍️</span>
    <span class="icon-btn" onclick="openEditModal('${kind}','${id}')" title="수정">✏️</span>
    <span class="icon-btn" onclick="deleteItem('${kind}','${id}')" title="삭제">🗑️</span>
    ${bell}`;
}

function dayAgendaHtml(d){
  const key = keyOf(d);
  const { evs, todos } = withCarry(d);
  const edit = canEdit();

  const evHtml = evs.length ? evs.map(e => `
    <div class="item-row">
      <div class="prio-bar pc-${e.priority}"></div>
      <div class="checkbox ${e.done?'checked':''}" onclick="toggleDone('event','${e.id}')">${e.done?'✓':''}</div>
      <div class="item-time">${e.start}\n~${e.end}</div>
      <div class="title-wrap">
        ${e.carried? (ci=>`<span class="carry-super" style="font-size:${ci.size}px; font-weight:${ci.weight};">${ci.label}</span>`)(carryInfo(e._key)) : ''}
        <span class="item-title ${e.done?'done':''} ${e.highlight?'highlighted':''}">${e.title}</span>
      </div>
      ${actionBtns('event', e.id, e)}
    </div>`).join('') : `<div class="empty">일정 없음</div>`;

  const todoHtml = todos.length ? todos.map(t => `
    <div class="item-row">
      <div class="prio-bar pc-${t.priority}"></div>
      <div class="checkbox ${t.done?'checked':''}" onclick="toggleDone('todo','${t.id}')">${t.done?'✓':''}</div>
      <div class="item-time todo-time">${t.dueTime||''}</div>
      <div class="title-wrap">
        ${t.carried? (ci=>`<span class="carry-super" style="font-size:${ci.size}px; font-weight:${ci.weight};">${ci.label}</span>`)(carryInfo(t._key)) : ''}
        <span class="item-title ${t.done?'done':''} ${t.highlight?'highlighted':''}">${t.title}</span>
      </div>
      ${actionBtns('todo', t.id, t)}
    </div>`).join('') : `<div class="empty">투두 없음</div>`;

  return `
    <div class="section-head"><span>오늘의 일정</span>
      <div class="right"><span class="count">${evs.length}건</span>${edit?`<button class="add-btn" onclick="openEventModal('${key}')">+</button>`:''}</div>
    </div>
    ${evHtml}
    <div class="section-head"><span>투두</span>
      <div class="right"><span class="count">${todos.filter(t=>!t.done).length}건 남음</span>${edit?`<button class="add-btn" onclick="openTodoModal('${key}')">+</button>`:''}</div>
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
      ...evs.map((e)=>`<div class="week-chip cb-${e.priority}" data-type="event" data-id="${e.id}" data-key="${key}">
          <span class="wc-title ${e.done?'done':''} ${e.highlight?'highlighted':''}">${e.start} ${e.title}</span></div>`),
      ...todos.map((t)=>`<div class="week-chip cb-${t.priority}" data-type="todo" data-id="${t.id}" data-key="${key}">
          <span class="wc-check ${t.done?'checked':''}" onclick="event.stopPropagation(); toggleDone('todo','${t.id}')"></span>
          <span class="wc-title ${t.done?'done':''} ${t.highlight?'highlighted':''}">${t.title}</span></div>`)
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
      const dots=items.slice(0,6).map(it=>`<div class="dot pc-${it.priority}"></div>`).join('');
      return `<td class="${c.faded?'faded':''} ${isToday?'today':''} ${isSelected?'selected':''}" onclick="selectDayAndOpen('${key}')"><span class="num">${c.day}</span><div class="dot-row">${dots}</div></td>`;
    }).join('');
    rows.push(`<tr>${rowCells}</tr>`);
  }
  return `<table class="month-grid"><tr><th>일</th><th>월</th><th>화</th><th>수</th><th>목</th><th>금</th><th>토</th></tr>${rows.join('')}</table>${dayAgendaHtml(state.cursor)}`;
}

function render(){
  const body = state.view==="day"?renderDay():state.view==="week"?renderWeek():renderMonth();
  const roleLabel = getRole()==='read' ? '📖 읽기 모드(전자책)' : '✏️ 편집 모드(모바일)';
  const syncLabel = USE_CLOUD ? (syncError ? '⚠︎ 동기화 오류(설정 확인)' : '☁︎ 동기화 켜짐') : '⌂ 이 기기에만 저장';
  document.getElementById('app').innerHTML = `
    <div class="mode-line">
      <button class="mode-btn" onclick="toggleRole()">${roleLabel}</button>
      <span class="sync-state">${syncLabel}</span>
    </div>
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
  if(state.view==='week' && canEdit()) bindWeekDrag();
}

/* ── 주간뷰: 짧게 탭=수정 팝업 / 꾹 눌러=다른 요일로 이동 (편집 모드) ── */
let drag = null;
let pressTimer = null;
const EDGE_ZONE = 44, EDGE_HOLD_MS = 2000;
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
  let moved=false, started=false;
  const moveWatch = (me)=>{ if(Math.abs(me.clientX-sx)>10||Math.abs(me.clientY-sy)>10){ moved=true; clearTimeout(pressTimer); cleanup(); } };
  const upWatch = ()=>{ clearTimeout(pressTimer); cleanup(); if(!moved && !started){ openEditModal(chip.dataset.type, chip.dataset.id); } };
  function cleanup(){ document.removeEventListener('pointermove',moveWatch); document.removeEventListener('pointerup',upWatch); }
  document.addEventListener('pointermove', moveWatch);
  document.addEventListener('pointerup', upWatch, {once:true});
  pressTimer = setTimeout(()=>{
    if(moved) return;
    started = true; cleanup();
    startDrag(chip, e.clientX, e.clientY);
  }, 450);
}
function startDrag(chip, x, y){
  drag = { type:chip.dataset.type, id:chip.dataset.id, key:chip.dataset.key };
  chip.classList.add('dragging-src');
  const ghost = chip.cloneNode(true);
  ghost.classList.add('ghost-chip'); ghost.classList.remove('dragging-src');
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
    edgeEnterTime = performance.now();
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
  if(side !== edgeSide){ edgeSide = side; edgeEnterTime = side ? performance.now() : null; }
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
    if(targetKey && targetKey !== drag.key){ DB.update(drag.type, drag.id, {date:targetKey}); }
  }
  drag = null;
  render();
}

/* ── 부팅 ── */
function boot(){
  const cfg = window.FIREBASE_CONFIG;
  if(cfg && cfg.apiKey && cfg.projectId && typeof firebase !== 'undefined'){
    EVENTS={}; TODOS={}; render();   // 클라우드 데이터가 들어오기 전까지 빈 화면
    startCloud(cfg);
  } else {
    USE_CLOUD=false; loadLocal(); render();
  }
}
boot();
