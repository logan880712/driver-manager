/* Parse only explicitly labelled net earnings, never cash collected or totals elsewhere. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PhotoParser=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function parse(text,photoIndex=0){
    const lines=String(text).normalize('NFKC').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const records=[],warnings=[];
    let previous=0;
    for(let i=0;i<lines.length;i++){
      const compact=lines[i].replace(/\s/g,'');
      if(!/(?:실수익|[총종]수입)/.test(compact))continue;
      const label=lines[i].match(/실\s*수\s*익|[총종]\s*수\s*입/);
      if(!label)continue;
      let valueText=lines[i].slice(label.index+label[0].length);
      if(!/\d/.test(valueText)){
        const next=lines[i+1]||'';
        if(/^[\s_:：]*\d/.test(next))valueText=next;
      }
      // OCR sometimes reads the unit P as 2; keep the comma-grouped amount and flag its unit.
      const match=valueText.match(/\d{1,3}(?:,\d{3})+|\d{4,8}/);
      if(!match){warnings.push(`사진 ${photoIndex+1}: 수익 항목의 금액을 읽지 못했습니다.`);continue;}
      if (label[0].startsWith('종')) warnings.push(`사진 ${photoIndex+1}: '총 수입' 글자가 불명확해 인식 금액을 확인해야 합니다.`);
      const amount=Number(match[0].replace(/,/g,''));
      if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000){warnings.push(`사진 ${photoIndex+1}: 수익 금액을 확인해 주세요.`);continue;}
      const context=lines.slice(previous,i+1).join('\n');
      const id=context.match(/운\s*행\s*번\s*호\s*[:_]?\s*(\d{6,12})/);
      const times=[...context.matchAll(/([01]?\d|2[0-3])\s*:\s*([0-5]\d)\s*[~～〜–—-]\s*([01]?\d|2[0-3])\s*:\s*([0-5]\d)/g)].at(-1);
      const date=[...context.matchAll(/(20\d{2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})/g)].at(-1);
      const tail=valueText.slice(match.index+match[0].length).trim();
      const unitUnclear=!!tail&&/^\d/.test(tail);
      const record={amount,photoIndex,rideId:id?.[1]||'',date:date?`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`:'',start:times?`${times[1].padStart(2,'0')}:${times[2]}`:'',end:times?`${times[3].padStart(2,'0')}:${times[4]}`:'',unitUnclear};
      records.push(record);previous=i+1;
      if(!record.rideId&&!record.start)warnings.push(`사진 ${photoIndex+1}: 운행번호·시간을 읽지 못했습니다. 한 운행의 수익이 맞는지와 건수를 확인해 주세요.`);
      if(unitUnclear)warnings.push(`사진 ${photoIndex+1}: 금액 뒤 단위가 불명확합니다. ${amount.toLocaleString('ko-KR')}원이 맞는지 확인해 주세요.`);
    }
    if(!records.length&&!warnings.length)warnings.push(`사진 ${photoIndex+1}: '실수익' 또는 '총 수입'을 찾지 못했습니다. 금액을 직접 입력하거나 더 선명한 사진을 선택해 주세요.`);
    return {records,warnings};
  }
  function deduplicate(records){
    const ids=new Set(),timeAmounts=new Set();
    return records.map(r=>{
      const id=r.rideId,signature=r.start&&r.end?`${r.start}|${r.end}|${r.amount}`:'';
      const duplicate=!!((id&&ids.has(id))||(signature&&timeAmounts.has(signature)));
      if(id)ids.add(id);if(signature)timeAmounts.add(signature);
      return {...r,duplicate,selected:!duplicate};
    });
  }
  return {parse,deduplicate};
});
