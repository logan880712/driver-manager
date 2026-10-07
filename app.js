'use strict';
const $ = id => document.getElementById(id);
const money = n => `${Math.round(n).toLocaleString('ko-KR')}원`;
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const defaults = () => ({ version: 2, goals: { daily: 100000, monthly: 2500000 }, workdays: [2,3,4,5], home: '군포역 근처', deadline: '03:00', skipDates: [], extraDates: [], diaries: [], rides: [] });
let state = defaults(), db, ready = false, saving = false;
const notify = text => { $('notice').textContent = text; };
const amount = n => Number.isSafeInteger(n) && n >= 0 && n <= 100000000;
function validDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(value+'T00:00:00Z'); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value; }
const validTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const duration = d => (new Date(`${d.endDate}T${d.end}:00Z`) - new Date(`${d.date}T${d.start}:00Z`)) / 60000;
function diaryError(d) {
  if (!validDate(d.date)) return { field:'date', message:'근무 시작 날짜를 확인해 주세요.' };
  if (!validDate(d.endDate)) return { field:'endDate', message:'귀가한 날짜를 확인해 주세요.' };
  if (!validTime(d.start)) return { field:'start', message:'출근 시간을 확인해 주세요.' };
  if (!validTime(d.end)) return { field:'end', message:'귀가 시간을 확인해 주세요.' };
  if (duration(d) <= 0) return { field:'endDate', message:'귀가가 출근보다 빠르거나 같습니다. 새벽에 귀가했다면 귀가한 날짜를 다음 날로 선택해 주세요.' };
  if (duration(d) > 1440) return { field:'endDate', message:'근무시간이 24시간을 넘습니다. 근무 시작 날짜와 귀가한 날짜를 확인해 주세요.' };
  if (!Number.isInteger(d.count) || d.count < 0 || d.count > 1000) return { field:'count', message:'운행 건수는 0~1,000 사이의 정수로 입력해 주세요.' };
  const labels={income:'운행 수익',tips:'추가 팁',transport:'택시·교통비',expense:'기타 지출'};
  for (const [field,label] of Object.entries(labels)) if (!amount(d[field])) return { field, message:`${label}은 0~1억 원 사이의 정수로 입력해 주세요.` };
  if (!['1','2','3'].includes(d.fatigue)) return { field:'fatigue', message:'피로도를 선택해 주세요.' };
  if (typeof d.memo !== 'string' || d.memo.length > 1000) return { field:'memo', message:'메모는 1,000자 이내로 입력해 주세요.' };
  if (!Array.isArray(d.photos) || d.photos.length>5 || d.photos.some(p=>!p || typeof p.name!=='string' || p.name.length>255 || typeof p.data!=='string' || p.data.length>7100000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.data))) return { field:'photos', message:'첨부 사진을 확인해 주세요. JPG·PNG·WebP, 최대 5장, 장당 5MB까지 지원합니다.' };
  return null;
}
function validState(s) {
  return s && s.version === 2 && s.goals && amount(s.goals.daily) && s.goals.daily > 0 && amount(s.goals.monthly) && s.goals.monthly > 0
    && Array.isArray(s.workdays) && new Set(s.workdays).size === s.workdays.length && s.workdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6)
    && typeof s.home === 'string' && s.home.trim().length > 0 && s.home.length <= 80 && validTime(s.deadline)
    && ['skipDates','extraDates'].every(k=>Array.isArray(s[k])&&s[k].length<=1000&&s[k].every(validDate))
    && Array.isArray(s.diaries) && s.diaries.length <= 10000 && new Set(s.diaries.map(d=>d.date)).size === s.diaries.length
    && s.diaries.every(d=>d && !diaryError(d))
    && Array.isArray(s.rides) && s.rides.length<=100000 && new Set(s.rides.map(r=>r.id)).size===s.rides.length && s.rides.every(r=>r && typeof r.id==='string' && validDate(r.date) && ['fare','fee','expense'].every(k=>amount(r[k])) && r.fare>0 && ['from','to'].every(k=>typeof r[k]==='string' && r[k].length<=80) && typeof r.memo==='string' && r.memo.length<=200);
}
function migrate(s) {
  if (s?.version === 1) s = {...defaults(), ...s, version:2, workdays:s.workdays??[2,3,4,5]};
  if (!validState(s)) throw Error('Invalid data');
  return s;
}
function writeState(next) {
  return new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put(next,'state');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
async function save(next) {
  if (!ready || saving) { notify('저장소 준비 중이거나 다른 저장이 진행 중입니다. 잠시 뒤 다시 시도하세요.'); return false; }
  if (!validState(next)) { notify('입력한 날짜, 시간, 금액을 확인해 주세요. 근무시간은 0시간 초과~24시간 이하로 입력하세요.'); return false; }
  saving=true;
  try { await writeState(next);state=next;render();return true; }
  catch { notify('저장하지 못했습니다. 기기 저장 공간과 브라우저 설정을 확인해 주세요. 입력 내용은 유지됩니다.');return false; }
  finally { saving=false; }
}
const diaryNet = d => d.income+d.tips-d.transport-d.expense;
function records() {
  const dates = new Set(state.diaries.map(d=>d.date));
  return [...state.diaries.map(d=>({date:d.date,net:diaryNet(d),count:d.count,diary:d})), ...state.rides.filter(r=>!dates.has(r.date)).map(r=>({date:r.date,net:r.fare-r.fee-r.expense,count:1,ride:r}))];
}
const total = items => items.reduce((n,r)=>n+r.net,0);
function view(name) {
  document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==`view-${name}`);
  document.querySelectorAll('.bottom-nav button').forEach(b=>{if(b.dataset.view===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  window.scrollTo({top:0});
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
function render() {
  const date=today(), month=date.slice(0,7), items=records().filter(r=>r.date.startsWith(month));
  const income=total(items), days=new Set(items.map(r=>r.date)).size, remaining=Math.max(0,state.goals.monthly-income);
  $('month-income').textContent=money(income);$('month-count').textContent=`${items.reduce((n,r)=>n+r.count,0)}건 운행`;
  $('remaining').textContent=money(remaining);$('target').textContent=money(state.goals.monthly);$('average-income').textContent=money(days?income/days:0);$('working-days').textContent=`${days}일 근무`;
  $('monthly-progress').value=Math.max(0,Math.min(100,income/state.goals.monthly*100));
  $('monthly-goal').value=state.goals.monthly;$('daily-goal').value=state.goals.daily;$('deadline').value=state.deadline;$('home-location').value=state.home;
  $('skip-dates').value=state.skipDates.join(', ');$('extra-dates').value=state.extraDates.join(', ');
  document.querySelectorAll('[name=workday]').forEach(i=>i.checked=state.workdays.includes(Number(i.value)));
  $('home-reminder').textContent=`${state.home}에 ${state.deadline} 전 도착을 우선해요. 마지막 콜은 운행시간 + 귀가시간 + 여유 30분을 고려하세요.`;
  const calendar=new Date(date+'T00:00:00Z'), currentMonth=calendar.getUTCMonth();let short=0,long=0;
  const worked=new Set(items.map(r=>r.date));
  // Include today if no earnings were recorded; never count an already completed day twice.
  while(calendar.getUTCMonth()===currentMonth){const key=calendar.toISOString().slice(0,10), day=calendar.getUTCDay();if(!worked.has(key)&&!state.skipDates.includes(key)&&(state.workdays.includes(day)||state.extraDates.includes(key))){if(day===4||day===5)long++;else short++;}calendar.setUTCDate(calendar.getUTCDate()+1);}
  const planned=short+long, shortGoal=state.goals.daily;
  const longGoal=long?Math.max(0,Math.ceil((remaining-short*shortGoal)/long)):0;
  const average=days?income/days:0, baseline=average>0?average:shortGoal;
  const extra=Math.max(0,Math.ceil(remaining/baseline)-planned);
  $('planned-days').textContent=`${planned}일`;$('short-target').textContent=money(remaining?shortGoal:0);$('long-target').textContent=long?money(longGoal):'예정일 없음';
  $('assistant-title').textContent=remaining?`목표까지 ${money(remaining)} 남았어요`:'이번 달 목표를 달성했어요!';
  $('assistant-feedback').textContent=remaining===0?'목표 달성을 축하해요! 남은 근무는 본업과 컨디션을 먼저 고려하세요.':planned===0?`남은 예정 근무일이 없어요. 하루 ${money(baseline)} 기준 약 ${Math.ceil(remaining/baseline)}일이 더 필요합니다. 설정에서 가능한 추가 날짜를 정해 보세요.`:long?`짧은 근무일 ${short}일에 ${money(shortGoal)}씩 벌면, 목·금 ${long}일에는 하루 ${money(longGoal)}이 필요해요. 현재 평균 기준 추가 근무는 약 ${extra}일입니다. 무리하면 예정일 목표를 낮추고 가능한 추가 날짜로 나누세요.`:`남은 ${planned}일에는 하루 ${money(Math.ceil(remaining/planned))}이 필요해요. 현재 평균 기준 추가 근무는 약 ${extra}일입니다.`;
  const latest=state.diaries.filter(d=>d.date.startsWith(month)).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(latest?.fatigue==='3')$('assistant-feedback').textContent+=' 최근 피로도가 높아요. 다음 근무를 줄이거나 쉬는 날을 먼저 반영해 주세요.';
  const tipTotal=state.diaries.filter(d=>d.date.startsWith(month)).reduce((n,d)=>n+d.tips,0);
  $('assistant-basis').textContent=`오늘~월말의 미기록 예정일 기준입니다. 이미 기록한 날은 완료로 계산합니다. 추가 근무 추정은 ${average>0?`${days}일 평균 ${money(average)}`:`기록이 부족해 하루 목표 ${money(shortGoal)}`} 기준이며 수입을 보장하지 않습니다. 팁 ${money(tipTotal)}은 실제 누적에 포함되지만 앞으로의 팁은 보장되지 않아요. 하루 일지가 있는 날짜의 개별 운행은 중복 합산하지 않습니다.`;
  renderHistory();
}
function textElement(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function showPhotos(container,photos){container.replaceChildren();for(const p of photos){const img=document.createElement('img');img.src=p.data;img.alt=p.name;img.loading='lazy';container.append(img);}}
function renderHistory(){
  const month=$('history-month').value, items=records().filter(r=>r.date.startsWith(month));
  $('history-summary').textContent=`${new Set(items.map(r=>r.date)).size}일 · ${items.reduce((n,r)=>n+r.count,0)}건 · 순수익 ${money(total(items))}`;
  $('history').replaceChildren();
  if(!items.length)$('history').append(textElement('p','아직 기록이 없어요. 하루 일지를 작성해 보세요.','empty'));
  const groups=new Map();for(const r of items){if(!groups.has(r.date))groups.set(r.date,[]);groups.get(r.date).push(r);}
  for(const [date,rows] of [...groups].sort((a,b)=>b[0].localeCompare(a[0]))){
    const card=document.createElement('article');card.className='diary-card';card.append(textElement('h3',`${date} · ${rows.reduce((n,r)=>n+r.count,0)}건`),textElement('strong',money(total(rows))));
    const d=rows[0].diary;
    if(d){const minutes=duration(d);card.append(textElement('p',`${d.start} 출근 → ${d.endDate===d.date?'당일':'다음 날'} ${d.end} 귀가 · ${Math.floor(minutes/60)}시간 ${minutes%60}분 · 시간당 ${money(diaryNet(d)/(minutes/60))}`));card.append(textElement('p',`운행 수익 ${money(d.income)} + 팁 ${money(d.tips)} − 교통비 ${money(d.transport)} − 기타 지출 ${money(d.expense)}`));if(d.memo)card.append(textElement('p',d.memo));
      if(d.photos.length){const photos=document.createElement('div');photos.className='photo-preview';showPhotos(photos,d.photos);card.append(photos);}
      const actions=document.createElement('div');actions.className='history-actions';const edit=textElement('button','수정','secondary');edit.onclick=()=>{loadDiary(d);view('diary');};const remove=textElement('button','삭제','delete');remove.onclick=async()=>{if(confirm('하루 일지를 삭제할까요? 같은 날짜의 기존 개별 운행이 있다면 다시 합산됩니다.')){if(await save({...state,diaries:state.diaries.filter(x=>x.date!==date)}))notify('일지를 삭제했습니다.');}};actions.append(edit,remove);card.append(actions);
    }else{card.append(textElement('p','이전 버전에서 저장한 개별 운행입니다. 하루 일지를 작성하면 해당 날짜의 합계로 대체됩니다.'));for(const r of rows)card.append(textElement('p',`${r.ride.from} → ${r.ride.to} · ${money(r.net)}`));}
    $('history').append(card);
  }
}
const diaryForm=$('diary-form');
let manualEndDate=false;
function nextDate(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function inferEndDate(){const date=$('diary-date').value,start=diaryForm.elements.start.value,end=diaryForm.elements.end.value;if(!manualEndDate && validDate(date) && validTime(start) && validTime(end)){$('end-date').value=end<start?nextDate(date):date;$('date-hint').textContent=end<start?'새벽 귀가로 귀가 날짜를 다음 날로 맞췄습니다.':'당일 귀가로 계산합니다.';}}
for(const name of ['start','end'])diaryForm.elements.namedItem(name).addEventListener('input',inferEndDate);
$('end-date').addEventListener('input',()=>{manualEndDate=true;$('date-hint').textContent='선택한 귀가 날짜로 계산합니다.';});
function resetDiary(){manualEndDate=false;$('date-hint').textContent='새벽 귀가는 시간을 입력하면 다음 날로 자동 계산합니다.';diaryForm.reset();$('diary-date').value=today();$('end-date').value=today();$('photos').value='';$('photo-preview').replaceChildren();updatePreview();}
function loadDiary(d){manualEndDate=true;$('date-hint').textContent='저장된 귀가 날짜입니다.';for(const [key,value]of Object.entries(d)){const input=diaryForm.elements.namedItem(key);if(input && input.type!=='file')input.value=value;}$('photos').value='';showPhotos($('photo-preview'),d.photos);updatePreview();}
function updatePreview(){const v=Object.fromEntries(new FormData(diaryForm));$('diary-preview').textContent=`순수익 ${money(Number(v.income||0)+Number(v.tips||0)-Number(v.transport||0)-Number(v.expense||0))}`;}
diaryForm.addEventListener('input',updatePreview);
$('diary-date').addEventListener('change',()=>{const d=state.diaries.find(d=>d.date===$('diary-date').value);if(d)loadDiary(d);else{manualEndDate=false;$('end-date').value=$('diary-date').value;inferEndDate();}});
$('reset-diary').onclick=resetDiary;
async function readPhotos(files){if(files.length>5)throw Error('사진은 최대 5장까지 첨부할 수 있습니다.');return Promise.all([...files].map(file=>{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('사진은 JPG·PNG·WebP, 장당 5MB 이하로 선택하세요.');return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,data:reader.result});reader.onerror=()=>reject(Error('사진을 읽지 못했습니다.'));reader.readAsDataURL(file);});}));}
$('photos').addEventListener('change',async()=>{try{showPhotos($('photo-preview'),await readPhotos($('photos').files));}catch(e){$('photos').value='';notify(e.message);}});
diaryForm.addEventListener('submit',async event=>{event.preventDefault();inferEndDate();const values=Object.fromEntries(new FormData(diaryForm));const old=state.diaries.find(d=>d.date===values.date);try{const photos=$('photos').files.length?await readPhotos($('photos').files):old?.photos??[];const d={...values,photos};for(const key of ['count','income','tips','transport','expense'])d[key]=Number(d[key]);const issue=diaryError(d);if(issue){notify(issue.message);const input=diaryForm.elements.namedItem(issue.field);input?.focus();input?.scrollIntoView({block:'center',behavior:'smooth'});return;}if(await save({...state,diaries:[...state.diaries.filter(x=>x.date!==d.date),d]})){resetDiary();notify('하루 일지를 저장했습니다. 목표 피드백을 확인해 보세요.');view('home');}}catch(e){notify(e.message);}});
$('history-month').value=today().slice(0,7);$('history-month').onchange=renderHistory;
$('goal-form').onsubmit=async event=>{event.preventDefault();const dates=id=>$(id).value.split(',').map(v=>v.trim()).filter(Boolean);const skipDates=dates('skip-dates'),extraDates=dates('extra-dates');if(![...skipDates,...extraDates].every(validDate)){notify('날짜는 2026-10-13 같은 형식으로 쉼표로 구분해 주세요.');return;}if(await save({...state,goals:{daily:Number($('daily-goal').value),monthly:Number($('monthly-goal').value)},workdays:[...document.querySelectorAll('[name=workday]:checked')].map(i=>Number(i.value)),home:$('home-location').value.trim(),deadline:$('deadline').value,skipDates,extraDates}))notify('목표와 근무 계획을 저장했습니다.');};
$('export').onclick=()=>{if(!ready){notify('저장소를 먼저 확인해 주세요.');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(state)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`대리일지-${today()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('사진을 포함한 백업 파일을 내려받았습니다. 안전한 곳에 보관하세요.');};
$('import').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>100*1024*1024)throw Error('백업 파일은 100MB 이하만 지원합니다.');const data=migrate(JSON.parse(await file.text()));if(confirm('현재 기록·사진·설정을 백업 내용으로 교체할까요? 먼저 현재 기록을 백업해 주세요.')){if(await save(data)){resetDiary();notify('백업을 복원했습니다.');}}}catch(e){notify('백업을 읽지 못했습니다. 올바른 파일과 용량을 확인해 주세요. 기존 기록은 유지됩니다.');}finally{event.target.value='';}};
let installPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').hidden=true;}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>notify('오프라인 기능을 시작하지 못했습니다. HTTPS 접속 여부를 확인하세요.'));
async function init(){try{db=await new Promise((resolve,reject)=>{const request=indexedDB.open('driver-diary',1);request.onupgradeneeded=()=>request.result.createObjectStore('data');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('blocked'));});const saved=await new Promise((resolve,reject)=>{const tx=db.transaction('data','readonly'),request=tx.objectStore('data').get('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});if(saved)state=migrate(saved);else{const old=localStorage.getItem('driver-manager-v1');state=old?migrate(JSON.parse(old)):defaults();await writeState(state);}ready=true;render();}catch{notify('저장소를 읽을 수 없어 저장을 중단했습니다. 기존 데이터는 덮어쓰지 않았습니다. 브라우저 저장 설정을 확인하세요.');}}
resetDiary();render();init();
