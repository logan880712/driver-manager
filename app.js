'use strict';
// An overnight driving shift belongs to the evening it started, until 06:00 KST.
function workDate(at=new Date()){const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(at);const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(at));if(hour>=6)return date;const previous=new Date(date+'T00:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);return previous.toISOString().slice(0,10);}
const $ = id => document.getElementById(id);
const money = n => `${Math.round(n).toLocaleString('ko-KR')}원`;
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const defaults = () => ({ version: 2, goals: { daily: 100000, monthly: 2500000 }, workdays: [2,3,4,5], home: '군포역 근처', deadline: '03:00', skipDates: [], extraDates: [], diaries: [], rides: [] });
let state = defaults(), db, ready = false, saving = false;
let selectedPhotos=null, historyDateFilter='', draftTimer, draftGeneration=0, draftDirty=false;
const notify = (text,kind='info') => { $('notice').textContent=text;$('notice').dataset.kind=kind; };
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
  const date=workDate(), month=date.slice(0,7), items=records().filter(r=>r.date.startsWith(month));
  $('header-date').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',weekday:'short'}).format(new Date());
  $('home-month').textContent=`${date.slice(0,4)}년 ${Number(date.slice(5,7))}월`;
  const income=total(items), days=new Set(items.map(r=>r.date)).size, remaining=Math.max(0,state.goals.monthly-income);
  $('month-income').textContent=money(income);$('month-count').textContent=`${items.reduce((n,r)=>n+r.count,0)}건 운행`;
  $('remaining').textContent=money(remaining);$('target').textContent=money(state.goals.monthly);$('average-income').textContent=money(days?income/days:0);$('working-days').textContent=`${days}일 근무`;
  $('goal-percent').textContent=`${Math.max(0,Math.round(income/state.goals.monthly*100))}% 달성`;
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
  const extra=Math.max(0,Math.ceil(remaining/baseline)-planned),paceLabel=average>0?'지금까지의 평균':'하루 목표 가정';
  $('planned-days').textContent=`${planned}일`;$('short-target').textContent=money(remaining?shortGoal:0);$('long-target').textContent=long?money(longGoal):'예정일 없음';
  $('assistant-title').textContent=remaining?`목표까지 ${money(remaining)} 남았어요`:'이번 달 목표를 달성했어요!';
  $('assistant-feedback').textContent=remaining===0?'목표 달성을 축하해요! 남은 근무는 본업과 컨디션을 먼저 고려하세요.':planned===0?`남은 예정 근무일이 없어요. 하루 ${money(baseline)} 기준 약 ${Math.ceil(remaining/baseline)}일이 더 필요합니다. 설정에서 가능한 추가 날짜를 정해 보세요.`:long?`짧은 근무일 ${short}일에 ${money(shortGoal)}씩 벌면, 목·금 ${long}일에는 하루 ${money(longGoal)}이 필요해요. ${paceLabel} 기준 추가 근무는 약 ${extra}일입니다. 무리하면 예정일 목표를 낮추고 가능한 추가 날짜로 나누세요.`:`남은 ${planned}일에는 하루 ${money(Math.ceil(remaining/planned))}이 필요해요. ${paceLabel} 기준 추가 근무는 약 ${extra}일입니다.`;
  const latest=state.diaries.filter(d=>d.date.startsWith(month)).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(latest?.fatigue==='3')$('assistant-feedback').textContent+=' 최근 피로도가 높아요. 다음 근무를 줄이거나 쉬는 날을 먼저 반영해 주세요.';
  const tipTotal=state.diaries.filter(d=>d.date.startsWith(month)).reduce((n,d)=>n+d.tips,0);
  $('assistant-basis').textContent=`오늘~월말의 미기록 예정일 기준입니다. 이미 기록한 날은 완료로 계산합니다. 추가 근무 추정은 ${average>0?`${days}일 평균 ${money(average)}`:`기록이 부족해 하루 목표 ${money(shortGoal)}`} 기준이며 수입을 보장하지 않습니다. 팁 ${money(tipTotal)}은 실제 누적에 포함되지만 앞으로의 팁은 보장되지 않아요. 하루 일지가 있는 날짜의 개별 운행은 중복 합산하지 않습니다.`;
  renderLatest();
  renderHistory();
}
function textElement(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function showPhotos(container,photos){
  container.replaceChildren();
  photos.forEach((p,index)=>{const wrapper=document.createElement('div');wrapper.className='photo-thumb';const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',`사진 ${index+1} 원본 보기`);const img=document.createElement('img');img.src=p.data;img.alt=p.name;img.loading='lazy';button.append(img);button.onclick=()=>{$('photo-full').src=p.data;$('photo-dialog-label').textContent=`사진 ${index+1} · ${p.name}`;$('photo-dialog').showModal();};wrapper.append(button,textElement('span',`${index+1}`,'photo-number'));container.append(wrapper);});
  if(container.id==='photo-preview'){$('ocr-retry').hidden=!photos.length;$('remove-photos').hidden=!photos.length;}
}
$('photo-close').onclick=()=>{$('photo-dialog').close();$('photo-full').removeAttribute('src');};
function renderLatest(){const box=$('latest-diary');box.replaceChildren();const items=records().sort((a,b)=>b.date.localeCompare(a.date));if(!items.length){box.append(textElement('p','첫 근무를 기록해 보세요. 사진 한 장에서 시작할 수 있어요.','empty'));return;}const date=items[0].date,rows=items.filter(r=>r.date===date),d=rows[0].diary;const card=document.createElement('div');card.className='latest-record';const left=document.createElement('div');left.append(textElement('b',`${Number(date.slice(5,7))}월 ${Number(date.slice(8))}일 근무`),textElement('small',`${rows.reduce((n,r)=>n+r.count,0)}건 운행${d?` · ${d.start}~${d.end}`:''}`));card.append(left,textElement('strong',money(total(rows))));box.append(card);}
function renderCalendar(month,items){
  const box=$('history-calendar');box.replaceChildren();if(!/^\d{4}-\d{2}$/.test(month))return;
  for(const day of ['일','월','화','수','목','금','토'])box.append(textElement('span',day,'weekday'));
  const [year,m]=month.split('-').map(Number),first=new Date(Date.UTC(year,m-1,1)).getUTCDay(),last=new Date(Date.UTC(year,m,0)).getUTCDate();
  for(let i=0;i<first;i++)box.append(document.createElement('span'));
  for(let day=1;day<=last;day++){const date=`${month}-${String(day).padStart(2,'0')}`,rows=items.filter(r=>r.date===date),button=document.createElement('button');button.type='button';button.append(textElement('span',String(day)));button.setAttribute('aria-label',`${date}${rows.length?` 순수익 ${money(total(rows))}`:' 기록 없음'}`);button.setAttribute('aria-pressed',String(historyDateFilter===date));if(rows.length){button.classList.add('worked');button.append(textElement('small',`${(total(rows)/10000).toFixed(1)}만`));}if(date===today())button.classList.add('today');if(historyDateFilter===date)button.classList.add('selected');button.onclick=()=>{historyDateFilter=historyDateFilter===date?'':date;renderHistory();};box.append(button);}
  $('history-filter-clear').hidden=!historyDateFilter;
}
$('history-filter-clear').onclick=()=>{historyDateFilter='';renderHistory();};
function renderHistory(){
  const month=$('history-month').value, items=records().filter(r=>r.date.startsWith(month));
  renderCalendar(month,items);
  window.IncomeCharts?.render($('income-charts'),{month,records:items,monthlyGoal:state.goals.monthly,selectedDate:historyDateFilter,onSelectDate:date=>{historyDateFilter=historyDateFilter===date?'':date;renderHistory();}});
  $('history-date-action').hidden=!historyDateFilter;
  $('history-date-action').textContent=state.diaries.some(d=>d.date===historyDateFilter)?'선택한 날짜 일지 수정':'선택한 날짜 일지 쓰기';
  $('history-summary').textContent=`${new Set(items.map(r=>r.date)).size}일 · ${items.reduce((n,r)=>n+r.count,0)}건 · 순수익 ${money(total(items))}`;
  $('history').replaceChildren();
  const filtered=historyDateFilter?items.filter(r=>r.date===historyDateFilter):items;
  if(!filtered.length)$('history').append(textElement('p','아직 기록이 없어요. 하루 일지를 작성해 보세요.','empty'));
  const groups=new Map();for(const r of filtered){if(!groups.has(r.date))groups.set(r.date,[]);groups.get(r.date).push(r);}
  for(const [date,rows] of [...groups].sort((a,b)=>b[0].localeCompare(a[0]))){
    const card=document.createElement('article');card.className='diary-card';card.append(textElement('h3',`${date} · ${rows.reduce((n,r)=>n+r.count,0)}건`),textElement('strong',money(total(rows))));
    const d=rows[0].diary;
    if(d){const minutes=duration(d);card.append(textElement('p',`${d.start} 출근 → ${d.endDate===d.date?'당일':'다음 날'} ${d.end} 귀가 · ${Math.floor(minutes/60)}시간 ${minutes%60}분 · 시간당 ${money(diaryNet(d)/(minutes/60))}`));card.append(textElement('p',`운행 수익 ${money(d.income)} + 팁 ${money(d.tips)} − 교통비 ${money(d.transport)} − 기타 지출 ${money(d.expense)}`));if(d.memo)card.append(textElement('p',d.memo));
      if(d.photos.length){const photos=document.createElement('div');photos.className='photo-preview';showPhotos(photos,d.photos);card.append(photos);}
      const actions=document.createElement('div');actions.className='history-actions';const edit=textElement('button','수정','secondary');edit.onclick=()=>openDiaryForDate(d.date);const remove=textElement('button','삭제','delete');remove.onclick=async()=>{if(confirm('하루 일지를 삭제할까요? 같은 날짜의 기존 개별 운행이 있다면 다시 합산됩니다.')){if(await save({...state,diaries:state.diaries.filter(x=>x.date!==date)}))notify('일지를 삭제했습니다.');}};actions.append(edit,remove);card.append(actions);
    }else{card.append(textElement('p','이전 버전에서 저장한 개별 운행입니다. 하루 일지를 작성하면 해당 날짜의 합계로 대체됩니다.'));for(const r of rows)card.append(textElement('p',`${r.ride.from} → ${r.ride.to} · ${money(r.net)}`));}
    $('history').append(card);
  }
}
const diaryForm=$('diary-form');
let manualEndDate=false,dateExplicit=false,activeDiaryDate=workDate(),loadedDiaryDate='';
function nextDate(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function previousDate(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
function hasDiaryContent(){return ['start','end','memo'].some(k=>diaryForm.elements.namedItem(k).value)||['count','income','tips','transport','expense'].some(k=>Number(diaryForm.elements.namedItem(k).value))||!!selectedPhotos?.length||diaryForm.elements.fatigue.value!=='1'||manualEndDate;}
function hasUnstoredContent(){const saved=state.diaries.find(d=>d.date===activeDiaryDate);return hasDiaryContent()&&(!saved||draftFields.filter(k=>k!=='date').some(k=>diaryForm.elements.namedItem(k).value!==String(saved[k]))||(selectedPhotos!==null&&JSON.stringify(selectedPhotos)!==JSON.stringify(saved.photos)));}
function chooseWorkDate(){
  const date=$('diary-date').value;if(!validDate(date))return;
  const saved=state.diaries.find(d=>d.date===date);
  if(saved&&hasUnstoredContent()&&!confirm('이 날짜에 저장된 일지가 있습니다. 작성 중인 내용 대신 저장된 일지를 불러올까요?')){$('diary-date').value=activeDiaryDate;updatePreview();queueDraft();return;}
  dateExplicit=true;activeDiaryDate=date;
  if(saved)loadDiary(saved);else{manualEndDate=false;$('end-date').value=date;inferEndDate();updatePreview();}
  queueDraft();
}
function openDiaryForDate(date){
  if(!validDate(date))return;
  if(hasUnstoredContent()&&!confirm('작성 중인 내용을 비우고 선택한 날짜의 일지를 열까요? 저장된 일지는 유지됩니다.'))return;
  const saved=state.diaries.find(d=>d.date===date);
  if(saved)loadDiary(saved);else{resetDiary();$('diary-date').value=date;$('end-date').value=date;activeDiaryDate=date;dateExplicit=true;updatePreview();}
  queueDraft();view('diary');
}
$('history-date-action').onclick=()=>openDiaryForDate(historyDateFilter);
$('history-add').onclick=()=>{view('diary');$('diary-date').focus();notify('근무를 시작한 날짜를 먼저 선택해 주세요. 지난달 일지도 입력할 수 있어요.');};
for(const button of document.querySelectorAll('[data-work-date]'))button.onclick=()=>{$('diary-date').value=button.dataset.workDate==='previous'?previousDate(workDate()):workDate();chooseWorkDate();};
function inferEndDate(){const date=$('diary-date').value,start=diaryForm.elements.start.value,end=diaryForm.elements.end.value;if(!manualEndDate && validDate(date) && validTime(start) && validTime(end)){$('end-date').value=end<start?nextDate(date):date;$('date-hint').textContent=end<start?'새벽 귀가로 귀가 날짜를 다음 날로 맞췄습니다.':'당일 귀가로 계산합니다.';}}
for(const name of ['start','end'])diaryForm.elements.namedItem(name).addEventListener('input',inferEndDate);
$('end-date').addEventListener('input',()=>{manualEndDate=true;$('date-hint').textContent='선택한 귀가 날짜로 계산합니다.';});
function resetDiary(discardDraft=true){if(discardDraft)clearDraft();selectedPhotos=null;window.PhotoImport?.clear();manualEndDate=false;dateExplicit=false;loadedDiaryDate='';activeDiaryDate=workDate();$('date-hint').textContent='새벽 귀가는 시간을 입력하면 다음 날로 자동 계산합니다.';diaryForm.reset();$('diary-date').value=activeDiaryDate;$('end-date').value=today();$('photos').value='';showPhotos($('photo-preview'),[]);updatePreview();}
function loadDiary(d){clearDraft();selectedPhotos=d.photos;window.PhotoImport?.clear();manualEndDate=true;dateExplicit=true;activeDiaryDate=d.date;loadedDiaryDate=d.date;$('date-hint').textContent='저장된 귀가 날짜입니다.';for(const [key,value]of Object.entries(d)){const input=diaryForm.elements.namedItem(key);if(input && input.type!=='file')input.value=value;}$('photos').value='';showPhotos($('photo-preview'),d.photos);updatePreview();queueDraft();}
function updatePreview(){const v=Object.fromEntries(new FormData(diaryForm));if($('shift-date-label'))$('shift-date-label').textContent=validDate(v.date)?`근무일 ${Number(v.date.slice(5,7))}월 ${Number(v.date.slice(8))}일`:'근무 날짜를 선택해 주세요';const saved=state.diaries.some(d=>d.date===v.date);$('work-date-status').textContent=saved?'저장된 날짜예요. 저장하면 이 날짜의 일지를 수정합니다.':v.date<workDate()?'지난 근무를 기록해요. 선택한 날짜의 월 수익에 반영됩니다.':'저녁에 시작한 날짜를 선택하세요. 새벽 6시 전에는 전날이 기본이에요.';$('diary-preview').textContent=money(Number(v.income||0)+Number(v.tips||0)-Number(v.transport||0)-Number(v.expense||0));}
diaryForm.addEventListener('input',()=>{updatePreview();queueDraft();});
$('diary-date').addEventListener('change',chooseWorkDate);
$('reset-diary').onclick=()=>resetDiary();
async function readPhotos(files){if(files.length>5)throw Error('사진은 최대 5장까지 첨부할 수 있습니다.');return Promise.all([...files].map(file=>{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('사진은 JPG·PNG·WebP, 장당 5MB 이하로 선택하세요.');return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,data:reader.result});reader.onerror=()=>reject(Error('사진을 읽지 못했습니다.'));reader.readAsDataURL(file);});}));}
$('photos').addEventListener('change',async()=>{try{selectedPhotos=await readPhotos($('photos').files);showPhotos($('photo-preview'),selectedPhotos);queueDraft();}catch(e){$('photos').value='';notify(e.message);}});
diaryForm.addEventListener('submit',async event=>{event.preventDefault();if(window.PhotoImport?.busy){notify('사진 인식 중입니다. 완료를 기다리거나 인식 중단을 눌러 직접 입력해 주세요.');return;}inferEndDate();const values=Object.fromEntries(new FormData(diaryForm));const old=state.diaries.find(d=>d.date===values.date);try{const photos=selectedPhotos??old?.photos??[];const d={...values,photos};for(const key of ['count','income','tips','transport','expense'])d[key]=Number(d[key]);const issue=diaryError(d);if(issue){notify(issue.message,'error');const input=diaryForm.elements.namedItem(issue.field);input?.focus();input?.scrollIntoView({block:'center',behavior:'smooth'});return;}if(old&&loadedDiaryDate!==d.date&&!confirm('선택한 날짜에 이미 일지가 있습니다. 입력한 내용으로 이 날짜의 일지를 수정할까요?'))return;if(await save({...state,diaries:[...state.diaries.filter(x=>x.date!==d.date),d]})){const past=d.date<workDate();resetDiary();notify(`${Number(d.date.slice(5,7))}월 ${Number(d.date.slice(8))}일 일지를 저장했습니다.`);if(past){$('history-month').value=d.date.slice(0,7);historyDateFilter=d.date;renderHistory();view('history');}else view('home');}}catch(e){notify(e.message);}});
$('history-month').value=workDate().slice(0,7);$('history-month').onchange=()=>{historyDateFilter='';renderHistory();};
$('goal-form').onsubmit=async event=>{event.preventDefault();const dates=id=>$(id).value.split(',').map(v=>v.trim()).filter(Boolean);const skipDates=dates('skip-dates'),extraDates=dates('extra-dates');if(![...skipDates,...extraDates].every(validDate)){notify('날짜는 2026-10-13 같은 형식으로 쉼표로 구분해 주세요.');return;}if(await save({...state,goals:{daily:Number($('daily-goal').value),monthly:Number($('monthly-goal').value)},workdays:[...document.querySelectorAll('[name=workday]:checked')].map(i=>Number(i.value)),home:$('home-location').value.trim(),deadline:$('deadline').value,skipDates,extraDates}))notify('목표와 근무 계획을 저장했습니다.');};
$('export').onclick=()=>{if(!ready){notify('저장소를 먼저 확인해 주세요.');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(state)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`대리일지-${today()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('사진을 포함한 백업 파일을 내려받았습니다. 안전한 곳에 보관하세요.');};
$('import').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>100*1024*1024)throw Error('백업 파일은 100MB 이하만 지원합니다.');const data=migrate(JSON.parse(await file.text()));if(confirm('현재 기록·사진·설정을 백업 내용으로 교체할까요? 먼저 현재 기록을 백업해 주세요.')){if(await save(data)){resetDiary();notify('백업을 복원했습니다.');}}}catch(e){notify('백업을 읽지 못했습니다. 올바른 파일과 용량을 확인해 주세요. 기존 기록은 유지됩니다.');}finally{event.target.value='';}};
const draftFields=['date','start','end','endDate','count','income','tips','transport','expense','fatigue','memo'];
function clearDraft(){draftDirty=false;clearTimeout(draftTimer);draftTimer=undefined;draftGeneration++;try{localStorage.removeItem('driver-diary-draft-v1');}catch{}if(db&&ready){const tx=db.transaction('data','readwrite');tx.objectStore('data').delete('draft');}$('draft-status').textContent='작성 중인 내용은 이 기기에 임시 보관됩니다.';}
function queueDraft(){draftDirty=true;clearTimeout(draftTimer);const generation=draftGeneration;try{localStorage.setItem('driver-diary-draft-v1',JSON.stringify({version:1,values:Object.fromEntries(draftFields.map(k=>[k,diaryForm.elements.namedItem(k).value])),manualEndDate,dateExplicit,updatedAt:Date.now()}));}catch{}$('draft-status').textContent='임시 보관 중…';draftTimer=setTimeout(()=>writeDraft(generation),600);}
function writeDraft(generation){
  if(!ready||generation!==draftGeneration)return Promise.resolve(false);
  const values=Object.fromEntries(draftFields.map(k=>[k,diaryForm.elements.namedItem(k).value]));
  const photos=selectedPhotos??state.diaries.find(d=>d.date===values.date)?.photos??[];
  return new Promise(resolve=>{try{const tx=db.transaction('data','readwrite');tx.objectStore('data').put({version:1,values,photos,manualEndDate,dateExplicit,updatedAt:Date.now()},'draft');tx.oncomplete=()=>{if(generation===draftGeneration)$('draft-status').textContent='작성 내용 임시 보관됨 · 정식 저장은 아래 버튼';resolve(true);};tx.onerror=tx.onabort=()=>{$('draft-status').textContent='임시 보관에 실패했습니다. 일지 저장을 눌러 주세요.';resolve(false);};}catch{$('draft-status').textContent='임시 보관에 실패했습니다. 일지 저장을 눌러 주세요.';resolve(false);}});
}
async function restoreDraft(){
  const draft=await new Promise((resolve,reject)=>{const request=db.transaction('data','readonly').objectStore('data').get('draft');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  let recent;try{recent=JSON.parse(localStorage.getItem('driver-diary-draft-v1'));}catch{}
  const valid=d=>d&&d.version===1&&d.values&&draftFields.every(k=>typeof d.values[k]==='string'&&d.values[k].length<=1000);
  const source=valid(recent)&&(!valid(draft)||recent.updatedAt>=draft.updatedAt)?recent:valid(draft)?draft:null;
  if(!source)return;draftDirty=true;
  for(const k of draftFields)diaryForm.elements.namedItem(k).value=source.values[k];
  const photos=Array.isArray(draft?.photos)&&draft.photos.length<=5?draft.photos:[];
  selectedPhotos=photos.filter(p=>p&&typeof p.name==='string'&&p.name.length<=255&&typeof p.data==='string'&&p.data.length<=7100000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.data));
  if(!source.dateExplicit&&!source.values.count&&!source.values.income&&!source.values.start&&!source.values.end&&!source.values.memo&&!selectedPhotos.length&&['tips','transport','expense'].every(k=>!Number(source.values[k]))&&source.values.fatigue==='1'){$('diary-date').value=workDate();$('end-date').value=today();}
  manualEndDate=!!source.manualEndDate;dateExplicit=!!source.dateExplicit;activeDiaryDate=$('diary-date').value;showPhotos($('photo-preview'),selectedPhotos);updatePreview();$('draft-status').textContent='이전에 작성하던 내용을 복원했어요.';
}
$('remove-photos').onclick=()=>{window.PhotoImport?.clear();selectedPhotos=[];$('photos').value='';showPhotos($('photo-preview'),[]);queueDraft();};
$('ocr-retry').onclick=()=>window.PhotoImport?.scan(selectedPhotos??state.diaries.find(d=>d.date===$('diary-date').value)?.photos??[]);
window.addEventListener('pagehide',()=>{if(draftTimer){clearTimeout(draftTimer);writeDraft(draftGeneration);}});
$('check-update').onclick=async()=>{
  const button=$('check-update');button.disabled=true;
  try{if(window.PhotoImport?.busy){notify('사진 인식이 끝난 뒤 업데이트를 확인해 주세요.');return;}
    if(draftDirty){clearTimeout(draftTimer);if(!await writeDraft(draftGeneration)){notify('작성 내용을 보관하지 못해 새로고침하지 않았습니다. 먼저 일지를 저장해 주세요.');return;}}
    if(!navigator.onLine){notify('업데이트 확인은 인터넷에 연결한 뒤 이용해 주세요.');return;}
    const registration=await navigator.serviceWorker.getRegistration();if(registration)await registration.update();location.reload();
  }catch{notify('업데이트를 확인하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.');}finally{button.disabled=false;}
};
let installPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('install').hidden=true;}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>notify('오프라인 기능을 시작하지 못했습니다. HTTPS 접속 여부를 확인하세요.'));
async function init(){try{db=await new Promise((resolve,reject)=>{const request=indexedDB.open('driver-diary',1);request.onupgradeneeded=()=>request.result.createObjectStore('data');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('blocked'));});const saved=await new Promise((resolve,reject)=>{const tx=db.transaction('data','readonly'),request=tx.objectStore('data').get('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});if(saved)state=migrate(saved);else{const old=localStorage.getItem('driver-manager-v1');state=old?migrate(JSON.parse(old)):defaults();await writeState(state);}await restoreDraft().catch(()=>{$('draft-status').textContent='작성 중인 내용을 복원하지 못했지만 저장된 일지는 유지됩니다.';});ready=true;render();}catch{notify('저장소를 읽을 수 없어 저장을 중단했습니다. 기존 데이터는 덮어쓰지 않았습니다. 브라우저 저장 설정을 확인하세요.');}}
// Holiday shortcut: uses the existing skipDates setting and IndexedDB save path.
// Daily encouragement is local-only; it never changes saved diaries or settings.
const hopeQuotes=[
'오늘의 작은 걸음이 내일의 큰 힘이 됩니다.',
'서두르지 않아도 괜찮아요. 꾸준함이 길을 만듭니다.',
'안전하게 돌아오는 하루가 가장 값진 성과입니다.',
'어제보다 한 걸음 나아간 오늘이면 충분합니다.',
'힘든 밤이 지나면 새로운 아침이 찾아옵니다.',
'작은 노력들이 모여 큰 변화를 만듭니다.',
'오늘도 스스로에게 따뜻한 응원을 보내세요.'
];
function showDailyHope(){
  const date=today(),index=Math.floor(Date.parse(date+'T00:00:00Z')/86400000)%hopeQuotes.length;
  $('hope-quote').textContent=hopeQuotes[index];
}
showDailyHope();
const holidayButton=$('holiday-toggle');
function refreshHolidayButton(){
  const date=workDate(),isOff=state.skipDates.includes(date);
  holidayButton.textContent=isOff?'휴무 취소':'오늘 휴무 설정';
  holidayButton.setAttribute('aria-pressed',String(isOff));
  holidayButton.classList.toggle('is-off',isOff);
  $('holiday-description').textContent=isOff?'오늘은 휴무로 설정됐어요. 푹 쉬세요.':'휴무를 설정하면 남은 근무 목표에 반영돼요.';
}
holidayButton.addEventListener('click',async()=>{
  if(!ready){notify('저장소를 확인하는 중입니다. 잠시 후 다시 눌러 주세요.');return;}
  if(saving)return;
  const date=workDate(),isOff=state.skipDates.includes(date);
  holidayButton.disabled=true;
  try{
    const skipDates=isOff?state.skipDates.filter(d=>d!==date):[...state.skipDates,date];
    if(await save({...state,skipDates})){refreshHolidayButton();notify(isOff?'오늘 휴무를 취소했습니다.':'오늘을 휴무로 설정했습니다. 푹 쉬세요!');}
  }finally{holidayButton.disabled=false;}
});
const originalRender=render;
render=function(){originalRender();refreshHolidayButton();};
resetDiary(false);render();init();
