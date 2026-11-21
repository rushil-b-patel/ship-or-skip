// npm test: one-response rule, results privacy + anonymity, scoring, tabs + search, HTML escaping, security headers.
process.env.DB = ':memory:';
const assert = require('node:assert/strict');
const { server, summarize } = require('./server');

// Cost is inverted: all-10s = (10 + 10 + 10 + 10 + 1) / 5
assert.equal(summarize([{ reach: 10, pain: 10, evidence: 10, business: 10, cost: 10 }]).overall, 8.2);
assert.equal(summarize([{ reach: 1, pain: 1, evidence: 1, business: 1, cost: 1 }]).ship, false);   // (1+1+1+1+10)/5 = 2.8
// Not sure (null) drops out: (8 + 6 + 9 + (11 - 2)) / 4
assert.equal(summarize([{ reach: 8, pain: 6, evidence: null, business: 9, cost: 2 }]).overall, 8);

server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const post = (path, data, cookie = '') => fetch(base + path, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams(data),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
  });
  const get = (path, cookie = '') => fetch(base + path, { headers: { cookie } });
  const cookieOf = res => res.headers.get('set-cookie').split(';')[0];

  try {
    let r = await post('/new', { title: '<b>CSV export', problem: 'Finance retypes invoices.', email: 'Asker@Co.com' });
    assert.equal(r.status, 303);
    const asker = cookieOf(r);
    const privateLink = r.headers.get('location');
    const id = privateLink.match(/\/p\/(\d+)/)[1];
    const home = await get('/');
    assert.match(await home.text(), /&#60;b&#62;CSV export/, 'titles are escaped');
    assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(home.headers.get('cache-control'), 'no-store', 'pages are per-browser, never cached');
    assert.equal((await fetch(base + '/new', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'cross-site posts are refused');

    const answer = { reach: 8, pain: 6, evidence: 'unsure', business: 9, cost: 2, email: 'a@co.com' };
    r = await post(`/p/${id}`, answer);
    assert.equal(r.status, 303);
    const alice = cookieOf(r);

    // Same browser, different email: not stored, shown the "already responded" state.
    await post(`/p/${id}`, { ...answer, email: 'b@co.com' }, alice);
    assert.match(await (await get(`/p/${id}`, alice)).text(), /You’ve responded/);

    // Home tabs + search: a response moves the proposal from Pending to Responded for that browser.
    assert.doesNotMatch(await (await get('/', alice)).text(), /CSV export/);
    assert.match(await (await get('/?tab=responded', alice)).text(), /CSV export/);
    assert.doesNotMatch(await (await get('/', asker)).text(), /CSV export/, 'your own proposal is not pending for you');
    assert.match(await (await get('/?tab=yours', asker)).text(), /CSV export/);
    assert.match(await (await get('/?q=csv')).text(), /CSV export/, 'search is case-insensitive');
    assert.doesNotMatch(await (await get('/?q=invoices%20nope')).text(), /CSV export/);
    assert.doesNotMatch(await (await get('/?q=%25')).text(), /CSV export/, '% is matched literally, not as a wildcard');

    // Same email, different browser: 409 with the form still filled in.
    r = await post(`/p/${id}`, { ...answer, email: ' A@co.com ' });
    assert.equal(r.status, 409);
    assert.match(await r.text(), /already responded/);

    // Bad input is rejected server-side, not just by the browser.
    assert.equal((await post(`/p/${id}`, { ...answer, reach: 11, email: 'c@co.com' })).status, 422);
    r = await post(`/p/${id}`, { reach: 'unsure', pain: 'unsure', evidence: 'unsure', business: 'unsure', cost: 'unsure', email: 'c@co.com' });
    assert.equal(r.status, 422);
    assert.match(await r.text(), /Score at least one question/);

    // Results: asker's browser or the private link only.
    assert.equal((await get(`/p/${id}/results`)).status, 403);
    assert.equal((await get(`/p/${id}/results`, alice)).status, 403);
    assert.equal((await get(`/p/${id}/results?key=nope`)).status, 403);
    assert.equal((await get(`/p/${id}/results`, asker)).status, 200);
    const results = await (await get(privateLink)).text();
    assert.ok(!['a@co.com', 'b@co.com', 'c@co.com'].some(e => results.includes(e)), 'results never show who answered');
    assert.match(results, />8\.0</, 'evidence was Not sure: (8 + 6 + 9 + (11 - 2)) / 4');
    assert.match(results, /Averaged over 1 response\b/);
    assert.match(results, /1 not sure/);
    assert.match(results, /Not sure answers are left out/);
    assert.match(results, /Ship it\./, '8.0 is above the 5.5 line');

    console.log('ok');
  } finally {
    server.close();
  }
});
