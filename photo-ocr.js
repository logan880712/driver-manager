/* Self-hosted Tesseract: images stay on the device, no external API requests. */
(function(){
  'use strict';
  let generation=0,worker=null,busy=false,current=[],applied=false;
  const panel=document.getElementById('ocr-panel'),status=document.getElementById('ocr-status'),rows=document.getElementById('ocr-results'),warnings=document.getElementById('ocr-warnings');
  const applyButton=document.getElementById('ocr-apply'),cancelButton=document.getElementById('ocr-cancel');
  const absolute=path=>new URL(path,document.baseURI).href;
  async function stop(){generation++;busy=false;cancelButton.hidden=true;const active=worker;worker=null;if(active)await active.terminate().catch(()=>{});}
  function clear(){stop();current=[];applied=false;panel.hidden=true;rows.replaceChildren();warnings.replaceChildren();}
  function totalSelected(){const selected=current.filter(r=>r.selected);return {count:selected.length,income:selected.reduce((n,r)=>n+r.amount,0)};}
  function apply(force=false){
    if(!current.length)return;
    const countInput=diaryForm.elements.namedItem('count'),incomeInput=diaryForm.elements.namedItem('income');
    const sums=totalSelected();
    if(!force&&!applied&&(Number(countInput.value)>0||Number(incomeInput.value)>0)&&!confirm('사진에서 읽은 건수와 운행 수익으로 기존 입력값을 교체할까요? 팁과 지출은 그대로 유지합니다.'))return;
    countInput.value=sums.count;incomeInput.value=sums.income;applied=true;updatePreview();
    status.textContent=`사진 인식 결과: ${sums.count}건 · ${money(sums.income)}. 사진과 비교해 확인한 뒤 저장해 주세요.`;
  }
  function renderResults(messages){
    rows.replaceChildren();warnings.replaceChildren();
    current.forEach((r,index)=>{
      const row=document.createElement('div');row.className='ocr-row';
      const label=document.createElement('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=r.selected;checkbox.setAttribute('aria-label',`인식 운행 ${index+1} 합산`);label.append(checkbox,document.createTextNode(`사진 ${r.photoIndex+1} · ${r.start?`${r.start}~${r.end}`:`운행 ${index+1}`}${r.duplicate?' · 중복 후보':''}`));
      const value=document.createElement('input');value.type='number';value.min='1';value.max='100000000';value.step='1';value.inputMode='numeric';value.value=r.amount;value.setAttribute('aria-label',`인식 운행 ${index+1} 수익 금액`);
      checkbox.onchange=()=>{r.selected=checkbox.checked;if(applied)apply(true);};
      value.oninput=()=>{const n=Number(value.value);if(Number.isSafeInteger(n)&&n>0&&n<=100000000){r.amount=n;if(applied)apply(true);}};
      row.append(label,value);rows.append(row);
    });
    if(current.some(r=>r.duplicate))messages.push('같은 운행번호 또는 시간·금액이 같은 항목은 중복 후보로 제외했습니다. 다른 운행이면 체크해서 포함하세요.');
    for(const message of [...new Set(messages)]){const p=document.createElement('p');p.textContent=message;warnings.append(p);}
    applyButton.hidden=!current.length;applyButton.disabled=false;
  }
  async function prepare(data){
    const image=new Image();image.src=data;await image.decode();
    const scale=Math.min(2,1600/image.width,3000/image.height);
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),a=pixels.data;
    let light=0,samples=0;for(let i=0;i<a.length;i+=400){light+=(a[i]*0.299+a[i+1]*0.587+a[i+2]*0.114);samples++;}
    const invert=light/samples<128;
    for(let i=0;i<a.length;i+=4){let gray=a[i]*0.299+a[i+1]*0.587+a[i+2]*0.114;if(invert)gray=255-gray;gray=Math.max(0,Math.min(255,(gray-128)*1.25+128));a[i]=a[i+1]=a[i+2]=gray;}
    ctx.putImageData(pixels,0,0);return canvas;
  }
  async function start(files){
    stop();const run=++generation;current=[];applied=false;rows.replaceChildren();warnings.replaceChildren();
    if(!files.length){panel.hidden=true;return;}
    panel.hidden=false;busy=true;cancelButton.hidden=false;applyButton.hidden=true;
    status.textContent='사진을 읽고 있습니다. 첫 인식은 준비 시간이 조금 걸릴 수 있어요.';
    const countBefore=diaryForm.elements.namedItem('count').value,incomeBefore=diaryForm.elements.namedItem('income').value;
    let active,photoNumber=1;
    try{
      const photos=await readPhotos(files);if(run!==generation)return;
      active=await Tesseract.createWorker('kor+eng',1,{workerPath:absolute('vendor/ocr/worker.min.js'),corePath:absolute('vendor/ocr/tesseract-core-lstm.wasm.js'),langPath:absolute('vendor/ocr'),workerBlobURL:false,logger:message=>{if(run===generation&&message.status==='recognizing text')status.textContent=`사진 ${photoNumber}/${photos.length} 읽는 중 · ${Math.round(message.progress*100)}%`;}});
      if(run!==generation){await active.terminate();return;}worker=active;
      await active.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
      const all=[],messages=[];
      for(let i=0;i<photos.length;i++){
        if(run!==generation)return;photoNumber=i+1;
        try{const canvas=await prepare(photos[i].data);const result=await active.recognize(canvas);const parsed=PhotoParser.parse(result.data.text,i);all.push(...parsed.records);messages.push(...parsed.warnings);}
        catch{if(run===generation)messages.push(`사진 ${i+1}을 읽지 못했습니다. 해당 사진의 건수와 금액은 직접 확인해 주세요.`);}
      }
      if(run!==generation)return;
      current=PhotoParser.deduplicate(all);renderResults(messages);
      const countInput=diaryForm.elements.namedItem('count'),incomeInput=diaryForm.elements.namedItem('income');
      if(current.length&&countBefore===countInput.value&&incomeBefore===incomeInput.value&&!Number(countBefore)&&!Number(incomeBefore))apply(true);
      else status.textContent=current.length?`${totalSelected().count}건을 찾았습니다. 기존 입력은 유지했습니다. 확인 후 '건수·금액 적용'을 누르세요.`:'수익을 읽지 못했습니다. 기존 입력은 유지했습니다. 금액을 직접 입력할 수 있어요.';
      if(messages.length&&applied)status.textContent+=' 일부 항목은 아래 확인 안내를 살펴보세요.';
    }catch(error){if(run===generation){status.textContent='사진 인식을 시작하지 못했습니다. 온라인 상태에서 다시 선택하거나 건수와 금액을 직접 입력해 주세요.';}}
    finally{if(active){await active.terminate().catch(()=>{});if(worker===active)worker=null;}if(run===generation){busy=false;cancelButton.hidden=true;}}
  }
  applyButton.onclick=()=>apply();cancelButton.onclick=async()=>{await stop();status.textContent='사진 인식을 중단했습니다. 건수와 금액을 직접 입력할 수 있어요.';};
  document.getElementById('photos').addEventListener('change',event=>start([...event.target.files]));
  window.PhotoImport={clear,get busy(){return busy;}};
})();
