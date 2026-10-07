/* Self-hosted Tesseract: images stay on the device, no external API requests. */
(function(){
  'use strict';
  let generation=0,worker=null,busy=false,current=[],applied=false,missingPhotos=0,appliedValues=null;
  const panel=document.getElementById('ocr-panel'),status=document.getElementById('ocr-status'),rows=document.getElementById('ocr-results'),warnings=document.getElementById('ocr-warnings');
  const applyButton=document.getElementById('ocr-apply'),cancelButton=document.getElementById('ocr-cancel');
  const absolute=path=>new URL(path,document.baseURI).href;
  async function stop(){generation++;busy=false;cancelButton.hidden=true;const active=worker;worker=null;if(active)await active.terminate().catch(()=>{});}
  function clear(){stop();current=[];applied=false;missingPhotos=0;appliedValues=null;panel.dataset.incomplete='false';panel.hidden=true;rows.replaceChildren();warnings.replaceChildren();}
  function totalSelected(){const selected=current.filter(r=>r.selected);return {count:selected.length,income:selected.reduce((n,r)=>n+r.amount,0)};}
  function apply(force=false){
    if(!current.length)return;
    if([...rows.querySelectorAll('input[type=number]')].some(input=>!input.checkValidity())){status.textContent='운행별 인식 금액을 먼저 올바르게 수정해 주세요.';return;}
    const countInput=diaryForm.elements.namedItem('count'),incomeInput=diaryForm.elements.namedItem('income');
    const sums=totalSelected();
    if(force&&appliedValues&&(countInput.value!==appliedValues.count||incomeInput.value!==appliedValues.income)){applied=false;appliedValues=null;status.textContent='직접 수정한 입력을 유지했습니다. 사진 결과로 바꾸려면 건수·금액 적용을 눌러 주세요.';return;}
    if(!force&&!applied&&(Number(countInput.value)>0||Number(incomeInput.value)>0)&&!confirm('사진에서 읽은 건수와 운행 수익으로 기존 입력값을 교체할까요? 팁과 지출은 그대로 유지합니다.'))return;
    countInput.value=sums.count;incomeInput.value=sums.income;applied=true;appliedValues={count:countInput.value,income:incomeInput.value};updatePreview();queueDraft();
    status.textContent=`${missingPhotos?`사진 ${missingPhotos}장의 수익을 읽지 못해 합계가 불완전합니다. 누락 금액을 확인해 주세요. `:''}사진 인식 결과: ${sums.count}건 · ${money(sums.income)}. 사진과 비교해 확인한 뒤 저장해 주세요.`;
  }
  function renderResults(messages){
    rows.replaceChildren();warnings.replaceChildren();
    current.forEach((r,index)=>{
      const row=document.createElement('div');row.className='ocr-row';
      const label=document.createElement('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=r.selected;checkbox.setAttribute('aria-label',`인식 운행 ${index+1} 합산`);label.append(checkbox,document.createTextNode(`사진 ${r.photoIndex+1} · ${r.date?`${Number(r.date.slice(5,7))}/${Number(r.date.slice(8))} · `:''}${r.start?`${r.start}~${r.end}`:`운행 ${index+1}`}${r.duplicate?' · 중복 후보':''}`));
      const value=document.createElement('input');value.type='number';value.min='1';value.max='100000000';value.step='1';value.inputMode='numeric';value.value=r.amount;value.setAttribute('aria-label',`인식 운행 ${index+1} 수익 금액`);
      checkbox.onchange=()=>{r.selected=checkbox.checked;if(applied)apply(true);};
      value.oninput=()=>{const n=Number(value.value);if(Number.isSafeInteger(n)&&n>0&&n<=100000000){r.amount=n;if(applied)apply(true);}};
      if(r.needsReview){label.append(document.createTextNode(' · 금액 재확인'));}row.append(label,value);rows.append(row);
    });
    if(current.some(r=>r.duplicate))messages.push('같은 운행번호 또는 시간·금액이 같은 항목은 중복 후보로 제외했습니다. 다른 운행이면 체크해서 포함하세요.');
    for(const message of [...new Set(messages)]){const p=document.createElement('p');p.textContent=message;warnings.append(p);}
    panel.dataset.incomplete=String(missingPhotos>0);document.getElementById('ocr-badge').textContent=missingPhotos?'일부 누락':current.some(r=>r.needsReview)?'금액 재확인':'직접 확인';
    applyButton.hidden=!current.length;applyButton.disabled=false;
  }
  async function prepare(data,contrast=true){
    const image=new Image();image.src=data;await image.decode();
    const scale=Math.min(2,1600/image.width,3000/image.height);
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),a=pixels.data;
    let light=0,samples=0;for(let i=0;i<a.length;i+=400){light+=(a[i]*0.299+a[i+1]*0.587+a[i+2]*0.114);samples++;}
    const invert=light/samples<128;
    for(let i=0;i<a.length;i+=4){let gray=a[i]*0.299+a[i+1]*0.587+a[i+2]*0.114;if(invert)gray=255-gray;if(contrast)gray=Math.max(0,Math.min(255,(gray-128)*1.25+128));a[i]=a[i+1]=a[i+2]=gray;}
    ctx.putImageData(pixels,0,0);return canvas;
  }
  async function recognizePhoto(active,data,index,isCurrent){
    const canvas=await prepare(data);
    await active.setParameters({tessedit_pageseg_mode:'6'});
    let result=await active.recognize(canvas);
    const originalText=result.data.text;
    let best=PhotoParser.parse(originalText,index);
    const incomplete=parsed=>!parsed.records.length||parsed.unresolved>0;
    const first=best;
    status.textContent=`사진 ${index+1}: 수익 부분을 다시 읽고 있습니다.`;
    const candidates=[];
    // Sparse layout can separate a label and its amount that a full-page pass missed.
    if(!isCurrent())return best;
    await active.setParameters({tessedit_pageseg_mode:'11'});
    result=await active.recognize(canvas);candidates.push(PhotoParser.parse(result.data.text,index));
    const expectedFloor=Math.max(first.expected,candidates[0].expected);
    for(const candidate of [best,candidates[0]]){candidate.unresolved=Math.max(candidate.unresolved,expectedFloor-candidate.records.length);candidate.expected=expectedFloor;}
    if(candidates[0].records.length>best.records.length||(candidates[0].records.length===best.records.length&&candidates[0].unresolved<best.unresolved))best=candidates[0];
    const sparse=candidates[0];
    if(!incomplete(best)){
      for(const r of best.records){
        const alternatives=[...first.records,...sparse.records].filter(other=>
          (r.rideId&&other.rideId?r.rideId===other.rideId:r.start&&other.start?r.start===other.start&&r.end===other.end:first.records.length===1&&sparse.records.length===1));
        const amounts=[...new Set(alternatives.map(other=>other.amount))];
        if(amounts.length>1){r.needsReview=true;r.alternateAmounts=amounts;best.warnings.push(`사진 ${index+1}: 재검사 금액이 ${amounts.map(money).join(' / ')}으로 다릅니다. 원본을 확인하고 맞는 금액으로 수정해 주세요.`);}
      }
      return best;
    }
    // Detail pages put net earnings in the middle/lower band. Exclude the header and footer.
    // Try overlapping bands; use the best single pass, never add retry results together.
    const plain=await prepare(data,false);
    for(const [top,bottom] of [[0.40,0.72],[0.52,0.85]]){
      if(!isCurrent())return best;
      const crop=document.createElement('canvas');crop.width=plain.width;crop.height=Math.round(plain.height*(bottom-top));
      crop.getContext('2d').drawImage(plain,0,Math.round(plain.height*top),plain.width,crop.height,0,0,crop.width,crop.height);
      await active.setParameters({tessedit_pageseg_mode:'6'});
      result=await active.recognize(crop);
      const parsed=PhotoParser.parse(result.data.text,index);
      parsed.unresolved=Math.max(parsed.unresolved,expectedFloor-parsed.records.length);parsed.expected=expectedFloor;
      if(parsed.records.length>best.records.length||(parsed.records.length===best.records.length&&parsed.unresolved<best.unresolved))best=parsed;
      if(!incomplete(best))break;
    }
    if(best.unresolved&&best.records.length)best.warnings.push(`사진 ${index+1}: 사진 전체의 운행 중 일부 수익만 읽었습니다. 인식 결과를 전체 합계로 저장하지 마세요.`);
    if(best.records.length===1&&[...originalText.matchAll(/([01]?\d|2[0-3]):[0-5]\d\s*[~～〜–—-]/g)].length===1){const meta=PhotoParser.metadata(originalText);for(const key of ['rideId','date','start','end'])if(!best.records[0][key])best.records[0][key]=meta[key];}
    return best;
  }
  async function start(files){
    stop();const run=++generation;current=[];applied=false;missingPhotos=0;appliedValues=null;panel.dataset.incomplete='false';rows.replaceChildren();warnings.replaceChildren();
    if(!files.length){panel.hidden=true;return;}
    panel.hidden=false;busy=true;cancelButton.hidden=false;applyButton.hidden=true;
    status.textContent='사진을 읽고 있습니다. 첫 인식은 준비 시간이 조금 걸릴 수 있어요.';
    const countBefore=diaryForm.elements.namedItem('count').value,incomeBefore=diaryForm.elements.namedItem('income').value;
    let active,photoNumber=1;
    try{
      const photos=files.every(p=>p&&typeof p.data==='string')?files:await readPhotos(files);if(run!==generation)return;
      active=await Tesseract.createWorker('kor+eng',1,{workerPath:absolute('vendor/ocr/worker.min.js'),corePath:absolute('vendor/ocr/tesseract-core-lstm.wasm.js'),langPath:absolute('vendor/ocr'),workerBlobURL:false,logger:message=>{if(run===generation&&message.status==='recognizing text')status.textContent=`사진 ${photoNumber}/${photos.length} 읽는 중 · ${Math.round(message.progress*100)}%`;}});
      if(run!==generation){await active.terminate();return;}worker=active;
      await active.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
      const all=[],messages=[],cache=new Map(),missing=new Set();
      for(let i=0;i<photos.length;i++){
        if(run!==generation)return;photoNumber=i+1;
        try{if(cache.has(photos[i].data)){const earlier=cache.get(photos[i].data);all.push(...earlier.records.map(r=>({...r,photoIndex:i,photoDuplicate:true})));if(earlier.unresolved)missing.add(i);continue;}const parsed=await recognizePhoto(active,photos[i].data,i,()=>run===generation);cache.set(photos[i].data,parsed);all.push(...parsed.records);messages.push(...parsed.warnings);if(parsed.unresolved)missing.add(i);}
        catch{missing.add(i);if(run===generation)messages.push(`사진 ${i+1}을 읽지 못했습니다. 해당 사진의 건수와 금액은 직접 확인해 주세요.`);}
      }
      if(run!==generation)return;
      missingPhotos=missing.size;
      current=PhotoParser.deduplicate(all);renderResults(messages);
      const countInput=diaryForm.elements.namedItem('count'),incomeInput=diaryForm.elements.namedItem('income');
      if(current.length&&!missingPhotos&&!current.some(r=>r.needsReview)&&countBefore===countInput.value&&incomeBefore===incomeInput.value&&!Number(countBefore)&&!Number(incomeBefore))apply(true);
      else if(current.some(r=>r.needsReview))status.textContent='두 번 읽은 금액이 달라 자동 입력하지 않았어요. 사진을 눌러 원본을 확인한 뒤 금액을 수정하고 적용해 주세요.';
      else if(missingPhotos)status.textContent=`사진 ${missingPhotos}장을 끝까지 읽지 못했습니다. 입력값은 유지했어요. 누락된 금액을 확인한 뒤 적용하거나 직접 입력하세요.`;
      else status.textContent=current.length?`${totalSelected().count}건을 찾았습니다. 기존 입력은 유지했습니다. 확인 후 '건수·금액 적용'을 누르세요.`:'수익을 읽지 못했습니다. 기존 입력은 유지했습니다. 금액을 직접 입력할 수 있어요.';
      if(messages.length&&applied)status.textContent+=' 일부 항목은 아래 확인 안내를 살펴보세요.';
    }catch(error){if(run===generation){status.textContent='사진 인식을 시작하지 못했습니다. 온라인 상태에서 다시 선택하거나 건수와 금액을 직접 입력해 주세요.';}}
    finally{if(active){await active.terminate().catch(()=>{});if(worker===active)worker=null;}if(run===generation){busy=false;cancelButton.hidden=true;}}
  }
  applyButton.onclick=()=>apply();cancelButton.onclick=async()=>{await stop();status.textContent='사진 인식을 중단했습니다. 건수와 금액을 직접 입력할 수 있어요.';};
  document.getElementById('photos').addEventListener('change',event=>start([...event.target.files]));
  window.PhotoImport={clear,scan:start,get busy(){return busy;}};
})();
