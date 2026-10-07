// Run with the environment's preinstalled Playwright and Chromium.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
 const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:8001/');
 await page.waitForFunction(()=>ready);
 assert.equal(await page.locator('#monthly-goal').inputValue(),'2500000');
 await page.locator('.bottom-nav [data-view=diary]').click();
 const values={date:'2026-10-06',start:'19:42',end:'01:45',endDate:'2026-10-07',count:'5',income:'123200',tips:'20000',transport:'18000',expense:'0',memo:'군포역 귀가'};
 for(const [key,value]of Object.entries(values))await page.locator(`#diary-form [name=${key}]`).fill(value);
 await page.locator('#photos').setInputFiles('icon-192.png');
 assert.equal(await page.locator('#diary-preview').textContent(),'순수익 125,200원');
 await page.locator('#diary-form [type=submit]').click();await page.waitForFunction(()=>state.diaries.length===1);
 assert.equal(await page.evaluate(()=>diaryNet(state.diaries[0])),125200);
 console.log('saved diary');await page.reload();await page.waitForFunction(()=>ready);assert.equal(await page.evaluate(()=>state.diaries[0].photos.length),1);
 await page.locator('.bottom-nav [data-view=history]').click();await page.locator('#history-month').fill('2026-10');await page.locator('#history-month').dispatchEvent('change');
 assert.match(await page.locator('#history-summary').textContent(),/125,200원/);
 assert.match(await page.locator('.diary-card').textContent(),/6시간 3분/);
 console.log('history checked');await page.locator('.history-actions .secondary').click();await page.locator('#diary-form [name=tips]').fill('25000');await page.locator('#diary-form [type=submit]').click();await page.waitForFunction(()=>state.diaries[0].tips===25000);
 assert.equal(await page.evaluate(()=>state.diaries.length),1);assert.equal(await page.evaluate(()=>state.diaries[0].photos.length),1);
 console.log('edit checked');
 // Invalid end date must not overwrite a saved diary.
 await page.locator('.bottom-nav [data-view=diary]').click();await page.locator('#diary-date').fill('2026-10-06');await page.locator('#diary-date').dispatchEvent('change');await page.locator('#end-date').fill('2026-10-05');await page.locator('#diary-form [type=submit]').click();assert.equal(await page.evaluate(()=>state.diaries[0].endDate),'2026-10-07');
 await page.locator('.bottom-nav [data-view=settings]').click();
 const download=page.waitForEvent('download');await page.locator('#export').click();const file=await download;const path=await file.path();const backup=JSON.parse(require('node:fs').readFileSync(path,'utf8'));assert.equal(backup.diaries[0].photos.length,1);
 page.on('dialog',d=>d.accept());await page.locator('#import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":2}')});await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('백업을 읽지'));assert.equal(await page.evaluate(()=>state.diaries.length),1);
 await page.locator('#import').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('백업을 복원'));
 await page.locator('#skip-dates').fill('2026-10-08');await page.locator('#extra-dates').fill('2026-10-10');await page.locator('#goal-form [type=submit]').click();await page.waitForFunction(()=>state.skipDates.includes('2026-10-08'));
 // Diary aggregate replaces legacy rides on the same date.
 assert.equal(await page.evaluate(()=>{state.rides=[{id:'test',date:'2026-10-06',fare:50000,fee:0,expense:0,from:'A',to:'B',memo:''}];return total(records());}),130200);
 // Deterministic October 7 plan: skip Oct 8, add Oct 10 => 8 short / 7 long.
 await page.clock.setFixedTime(new Date('2026-10-07T04:00:00Z'));
 const targets=await page.evaluate(()=>{render();return [document.getElementById('planned-days').textContent,document.getElementById('long-target').textContent];});
 assert.deepEqual(targets,['15일','224,258원']);
 for(const tab of ['home','diary','history','settings']){await page.locator(`.bottom-nav [data-view=${tab}]`).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,tab+' overflow');}
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);await context.setOffline(true);console.log('saved diary');await page.reload();await page.waitForFunction(()=>ready);assert.equal(await page.locator('h1').textContent(),'나의 대리일지');await context.setOffline(false);
 assert.deepEqual(errors,[]);
 // Old localStorage data migration uses a fresh browser context.
 const legacyContext=await browser.newContext();await legacyContext.addInitScript(()=>localStorage.setItem('driver-manager-v1',JSON.stringify({version:1,goals:{daily:100000,monthly:2500000},workdays:[2,3,4,5],rides:[{id:'old',date:'2026-10-06',fare:30000,fee:6000,expense:1000,from:'군포',to:'서울',memo:''}]})));
 const legacyPage=await legacyContext.newPage();await legacyPage.goto(process.env.TEST_URL||'http://127.0.0.1:8001/');await legacyPage.waitForFunction(()=>ready);assert.equal(await legacyPage.evaluate(()=>total(records())),23000);
 await browser.close();console.log('PASS: 일지 순수익·시간, 사진 저장, 재접속, 수정, 잘못된 시간 방어, 사진 포함 백업/복원, 휴무/추가일 계획, 중복 방지, 모바일 메뉴, 오프라인, 기존 데이터 이전');
})().catch(e=>{console.error(e);process.exit(1)});
