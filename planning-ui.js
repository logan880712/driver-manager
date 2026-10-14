'use strict';
let planSelection=null,planSignature='',visiblePlan;
function planningPreferences(){return {weekdays:[...document.querySelectorAll('[name=extra-weekday]:checked')].map(i=>Number(i.value)),perWeek:Number($('plan-per-week').value),longLimit:Number($('plan-long-limit').value),extraIncome:Number($('plan-extra-income').value)};}
function planningControls(p){$('plan-long-limit').value=p.longLimit;$('plan-extra-income').value=p.extraIncome;$('plan-per-week').value=p.perWeek;document.querySelectorAll('[name=extra-weekday]').forEach(i=>i.checked=p.weekdays.includes(Number(i.value)));}
function renderPlanning(){
  const base=SchedulePlanner.calculate(state,records(),workDate());
  const signature=JSON.stringify([workDate(),state.goals,state.workdays,state.skipDates,state.extraDates,records().filter(r=>r.date.startsWith(base.month)).map(r=>[r.date,r.net]),base.prefs]);
  if(signature!==planSignature){planSignature=signature;planSelection=base.recommended.map(d=>d.date);planningControls(base.prefs);}
  const model=SchedulePlanner.calculate(state,records(),workDate(),base.prefs,planSelection);visiblePlan=model;
  $('plan-forecast').textContent=money(model.forecast);
  $('plan-forecast-basis').textContent=model.sampleDays?`${model.sampleDays}일 기록 기준 · 하루 평균 ${money(model.average)}`:`기록이 없어 하루 목표 ${money(state.goals.daily)}을 가정해요`;
  $('plan-preview-forecast').textContent=model.recommended.length?`선택한 추가 ${model.recommended.length}일 포함 예상 ${money(model.previewForecast)} · 목표까지 예상 부족 ${money(Math.max(0,state.goals.monthly-model.previewForecast))}`:'추가 날짜를 고르면 예상 수익도 함께 비교해요.';
  $('plan-before').textContent=$('long-target').textContent;
  $('plan-after').textContent=model.long||model.recommended.some(d=>d.long)?money(model.adjustedLong):'목·금 없음';
  $('plan-extra-count').textContent=`${model.recommended.length}일`;
  $('plan-result').textContent=model.remaining===0?'목표를 달성했어요. 추가 근무보다 컨디션을 먼저 생각해 주세요.':model.uncovered?`선택한 추가 근무로도 목·금 ${money(model.prefs.longLimit)} 목표 기준 ${money(model.uncovered)}이 부족해요. 가능한 요일·횟수를 늘리거나 월 목표를 다시 검토해 주세요.`:model.recommended.length?`추가 근무 ${model.recommended.length}일로 필요한 목표를 나눴어요. 아래 날짜별 목표를 벌어야 월 목표에 도달하며, 실제 평균대로의 예상과는 다릅니다.`:'필요한 목·금 목표가 설정한 범위 안에 있어요. 실제 수익 흐름은 위의 예상과 비교해 주세요.';
  $('plan-pace').textContent=model.sampleDays?`현재 수익 흐름에서는 ${model.forecastGap?`${money(model.forecastGap)}이 부족할 것으로 예상돼요.${model.additionalByAverage!==null?` 평균 기준 추가 약 ${model.additionalByAverage}일이 필요해요.`:' 양수의 평균 수익이 없어 추가일을 추정하기 어려워요.'}`:'월 목표 달성을 예상해요.'} 아래 목표 배분과 실제 평균에 따른 예상은 다를 수 있어요.`:'일지를 쌓으면 실제 평균으로 예상 수익과 추가 근무일을 계산해 드려요.';
  const dates=$('plan-date-options');dates.replaceChildren();
  if(!model.candidates.length)dates.append(textElement('p','선택한 요일에서 추가할 날짜가 없어요. 휴무일과 이미 기록한 날은 제외합니다.','help'));
  for(const d of model.candidates){const label=document.createElement('label');label.className='plan-date-option';const input=document.createElement('input');input.type='checkbox';input.value=d.date;input.checked=model.recommended.some(r=>r.date===d.date);input.setAttribute('aria-label',`${d.date} 추가 근무 선택`);input.onchange=()=>{const next=input.checked?[...planSelection,d.date]:planSelection.filter(date=>date!==d.date);const check=SchedulePlanner.calculate(state,records(),workDate(),model.prefs,next);if(check.recommended.length!==new Set(next).size){notify(`같은 주에는 추가 근무를 ${model.prefs.perWeek}일까지 선택할 수 있어요. 횟수 설정을 먼저 바꿔 주세요.`);input.checked=!input.checked;return;}planSelection=next;renderPlanning();};label.append(input,textElement('span',SchedulePlanner.label(d.date)),textElement('small',money(d.long?model.prefs.longLimit:model.prefs.extraIncome)));dates.append(label);}
  const table=$('plan-schedule');table.replaceChildren();
  if(!model.schedule.length)table.append(textElement('p','남은 근무 일정이 없어요. 가능한 추가 요일을 골라 주세요.','help'));
  for(const d of model.schedule){const row=textElement('div','','schedule-row');row.append(textElement('b',SchedulePlanner.label(d.date)),textElement('span',d.source==='recommended'?'추가 추천':d.source==='extra'?'추가 근무':d.long?'목·금 근무':'짧은 근무'),textElement('strong',money(d.target)));if(d.source==='recommended')row.classList.add('recommended');table.append(row);}
  $('plan-apply').disabled=!ready||!model.recommended.length;
  $('plan-apply').textContent=model.recommended.length?`선택한 ${model.recommended.length}일을 근무일에 추가`:'추가할 날짜를 선택해 주세요';
  renderConsultation();
}
$('planning-form').onsubmit=async event=>{event.preventDefault();const prefs=planningPreferences();if(!SchedulePlanner.validPreferences(prefs)){notify('목표 금액과 추가 가능한 요일·횟수를 확인해 주세요.');return;}if(await save({...state,planPreferences:prefs}))notify('추천 조건을 저장하고 일정을 다시 계산했어요. 날짜 추가는 아래 버튼으로 적용해 주세요.');};
$('plan-use-average').onclick=()=>{const model=SchedulePlanner.calculate(state,records(),workDate());if(model.average<=0){notify('양수의 평균 수익이 아직 없어 직접 목표를 입력해 주세요.');return;}$('plan-extra-income').value=Math.max(1000,Math.round(model.average/1000)*1000);notify('실제 평균을 입력했어요. 추천 일정 다시 계산을 눌러 적용해 주세요.');};
$('plan-apply').onclick=async()=>{const model=SchedulePlanner.calculate(state,records(),workDate(),undefined,planSelection);if(!model.recommended.length)return;if(await save({...state,extraDates:[...new Set([...state.extraDates,...model.recommended.map(d=>d.date)])].sort()}))notify(`${model.recommended.length}일을 추가했어요. 기존 일지·수익은 그대로예요.`);};
function renderConsultation(){
  const box=$('consultation-messages');box.replaceChildren();
  const messages=state.consultation||[];
  if(!messages.length)box.append(textElement('p','김정업 기사님, 저장된 일지로 목표를 함께 계산해요. “토요일에 더 일하면 어떨까요?”처럼 물어보세요. 답변만으로 일정이 바뀌지는 않아요.','chat-message assistant-message'));
  for(const message of messages){const bubble=textElement('p',message.text,`chat-message ${message.role==='user'?'user-message':'assistant-message'}`);bubble.setAttribute('aria-label',message.role==='user'?'내 질문':'목표 상담 답변');box.append(bubble);}
}
async function sendConsultation(text){if(!text.trim())return;const answer=SchedulePlanner.reply(state,records(),workDate(),text);const messages=[...(state.consultation||[]),{role:'user',text:text.trim()},{role:'assistant',text:answer}].slice(-40);if(await save({...state,consultation:messages})){$('consultation-input').value='';$('consultation-messages').lastElementChild?.scrollIntoView({block:'nearest'});}}
$('consultation-form').onsubmit=event=>{event.preventDefault();sendConsultation($('consultation-input').value);};
document.querySelectorAll('[data-question]').forEach(b=>b.onclick=()=>sendConsultation(b.dataset.question));
$('chat-open-plan').onclick=()=>{view('home');$('distributed-plan').scrollIntoView({block:'start',behavior:'smooth'});};
$('motion-toggle').onclick=()=>{const paused=$('night-banner').classList.toggle('motion-paused');$('motion-toggle').setAttribute('aria-pressed',String(paused));$('motion-toggle').textContent=paused?'재생':'멈춤';$('motion-toggle').setAttribute('aria-label',paused?'자동차 움직임 재생':'자동차 움직임 일시 정지');};
const fortunes=['작은 기회를 차분하게 살펴보기 좋은 하루예요.','서두르기보다 여유를 챙기는 하루로 만들어 보세요.','좋은 대화가 기분 좋은 흐름을 만드는 날이에요.','익숙한 길에서도 새로운 가능성을 찾아보세요.','꼼꼼한 확인이 마음을 편하게 해주는 하루예요.','작은 성취를 스스로 칭찬해 주기 좋은 날이에요.','쉬어가는 시간에서 다음 힘을 얻어보세요.'];
function dailyFortune(){const day=Math.floor(Date.parse(today()+'T00:00:00Z')/86400000);$('daily-fortune').textContent=fortunes[day%fortunes.length];}
dailyFortune();
renderPlanning();
