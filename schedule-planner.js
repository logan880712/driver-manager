(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SchedulePlanner=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
  const week=date=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
  const isLong=date=>[4,5].includes(weekday(date));
  function validPreferences(p){return !!p&&Array.isArray(p.weekdays)&&p.weekdays.length<=7&&new Set(p.weekdays).size===p.weekdays.length&&p.weekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6)&&[1,2].includes(p.perWeek)&&['longLimit','extraIncome'].every(k=>Number.isSafeInteger(p[k])&&p[k]>0&&p[k]<=100000000);}
  function calculate(state,records,referenceDate,override,selection){
    const month=referenceDate.slice(0,7),items=records.filter(r=>r.date.startsWith(month)),daily=new Map();
    for(const r of items)daily.set(r.date,(daily.get(r.date)||0)+r.net);
    const income=[...daily.values()].reduce((n,v)=>n+v,0),average=daily.size?income/daily.size:0,remaining=Math.max(0,state.goals.monthly-income);
    const defaultPreferences={weekdays:[6],perWeek:1,longLimit:Math.max(150000,state.goals.daily),extraIncome:average>0?Math.max(1000,Math.round(average/1000)*1000):state.goals.daily};
    const prefs=validPreferences(override)?override:validPreferences(state.planPreferences)?state.planPreferences:defaultPreferences;
    const planned=[],candidates=[],d=new Date(referenceDate+'T00:00:00Z'),usedWeeks=new Map();
    while(d.toISOString().slice(0,7)===month){
      const date=d.toISOString().slice(0,10),regular=state.workdays.includes(d.getUTCDay()),extra=state.extraDates.includes(date)&&!regular;
      if(!daily.has(date)&&!state.skipDates.includes(date)){
        if(regular||extra){planned.push({date,long:isLong(date),source:extra?'extra':'regular'});}
        else if(prefs.weekdays.includes(d.getUTCDay()))candidates.push({date,long:isLong(date),source:'recommended'});
      }
      d.setUTCDate(d.getUTCDate()+1);
    }
    // A completed additional shift also uses that week's chosen capacity.
    for(const date of [...new Set(state.extraDates)].filter(date=>date.startsWith(month)&&(date>=referenceDate||daily.has(date))&&(!state.skipDates.includes(date)||daily.has(date))&&!state.workdays.includes(weekday(date))))usedWeeks.set(week(date),(usedWeeks.get(week(date))||0)+1);
    const short=planned.filter(d=>!d.long&&d.source==='regular').length,extraShort=planned.filter(d=>!d.long&&d.source==='extra').length,long=planned.filter(d=>d.long).length;
    const capacity=short*state.goals.daily+extraShort*prefs.extraIncome+long*prefs.longLimit;
    const initialGap=Math.max(0,remaining-capacity),recommended=[];let gap=initialGap;
    // Spread the first pass over weeks before recommending a second day in any week.
    if(Array.isArray(selection)){
      for(const candidate of candidates.filter(d=>selection.includes(d.date))){const key=week(candidate.date),used=usedWeeks.get(key)||0;if(used>=prefs.perWeek)continue;recommended.push(candidate);usedWeeks.set(key,used+1);gap=Math.max(0,gap-(candidate.long?prefs.longLimit:prefs.extraIncome));}
    }else for(let pass=0;pass<prefs.perWeek&&gap>0;pass++)for(const candidate of candidates){
      const key=week(candidate.date),used=usedWeeks.get(key)||0;
      if(gap<=0)break;
      if(recommended.some(d=>d.date===candidate.date)||used>pass||used>=prefs.perWeek)continue;
      recommended.push(candidate);usedWeeks.set(key,used+1);gap=Math.max(0,gap-(candidate.long?prefs.longLimit:prefs.extraIncome));
    }
    recommended.sort((a,b)=>a.date.localeCompare(b.date));
    const allLong=long+recommended.filter(d=>d.long).length,allExtraShort=extraShort+recommended.filter(d=>!d.long).length;
    const numerator=Math.max(0,remaining-short*state.goals.daily-allExtraShort*prefs.extraIncome),adjustedLong=allLong?Math.ceil(numerator/allLong):0;
    const schedule=[...planned,...recommended].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,target:remaining===0?0:d.long?adjustedLong:d.source==='regular'?state.goals.daily:prefs.extraIncome}));
    const observedExpected=date=>{const same=[...daily].filter(([key])=>weekday(key)===weekday(date));return same.length>=3?same.reduce((n,[,v])=>n+v,0)/same.length:daily.size?average:state.goals.daily;};
    const forecast=income+planned.reduce((n,d)=>n+observedExpected(d.date),0);
    const previewForecast=forecast+recommended.reduce((n,d)=>n+observedExpected(d.date),0);
    const forecastGap=Math.max(0,state.goals.monthly-forecast),additionalByAverage=average>0?Math.ceil(forecastGap/average):null;
    return {month,income,remaining,average,sampleDays:daily.size,prefs,planned,candidates,recommended,schedule,short,extraShort,long,adjustedLong,initialGap,uncovered:gap,forecast,previewForecast,forecastGap,additionalByAverage,requiredAtExtraTarget:initialGap?Math.ceil(initialGap/prefs.extraIncome):0};
  }
  function label(date){return `${Number(date.slice(5,7))}/${Number(date.slice(8))}(${['일','월','화','수','목','금','토'][weekday(date)]})`;}
  function answer(model,state,message){
    const money=v=>`${Math.round(v).toLocaleString('ko-KR')}원`;
    let intro=`김정업 기사님, 이번 달 목표까지 ${money(model.remaining)} 남았어요.`;
    if(model.remaining===0)return '김정업 기사님, 이번 달 목표를 달성했어요! 추가 근무보다 본업과 컨디션을 먼저 생각해 주세요.';
    const supported=/목표|추가|부족|얼마|며칠|몇\s*일|수익|계획|근무|일하|일을|평균|휴무|쉬|요일|토요일|일요일|월요일|화요일|수요일|목요일|금요일|스케줄/.test(message);
    if(!supported)return '저장된 일지로 목표와 근무 계획을 계산하는 상담이에요. “목표까지 며칠 더 필요해요?” 또는 “토요일에 추가하면 어떨까요?”처럼 물어봐 주세요.';
    const dayNames=['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
    const requested=dayNames.map((name,i)=>message.includes(name)?i:-1).filter(i=>i>=0);
    const referenceDate=model.month+'-'+model.referenceDay;
    if(requested.length){
      if(/휴무|못\s*나|쉬|불가|못\s*일/.test(message)){
        const missing=[],d=new Date(referenceDate+'T00:00:00Z');while(d.toISOString().slice(0,7)===model.month){if(requested.includes(d.getUTCDay()))missing.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1);}
        state={...state,skipDates:[...new Set([...state.skipDates,...missing])]};model=calculate(state,rootRecords(state),referenceDate);intro+=` ${requested.map(d=>dayNames[d]).join('·')}을 쉬는 것으로 가정해서 계산했어요. 실제 휴무 설정은 바뀌지 않습니다.`;
      }else{
        const prefs={...model.prefs,weekdays:requested};model=calculate(state,rootRecords(state),referenceDate,prefs);
        const count=message.match(/(하루|이틀|사흘|\d+\s*일)\s*(?:만|추가|더)/);if(count){const limit={하루:1,이틀:2,사흘:3}[count[1]]||Number(count[1].replace(/\D/g,''));model=calculate(state,rootRecords(state),referenceDate,prefs,model.recommended.slice(0,limit).map(d=>d.date));}
      }
    }
    const basis=model.sampleDays?`${model.sampleDays}일의 실제 하루 평균은 ${money(model.average)}이고, 현재 일정대로라면 월말 ${money(model.forecast)}로 추정돼요.`:`기록이 없어 하루 목표 ${money(state.goals.daily)}을 가정한 계획입니다. 일지를 쌓으면 실제 평균으로 다시 계산해요.`;
    let plan=model.recommended.length?`추가 후보는 ${model.recommended.map(d=>label(d.date)).join(', ')} · ${model.recommended.length}일이에요. 추가일 목표 ${money(model.prefs.extraIncome)} 기준으로 나누면 ${model.long||model.recommended.some(d=>d.long)?`목·금 필요 수익은 하루 ${money(model.adjustedLong)}입니다.`:'목·금 예정일은 없습니다.'}`:'선택한 추가 요일에서 더 추천할 날짜가 없거나, 설정한 목표 배분에 추가일이 필요하지 않습니다.';
    if(model.uncovered)plan+=` 선택한 날짜로도 설정 목표 기준 ${money(model.uncovered)}이 부족해요. 추가 요일·주당 횟수를 조정하거나 이번 달 목표를 다시 검토해 주세요.`;
    const pace=model.sampleDays&&model.forecastGap>0?` 실제 평균을 유지할 경우 현재 예상 부족액은 ${money(model.forecastGap)}${model.additionalByAverage!==null?`, 평균 기준 추가 약 ${model.additionalByAverage}일입니다`:'. 양수의 평균 수익이 없어 추가일을 추정하기 어렵습니다'}.`:'';
    return [intro,basis,pace,plan,`${state.home}에 ${state.deadline} 전 귀가를 우선해요. 금액은 예상이며 수입을 보장하지 않습니다. 추천만으로 일정이 변경되지는 않아요.`].filter(Boolean).join('\n\n');
  }
  function rootRecords(state){const dates=new Set(state.diaries.map(d=>d.date));return [...state.diaries.map(d=>({date:d.date,net:d.income+d.tips-d.transport-d.expense})),...state.rides.filter(r=>!dates.has(r.date)).map(r=>({date:r.date,net:r.fare-r.fee-r.expense}))];}
  function reply(state,records,referenceDate,message){const model=calculate(state,records,referenceDate);model.referenceDay=referenceDate.slice(8);return answer(model,state,message);}
  return {calculate,validPreferences,label,reply};
});
