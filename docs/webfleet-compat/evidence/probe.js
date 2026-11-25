const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'es-ES' });
  const p = await ctx.newPage();
  const log = [];
  p.on('request', r => { if (['fetch','xhr'].includes(r.resourceType())) log.push({t:'req', m:r.method(), u:r.url(), h:r.headers(), d:r.postData()}); });
  p.on('response', async r => { const q=r.request(); if (['fetch','xhr'].includes(q.resourceType())) { let body=''; try{ body=(await r.text()).slice(0,1500);}catch{} log.push({t:'res', s:r.status(), u:r.url(), ct:r.headers()['content-type'], body}); }});
  const resp = await p.goto('https://link-compatibility.webfleet.com/?locale=es_es', {waitUntil:'networkidle', timeout:60000}).catch(e=>console.log('ERR',e.message));
  console.log('status', resp && resp.status());
  console.log('title', await p.title());
  console.log((await p.innerText('body').catch(()=>'')).slice(0,1500));
  console.log(JSON.stringify(log,null,1));
  await b.close();
})();
