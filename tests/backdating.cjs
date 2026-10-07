const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-07T16:01:00Z'));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8007/');await page.waitForFunction(()=>ready);
  await page.locator('.bottom-nav [data-view=diary]').click();
  await page.locator('#diary-date').fill('2026-09-30');await page.locator('#diary-date').dispatchEvent('change');
  // An explicitly chosen past date must survive even before any earnings are entered.
  await page.reload();await page.waitForFunction(()=>ready);await page.locator('.bottom-nav [data-view=diary]').click();
  assert.equal(await page.locator('#diary-date').inputValue(),'2026-09-30');
  for(const[k,v]of Object.entries({start:'20:00',end:'02:00',count:'5',income:'123200',tips:'20000',transport:'18000'}))await page.locator(`[name=${k}]`).fill(v);
  assert.equal(await page.locator('#end-date').inputValue(),'2026-10-01');
  await page.locator('#diary-form [type=submit]').click();await page.waitForFunction(()=>state.diaries.length===1);
  assert.equal(await page.locator('#history-month').inputValue(),'2026-09');
  assert.equal(await page.locator('#month-income').textContent(),'0원');
  assert.match(await page.locator('#history-summary').textContent(),/125,200원/);
  assert.match(await page.locator('.income-line-chart > title').textContent(),/125,200원/);
  assert.equal(await page.locator('.income-day-row').count(),1);
  assert.equal(await page.locator('.income-day-row').getAttribute('data-date'),'2026-09-30');
  // Calendar entry opens a blank backdated form; an overnight log stays in its start month.
  await page.locator('#history-calendar [aria-label^="2026-09-02"]').click();await page.locator('#history-date-action').click();
  assert.equal(await page.locator('[name=income]').inputValue(),'');
  for(const[k,v]of Object.entries({start:'20:00',end:'23:00',count:'0',income:'0',transport:'18000'}))await page.locator(`[name=${k}]`).fill(v);
  await page.locator('#diary-form [type=submit]').click();await page.waitForFunction(()=>state.diaries.length===2);
  await page.locator('#history-calendar [aria-label^="2026-09-03"]').click();await page.locator('#history-date-action').click();
  for(const[k,v]of Object.entries({start:'20:00',end:'21:00',count:'0',income:'0'}))await page.locator(`[name=${k}]`).fill(v);
  await page.locator('#diary-form [type=submit]').click();await page.waitForFunction(()=>state.diaries.length===3);
  assert.deepEqual(await page.locator('.income-day-row').evaluateAll(rows=>rows.map(r=>r.dataset.date)),['2026-09-02','2026-09-03','2026-09-30']);
  assert.equal(await page.locator('.income-day-row.is-negative').count(),1);
  assert.equal(await page.locator('.income-day-row.is-zero').count(),1);
  assert.match(await page.locator('.income-line-chart > title').textContent(),/107,200원/);
  await page.locator('.income-day-row[data-date="2026-09-30"]').click();assert.equal(await page.locator('.diary-card').count(),1);
  await page.locator('.diary-card .secondary').click();await page.locator('[name=income]').fill('130000');
  await page.locator('#diary-form [type=submit]').click();await page.waitForFunction(()=>state.diaries.find(d=>d.date==='2026-09-30').income===130000);
  assert.equal(await page.evaluate(()=>state.diaries.length),3);assert.match(await page.locator('.income-line-chart > title').textContent(),/114,000원/);
  // Selecting an existing date cannot silently discard a different pending entry.
  await page.locator('.bottom-nav [data-view=diary]').click();await page.locator('[name=income]').fill('50000');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#diary-date').fill('2026-09-30');await page.locator('#diary-date').dispatchEvent('change');
  assert.equal(await page.locator('#diary-date').inputValue(),'2026-10-07');assert.equal(await page.locator('[name=income]').inputValue(),'50000');
  await page.locator('#reset-diary').click();await page.locator('[name=fatigue]').selectOption('3');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#diary-date').fill('2026-09-30');await page.locator('#diary-date').dispatchEvent('change');
  assert.equal(await page.locator('[name=fatigue]').inputValue(),'3');assert.equal(await page.locator('#diary-date').inputValue(),'2026-10-07');
  await page.locator('#reset-diary').click();await page.locator('#end-date').fill('2026-10-09');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#diary-date').fill('2026-09-30');await page.locator('#diary-date').dispatchEvent('change');
  assert.equal(await page.locator('#diary-date').inputValue(),'2026-10-07');
  await page.locator('#reset-diary').click();await page.locator('.bottom-nav [data-view=history]').click();await page.locator('#history-month').fill('2026-09');await page.locator('#history-month').dispatchEvent('change');
  for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}px history overflow`);}
  await page.screenshot({path:'/tmp/driver-diary-graphs.png',fullPage:true});
  await page.waitForFunction(async()=>!!await navigator.serviceWorker.getRegistration());await page.evaluate(()=>navigator.serviceWorker.ready);
  await context.setOffline(true);await page.reload();await page.waitForFunction(()=>ready);await page.locator('.bottom-nav [data-view=history]').click();await page.locator('#history-month').fill('2026-09');await page.locator('#history-month').dispatchEvent('change');assert.equal(await page.locator('.income-day-row').count(),3);
  assert.deepEqual(errors,[]);await browser.close();
  console.log('PASS: explicit past date draft, prior-month overnight save, calendar entry, chronological charts, negative/zero net, editing replaces one day, draft protection, mobile widths and offline charts');
})().catch(e=>{console.error(e);process.exit(1)});
