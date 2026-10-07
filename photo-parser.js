/* Only explicitly labelled net earnings are parsed. Cash collected is never added. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PhotoParser=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const timePattern=/([01]?\d|2[0-3])\s*:\s*([0-5]\d)\s*[~～〜–—-]\s*([01]?\d|2[0-3])\s*:\s*([0-5]\d)/g;
  function metadata(text){
    const id=String(text).match(/운\s*행\s*번\s*호\s*[:_]?\s*(\d{6,12})/);
    const times=[...String(text).matchAll(timePattern)].at(-1);
    const date=[...String(text).matchAll(/(20\d{2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})/g)].at(-1);
    return {rideId:id?.[1]||'',date:date?`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`:'',start:times?`${times[1].padStart(2,'0')}:${times[2]}`:'',end:times?`${times[3].padStart(2,'0')}:${times[4]}`:''};
  }
  function parse(text,photoIndex=0){
    text=String(text).normalize('NFKC').replace(/실\s*수\s*([익윅입])/g,(_,tail)=>`실수${tail}`).replace(/([총종])\s*수\s*입/g,(_,head)=>`${head}수입`);
    const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),records=[],warnings=[];
    let previous=0,labels=0,unresolved=0;
    for(let i=0;i<lines.length;i++){
      const label=lines[i].match(/실수[익윅입]|[총종]수입/);if(!label)continue;labels++;
      let valueText=lines[i].slice(label.index+label[0].length);
      if(!/[0-9OoIl]/.test(valueText)){
        const next=lines[i+1]||'';if(/^[\s_:：₩]*[0-9OoIl]/.test(next))valueText=next;
      }
      valueText=valueText.replace(/[OoＯ]/g,'0').replace(/^[\s_:：₩]*[Il](?=\d)/,'1').replace(/(?<=\d)\.\s*(?=[0-9]{3}(?:[^0-9]|$))/g,',').replace(/(?<=,)\s+/g,'');
      const numeric=valueText.match(/^[\s_:：₩]*(\d[\d,.]*)/);
      const token=numeric?.[1]||'';
      const matched=token.includes(',')?token.match(/^\d{1,3}(?:,\d{3})+/):token.match(/^\d{4,8}(?!\d)/);
      if(!matched){unresolved++;warnings.push(`사진 ${photoIndex+1}: 수익 항목의 금액을 읽지 못했습니다.`);continue;}
      const amount=Number(matched[0].replace(/,/g,''));
      if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000){unresolved++;warnings.push(`사진 ${photoIndex+1}: 수익 금액을 확인해 주세요.`);continue;}
      const unitUnclear=/^\d/.test(token.slice(matched[0].length));
      const record={amount,photoIndex,...metadata(lines.slice(previous,i+1).join('\n')),unitUnclear};records.push(record);previous=i+1;
      if(label[0]!=='실수익'&&label[0]!=='총수입')warnings.push(`사진 ${photoIndex+1}: 수익 항목 글자가 불명확해 인식 금액을 확인해야 합니다.`);
      if(!record.rideId&&!record.start)warnings.push(`사진 ${photoIndex+1}: 운행 구분 정보를 읽지 못했습니다. 한 운행의 수익이 맞는지와 건수를 확인해 주세요.`);
      if(unitUnclear)warnings.push(`사진 ${photoIndex+1}: 금액 뒤 단위가 불명확합니다. ${amount.toLocaleString('ko-KR')}원이 맞는지 확인해 주세요.`);
    }
    let timeRows=0;
    for(let i=0;i<lines.length;i++)if(/운\s*행\s*(?:시\s*간|일\s*자)/.test(lines[i])&&[...lines.slice(i,i+2).join(' ').matchAll(timePattern)].length)timeRows++;
    const expected=Math.max(labels,timeRows);
    unresolved=Math.max(unresolved,expected-records.length);
    if(expected>records.length&&records.length)warnings.push(`사진 ${photoIndex+1}: 운행 ${expected}건 중 ${records.length}건의 금액만 읽었습니다. 누락된 수익을 확인해 주세요.`);
    if(!records.length&&!warnings.length){unresolved=Math.max(1,expected);warnings.push(`사진 ${photoIndex+1}: '실수익' 또는 '총 수입'을 찾지 못했습니다. 금액을 직접 입력하거나 더 선명한 사진을 선택해 주세요.`);}
    return {records,warnings,unresolved,expected};
  }
  function deduplicate(records){
    const ids=new Set(),times=new Map();
    return records.map(r=>{
      const signature=r.start&&r.end?`${r.start}|${r.end}|${r.amount}`:'';
      const dates=times.get(signature)||[];
      const duplicate=!!(r.photoDuplicate||(r.rideId&&ids.has(r.rideId))||(signature&&dates.some(date=>!date||!r.date||date===r.date)));
      if(r.rideId)ids.add(r.rideId);if(signature)times.set(signature,[...dates,r.date||'']);
      return {...r,duplicate,selected:!duplicate};
    });
  }
  return {parse,deduplicate,metadata};
});
