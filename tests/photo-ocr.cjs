// Integration test: real browser OCR on generated screenshots; no mocked recognition.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844}});const fixture=await context.newPage();
 async function image(html){await fixture.setViewportSize({width:700,height:650});await fixture.setContent(`<div style="padding:36px;background:#101010;color:white;font:28px sans-serif;line-height:2.2;width:600px">${html}</div>`);return fixture.locator('div').screenshot();}
 const detail=await image('운행번호<br>43874700<br>운행일자 2026.10.7 00:59 ~ 01:45<br>실수익 24,000P<br>고객에게 받은 현금은 30,000원 입니다');
 const list=await image('대리<br>운행시간 23:46 ~ 00:24<br>총 수입 28,800원<br>대리<br>운행시간 20:58 ~ 21:38<br>총 수입 30,400원');
 const partial=await image('대리<br>운행시간 23:46 ~ 00:24<br>총 수입 28,800원<br>대리<br>운행시간 20:58 ~ 21:38<br>총 수입 unreadable');
 const files=[{name:'detail.png',mimeType:'image/png',buffer:detail},{name:'list.png',mimeType:'image/png',buffer:list},{name:'duplicate.png',mimeType:'image/png',buffer:detail}];
 const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[],destinations=[];page.on('dialog',dialog=>dialog.accept());page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(request.url().startsWith('http'))destinations.push(new URL(request.url()).origin);});
 const url=process.env.TEST_URL||'http://127.0.0.1:8003/';await page.goto(url);await page.waitForFunction(()=>ready);await page.locator('.bottom-nav [data-view=diary]').click();
 await page.locator('[name=tips]').fill('20000');await page.locator('[name=transport]').fill('18000');await page.locator('#photos').setInputFiles(files);await page.waitForFunction(()=>!PhotoImport.busy&&!document.getElementById('ocr-panel').hidden,{},{timeout:120000});
 assert.equal(await page.locator('[name=count]').inputValue(),'3');assert.equal(await page.locator('[name=income]').inputValue(),'83200');assert.equal(await page.locator('[name=tips]').inputValue(),'20000');assert.equal(await page.locator('[name=transport]').inputValue(),'18000');assert.equal(await page.locator('.ocr-row').count(),4);assert.match(await page.locator('#ocr-warnings').textContent(),/중복 후보/);
 // Human correction recalculates applied totals immediately.
 await page.locator('.ocr-row input[type=number]').first().fill('25000');assert.equal(await page.locator('[name=income]').inputValue(),'84200');await page.locator('.ocr-row input[type=checkbox]').first().uncheck();assert.equal(await page.locator('[name=count]').inputValue(),'2');assert.equal(await page.locator('[name=income]').inputValue(),'59200');
 await page.locator('[name=income]').fill('90000');await page.locator('.ocr-row input[type=number]').first().fill('26000');assert.equal(await page.locator('[name=income]').inputValue(),'90000');await page.locator('#ocr-apply').click();await page.waitForFunction(()=>diaryForm.elements.income.value==='59200');
 // New recognition must preserve already-entered values until explicitly applied.
 await page.locator('#photos').setInputFiles(files.slice(0,1));await page.waitForFunction(()=>!PhotoImport.busy,{},{timeout:120000});assert.equal(await page.locator('[name=income]').inputValue(),'59200');await page.locator('#ocr-apply').click();await page.waitForFunction(()=>diaryForm.elements.income.value==='24000',{},{timeout:5000});assert.equal(await page.locator('[name=income]').inputValue(),'24000');
 // All OCR libraries/models are served locally and cached; test recognition offline.
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>ready&&navigator.serviceWorker.controller!==null);await context.setOffline(true);await page.locator('.bottom-nav [data-view=diary]').click();await page.locator('#photos').setInputFiles(files.slice(0,1));await page.waitForFunction(()=>!PhotoImport.busy,{},{timeout:120000});assert.equal(await page.locator('[name=income]').inputValue(),'24000');
 await page.locator('#reset-diary').click();await page.locator('#photos').setInputFiles([{name:'partial.png',mimeType:'image/png',buffer:partial}]);await page.waitForFunction(()=>!PhotoImport.busy,{},{timeout:120000});assert.equal(await page.locator('[name=income]').inputValue(),'');assert.equal(await page.locator('#ocr-panel').getAttribute('data-incomplete'),'true');
 // Cancelled scans cannot later overwrite manual input.
 await page.locator('#reset-diary').click();await page.locator('#photos').setInputFiles(files);await page.locator('#ocr-cancel').click();await page.locator('[name=income]').fill('12345');await page.waitForTimeout(1500);assert.equal(await page.locator('[name=income]').inputValue(),'12345');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);assert.ok(destinations.every(origin=>origin===new URL(url).origin),'unexpected external request');
 await browser.close();console.log('PASS: real OCR, labelled earnings only, duplicate exclusion, human correction, existing input protection, tips/expenses retained, offline OCR, cancellation, no external requests, mobile layout');
})().catch(e=>{console.error(e);process.exit(1)});
