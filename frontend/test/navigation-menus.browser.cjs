// Run against a frontend started with NEXT_PUBLIC_API_BASE_URL=http://localhost:4499 on port 3370.
// All API calls are intercepted; no database is used. Requires Playwright WebKit and Chromium.
// Optional MEDISLOT_PLAYWRIGHT module path and MEDISLOT_CHROMIUM_EXECUTABLE override.
const { chromium, webkit } = require(process.env.MEDISLOT_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const role = process.env.MEDISLOT_BROWSER_ROLE || 'ADMIN';
assert.ok(['ADMIN', 'MANAGER'].includes(role));
const allCases = [['Scheduling', 'Schedule', '/calendars', 'Doctor availability'], ['Scheduling', 'Generate schedule', '/schedule-generation', 'Generate schedule preview'], ['Scheduling', 'Doctor unavailability', '/doctor-unavailability', 'Doctor unavailability'], ['People', 'Users', '/users', 'People directory'], ['People', 'Doctors', '/doctors', 'Doctor management'], ['People', 'Receptionists', '/receptionists', 'Receptionist management'], ['People', 'Managers', '/managers', 'Managers'], ['Account', 'Profile', '/profile', 'My account']];
const managerRows = [
    {id:101, status:'CONFIRMED', disruption:null},
    {id:102, status:'NEEDS_RESCHEDULING', disruption:{notificationId:202,disruptionVersion:2}},
    {id:103, status:'NEEDS_RESCHEDULING', disruption:null},
].map(a => ({...a, version:2, calendarId:a.id+1000, patientId:10, doctorId:20, reason:'Synthetic browser visit', slotStartTime:'2037-02-01T10:00:00Z', slotEndTime:'2037-02-01T10:30:00Z', rescheduleCount:0, patient:{id:10,name:'Synthetic patient',closedAt:null}, doctor:{id:20,userId:20,specialization:'ENT',user:{id:20,name:'Synthetic doctor'}}}));
const cases = allCases.filter(([menu]) => role === 'ADMIN' || menu !== 'People');
(async () => {
    for (const engine of process.argv.slice(2).length ? process.argv.slice(2) : ['webkit', 'chromium']) {
        const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(engine === 'chromium' && process.env.MEDISLOT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.MEDISLOT_CHROMIUM_EXECUTABLE } : {}) });
        try {
            const ctx = await browser.newContext();
            await ctx.addInitScript((role) => { if (!sessionStorage.getItem('seeded')) {
                localStorage.setItem('medislot.auth', JSON.stringify({ userId: 1, role, token: 'mock-admin', sessionId: 'mock-session' }));
                sessionStorage.setItem('seeded', '1');
            } window.events = []; for (const type of ['pointerdown', 'mousedown', 'blur', 'focusout', 'mouseup', 'click'])
                document.addEventListener(type, e => { window.events.push({ type, target: e.target.textContent?.slice(0, 45), related: e.relatedTarget?.textContent?.slice(0, 45), menu: !!document.querySelector('[role=menu]') }); }, true); }, role);
            await ctx.route('http://localhost:4499/**', route => { const p = new URL(route.request().url()).pathname; if (role === 'MANAGER' && p === '/appointments') return route.fulfill({json:{data:managerRows.filter(a => !new URL(route.request().url()).searchParams.get('status') || a.status === new URL(route.request().url()).searchParams.get('status'))}});
                if (role === 'MANAGER' && /^\/appointments\/\d+\/(alternatives|reschedule-options)$/.test(p)) return route.fulfill({json:{appointment:managerRows.find(a=>a.id===Number(p.split('/')[2])), data:[],window:{startDate:'2037-02-01',endDate:'2037-02-15',timeZone:'Europe/Warsaw'},keepYourDay:[],keepYourDoctor:[]}});
                if (p === '/sessions') return route.fulfill({ json: { accessToken: 'e30.' + Buffer.from(JSON.stringify({ sub: 1, role })).toString('base64url') + '.mock', tokenType: 'Bearer' } }); return route.fulfill({ json: /^\/users\/\d+$/.test(p) ? { id: 1, name: 'Mock Admin', email: 'admin@example.test', role } : { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } }); });
            const page = await ctx.newPage();
            page.setDefaultTimeout(10000);
            await page.goto('http://localhost:3370/appointments');
            await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
            if (role === 'MANAGER') {
                assert.deepEqual(await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link').allTextContents(), ['Appointments', 'Follow-up']);
                assert.equal(await page.getByRole('button', { name: 'People', exact: true }).count(), 0);
                assert.equal(await page.getByRole('button', { name: 'Create appointment', exact: true }).count(), 0);
                const ordinary = page.locator('[aria-label="Appointment 101 status actions"]');
                const disrupted = page.locator('[aria-label="Appointment 102 status actions"]');
                await disrupted.getByRole('button',{name:'Cancel',exact:true}).waitFor();
                assert.equal(await ordinary.getByRole('button').count(),0);
                assert.equal(await page.getByRole('button',{name:'Complete',exact:true}).count(),0);
                assert.equal(await page.getByRole('button',{name:'No-show',exact:true}).count(),0);
                for (const id of [102,103]) {
                    const actions = page.locator(`[aria-label="Appointment ${id} status actions"]`);
                    await actions.getByRole('button',{name:'Cancel',exact:true}).click();
                    await actions.getByRole('button',{name:'Confirm cancellation',exact:true}).waitFor();
                    await actions.getByRole('button',{name:'Keep appointment',exact:true}).click();
                    await page.locator('tr').filter({has:actions}).getByRole('button',{name:'Reschedule',exact:true}).click();
                    await page.getByRole('region',{name:'Reschedule appointment',exact:true}).waitFor();
                    await page.getByRole('button',{name:'Close rescheduling',exact:true}).click();
                }
                console.log('PASS manager ordinary actions hidden; current and legacy disrupted row confirmations/recovery open and close',engine);
            }
            for (const width of [1280, 375]) {
                await page.setViewportSize({ width, height: 900 });
                for (const [menu, name, path, heading] of cases) {
                    await page.getByRole('button', { name: menu, exact: true }).click();
                    const item = page.getByRole('menuitem', { name, exact: true });
                    await item.waitFor();
                    await page.waitForTimeout(80);
                    await item.scrollIntoViewIfNeeded();
                    const box = await item.boundingBox();
                    const hit = await item.evaluate(el => { const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { hit: hit?.closest('a,button') === el, pointerEvents: getComputedStyle(el).pointerEvents, href: el.getAttribute('href') }; });
                    await page.evaluate(() => window.events = []);
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    await page.waitForURL(u => u.pathname === path, { timeout: 10000 }).catch(() => { });
                    const ok = new URL(page.url()).pathname === path;
                    console.log(JSON.stringify({ engine, width, menu, name, ok, url: page.url(), hit, events: await page.evaluate(() => window.events) }));
                    if (!ok) {
                        if (process.env.REPRO === '1')
                            continue;
                        throw Error('Pointer navigation failed ' + engine + ' ' + name);
                    }
                    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
                    assert.ok((await page.getByRole('button', { name: menu, exact: true }).getAttribute('class')).includes('active'));
                }
                await page.getByRole('link', { name: 'Appointments', exact: true }).click();
                await page.waitForURL(u => u.pathname === '/appointments');
                await page.getByRole('heading', { name: 'Appointment management', exact: true }).waitFor();
                await page.getByRole('link', { name: 'Follow-up', exact: true }).click();
                await page.waitForURL(u => u.pathname === '/rescheduling/follow-ups');
                await page.getByRole('heading', { name: 'Rescheduling follow-up', exact: true }).waitFor();
                const trigger = page.getByRole('button', { name: 'Scheduling', exact: true });
                await trigger.focus();
                await page.keyboard.press('ArrowDown');
                await page.waitForFunction(() => document.activeElement?.textContent === 'Schedule');
                await page.keyboard.press('End');
                await page.waitForFunction(() => document.activeElement?.textContent === 'Doctor unavailability');
                await page.keyboard.press('Home');
                await page.waitForFunction(() => document.activeElement?.textContent === 'Schedule');
                await page.keyboard.press('Escape');
                assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
                assert.equal(await trigger.evaluate(e => e === document.activeElement), true);
                await trigger.click();
                await page.getByRole('heading').first().click();
                assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
                await trigger.focus();
                await page.keyboard.press('ArrowDown');
                await page.waitForFunction(() => document.activeElement?.textContent === 'Schedule');
                await page.keyboard.press('End');
                await page.keyboard.press('Tab');
                assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                console.log('PASS keyboard/Escape/outside-click/Tab dismissal and layout', engine, width);
            }
            // Account action uses the same pointer path.
            await page.getByRole('button', { name: 'Account', exact: true }).click();
            await page.waitForTimeout(80);
            const logout = page.getByRole('menuitem', { name: 'Logout', exact: true }), box = await logout.boundingBox();
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForURL(u => u.pathname === '/login', { timeout: 10000 }).catch(() => { });
            console.log(engine, 'LOGOUT', new URL(page.url()).pathname, await page.evaluate(() => localStorage.getItem('medislot.auth')));
            if (process.env.REPRO !== '1') {
                assert.equal(new URL(page.url()).pathname, '/login');
                assert.equal(await page.evaluate(() => localStorage.getItem('medislot.auth')), null);
            }
            if (role === 'MANAGER') {
                async function login(next = '') {
                    await page.goto('http://localhost:3370/login' + next);
                    await page.getByLabel('Email', { exact: true }).fill('manager@example.test');
                    await page.getByLabel('Password', { exact: true }).fill('Synthetic123!');
                    await page.getByRole('button', { name: 'Log in', exact: true }).click();
                }
                await login(); await page.waitForURL(u => u.pathname === '/appointments');
                await page.goto('http://localhost:3370/', { waitUntil: 'commit' }); await page.waitForURL(u => u.pathname === '/appointments');
                await page.evaluate(() => localStorage.clear());
                await login('?next=%2Fappointments%3Freschedule%3D123');
                await page.waitForURL(u => u.pathname === '/appointments' && u.searchParams.get('reschedule') === '123');
                console.log('PASS manager landing/dashboard and validated recovery return', engine);
            }
            await ctx.close();
        }
        finally {
            await browser.close();
        }
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
