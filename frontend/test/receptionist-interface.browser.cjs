// Mock-only browser regression. Start frontend on 3370 with API base http://localhost:4499.
const { chromium, webkit } = require(process.env.MEDISLOT_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
(async () => {
    for (const engine of ['webkit', 'chromium']) {
        const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(engine === 'chromium' && process.env.MEDISLOT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.MEDISLOT_CHROMIUM_EXECUTABLE } : {}) });
        try {
            const ctx = await browser.newContext(), page = await ctx.newPage();
            page.setDefaultTimeout(15000);
            const patient = { id: 3, name: 'Synthetic patient', email: 'patient@example.test', role: 'PATIENT' }, doctor = { id: 2, userId: 2, specialization: 'ENT', user: { id: 2, name: 'Synthetic doctor', email: 'doctor@example.test', role: 'DOCTOR' } };
            const slot = { id: 10, doctorId: 2, startTime: '2037-02-01T10:00:00Z', endTime: '2037-02-01T10:30:00Z', isBooked: false, isBlocked: false, doctor }, alternative = { ...slot, id: 11, startTime: '2037-02-01T11:00:00Z', endTime: '2037-02-01T11:30:00Z' };
            const original = { id: 80, patientId: 3, doctorId: 2, calendarId: 80, status: 'CONFIRMED', version: 1, reason: 'Existing visit', slotStartTime: '2038-01-01T10:00:00Z', slotEndTime: '2038-01-01T10:30:00Z', patient, doctor };
            let rows = [original], posts = [], reads = 0, mode = 'validation', release, entered, hold, ready, patientRelease, patientHit;
            const gate = () => { hold = new Promise(r => release = r); ready = new Promise(r => entered = r); };
            await ctx.route('http://localhost:4499/**', async (route) => {
                const r = route.request(), u = new URL(r.url()), p = u.pathname;
                let data = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };
                if (p === '/sessions')
                    return route.fulfill({ status: 201, json: { accessToken: 'e30.' + Buffer.from(JSON.stringify({ sub: 1, role: 'RECEPTIONIST' })).toString('base64url') + '.mock', tokenType: 'Bearer' } });
                if (p === '/appointments' && r.method() === 'POST') {
                    const body = r.postDataJSON();
                    posts.push(body);
                    if (mode === 'validation')
                        return route.fulfill({ status: 400, json: { code: 'BAD_REQUEST', message: 'Synthetic validation error' } });
                    if (mode === 'taken')
                        return route.fulfill({ status: 409, json: { code: 'SLOT_UNAVAILABLE', message: 'Selected calendar slot is no longer available' } });
                    if (mode === 'held') {
                        entered();
                        await hold;
                    }
                    const a = { ...original, ...body, id: 100, status: 'CONFIRMED', version: 1, slotStartTime: alternative.startTime, slotEndTime: alternative.endTime };
                    rows.push(a);
                    return route.fulfill({ status: 201, json: a });
                }
                if (p === '/appointments/80' && r.method() === 'PUT') {
                    entered();
                    await hold;
                    rows = [{ ...original, status: 'CANCELLED', version: 2 }];
                    return route.fulfill({ json: rows[0] });
                }
                if (p === '/appointments') {
                    reads++;
                    data = { data: rows };
                }
                else if (p === '/appointments/99')
                    data = { ...original, id: 99, status: 'NEEDS_RESCHEDULING', version: 2, disruption: { notificationId: 9, disruptionVersion: 2 } };
                else if (p.endsWith('/alternatives') && p.startsWith('/appointments'))
                    data = { appointment: { ...original, id: 99, status: 'NEEDS_RESCHEDULING', version: 2 }, window: { startDate: '2037-02-01', endDate: '2037-02-15', timeZone: 'Europe/Warsaw' }, keepYourDay: [], keepYourDoctor: [] };
                else if (p === '/calendars/10/alternatives')
                    data = { requestedSlot: slot, patientId: 3, sameDay: [alternative], laterDates: [] };
                else if (p === '/users/1')
                    data = { id: 1, name: 'Synthetic receptionist', email: 'rec@example.test', role: 'RECEPTIONIST' };
                else if (p === '/users') {
                    if (patientRelease) {
                        patientHit();
                        await patientRelease;
                        patientRelease = null;
                    }
                    data = { data: [patient], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } };
                }
                else if (p === '/doctors')
                    data = { data: [doctor] };
                else if (p === '/calendars')
                    data = { data: [slot, alternative] };
                await route.fulfill({ json: data });
            });
            async function login(next = '') { await page.goto('http://localhost:3370/login' + next); await page.getByLabel('Email', { exact: true }).fill('rec@example.test'); await page.getByLabel('Password', { exact: true }).fill('Synthetic123!'); await page.getByRole('button', { name: 'Log in', exact: true }).click(); }
            await login();
            await page.waitForURL(u => u.pathname === '/appointments');
            const nav = page.getByRole('navigation', { name: 'Main navigation' });
            assert.deepEqual(await nav.getByRole('link').allTextContents(), ['Appointments', 'Follow-up']);
            assert.deepEqual(await nav.getByRole('button').allTextContents(), []);
            const form = page.getByRole('form', { name: 'Create appointment', exact: true }), toggle = () => page.getByRole('button', { name: 'Create appointment', exact: true }), close = () => page.getByRole('button', { name: 'Close form', exact: true });
            assert.equal(await form.count(), 0);
            await toggle().focus();
            await page.keyboard.press('Enter');
            await form.waitFor();
            assert.equal(await close().getAttribute('aria-expanded'), 'true');
            await close().click();
            assert.equal(await form.count(), 0);
            assert.equal(posts.length, 0);
            // A patient search completing after closure must not restore old options.
            await toggle().click();
            let unblock;
            patientRelease = new Promise(r => unblock = r);
            const reached = new Promise(r => patientHit = r);
            await form.getByLabel('Patient search', { exact: true }).fill('Synthetic');
            await reached;
            await close().click();
            unblock();
            await page.waitForTimeout(100);
            await toggle().click();
            assert.equal(await form.locator('select[name="patientId"] option').count(), 1);
            async function fill() { await form.getByLabel('Patient search', { exact: true }).fill('Synthetic'); await form.locator('select[name="patientId"] option[value="3"]').waitFor({ state: 'attached' }); await form.locator('select[name="patientId"]').selectOption('3'); await form.locator('select[name="doctorId"]').selectOption('2'); await form.locator('select[name="calendarId"] option[value="10"]').waitFor({ state: 'attached' }); await form.locator('select[name="calendarId"]').selectOption('10'); await form.getByLabel('Reason', { exact: true }).fill('Preserved receptionist reason'); }
            await fill();
            // Status leases also protect the open form; a refresh must wait for the mutation.
            gate();
            const actions = page.locator('[aria-label="Appointment 80 status actions"]');
            await actions.getByRole('button', { name: 'Cancel', exact: true }).click();
            await actions.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
            await ready;
            assert.equal(await close().isDisabled(), true);
            await form.evaluate(f => f.requestSubmit());
            assert.equal(posts.length, 0);
            const previous = reads;
            await page.evaluate(() => window.dispatchEvent(new Event('medislot-auth-changed')));
            await page.waitForTimeout(80);
            assert.equal(reads, previous);
            release();
            await page.getByText('Appointment updated.', { exact: true }).waitFor();
            await page.waitForFunction(() => !document.querySelector('button[aria-controls="receptionist-booking-form"]').disabled);
            assert.equal(await form.getByLabel('Reason', { exact: true }).inputValue(), 'Preserved receptionist reason');
            await form.getByRole('button', { name: 'Create appointment', exact: true }).click();
            await page.getByText('Synthetic validation error', { exact: true }).waitFor();
            assert.equal(await form.getByLabel('Reason', { exact: true }).inputValue(), 'Preserved receptionist reason');
            assert.equal(await form.locator('select[name="patientId"]').inputValue(), '3');
            mode = 'taken';
            await form.getByRole('button', { name: 'Create appointment', exact: true }).click();
            const alternatives = page.getByRole('region', { name: 'Booking alternatives', exact: true });
            await alternatives.getByRole('button', { name: /^Review booking on / }).click();
            const confirmation = page.getByRole('region', { name: 'Booking confirmation', exact: true });
            await confirmation.getByText('Visit reason: Preserved receptionist reason', { exact: true }).waitFor();
            assert.equal(posts.length, 2);
            assert.equal(await form.locator('select[name="patientId"]').inputValue(), '3');
            mode = 'held';
            gate();
            await confirmation.getByRole('button', { name: 'Confirm booking', exact: true }).click();
            await ready;
            assert.equal(await close().isDisabled(), true);
            assert.equal(await form.locator('fieldset').evaluate(e => e.disabled), true);
            await close().evaluate(e => e.click());
            await form.evaluate(f => f.requestSubmit());
            await confirmation.getByRole('button', { name: 'Booking…', exact: true }).evaluate(e => e.click());
            assert.equal(posts.length, 3);
            assert.equal(await form.count(), 1);
            const readBefore = reads;
            await page.evaluate(() => window.dispatchEvent(new Event('medislot-auth-changed')));
            await page.waitForTimeout(80);
            assert.equal(reads, readBefore);
            release();
            await page.getByText(/Appointment confirmed:/).waitFor();
            await page.getByRole('cell', { name: /Preserved receptionist reason/ }).waitFor();
            assert.equal(await form.count(), 0);
            await toggle().click();
            assert.equal(await form.getByLabel('Reason', { exact: true }).inputValue(), '');
            assert.equal(await form.locator('select[name="patientId"]').inputValue(), '');
            assert.equal(await form.locator('select[name="doctorId"]').inputValue(), '');
            assert.deepEqual(posts.map(b => b.patientId), [3, 3, 3]);
            assert.equal(posts[2].calendarId, 11);
            await close().click();
            console.log('PASS', engine, 'open/close no writes; late search ignored; status/booking leases and queued refresh; errors preserve fields; explicit taken-slot recovery; duplicate/close guard; success refresh and reset');
            await page.goto('http://localhost:3370/', { waitUntil: 'commit' }).catch(error => { if (!error.message.includes('interrupted by another navigation to \"http://localhost:3370/appointments\"'))
                throw error; });
            await page.waitForURL(u => u.pathname === '/appointments');
            await page.evaluate(() => localStorage.clear());
            await login('?next=%2Fappointments%3Freschedule%3D99');
            await page.waitForURL(u => u.searchParams.get('reschedule') === '99');
            await page.getByRole('heading', { name: 'Reschedule appointment #99', exact: true }).waitFor();
            await page.getByRole('button', { name: 'Close rescheduling', exact: true }).click();
            for (const width of [1280, 375]) {
                await page.setViewportSize({ width, height: 900 });
                const account = page.getByRole('button', { name: 'Account', exact: true });
                await account.focus();
                await page.keyboard.press('ArrowDown');
                await page.waitForFunction(() => document.activeElement?.textContent === 'Profile');
                await page.keyboard.press('End');
                await page.waitForFunction(() => document.activeElement?.textContent === 'Logout');
                await page.keyboard.press('Escape');
                assert.equal(await account.getAttribute('aria-expanded'), 'false');
                await account.click();
                await page.getByRole('heading').first().click();
                assert.equal(await account.getAttribute('aria-expanded'), 'false');
                await account.click();
                await page.getByRole('menuitem', { name: 'Profile', exact: true }).click();
                await page.waitForURL(u => u.pathname === '/profile');
                await page.getByRole('heading', { name: 'My account', exact: true }).waitFor();
                await nav.getByRole('link', { name: 'Follow-up', exact: true }).click();
                await page.waitForURL(u => u.pathname === '/rescheduling/follow-ups');
                await page.getByRole('heading', { name: 'Rescheduling follow-up', exact: true }).waitFor();
                await nav.getByRole('link', { name: 'Appointments', exact: true }).click();
                await page.waitForURL(u => u.pathname === '/appointments');
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            }
            await page.getByRole('button', { name: 'Account', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Logout', exact: true }).click();
            await page.waitForURL(u => u.pathname === '/login');
            assert.equal(await page.evaluate(() => localStorage.getItem('medislot.auth')), null);
            console.log('PASS', engine, 'normal/home landing, validated recovery deep link, desktop/mobile Account pointer clicks, keyboard/Escape/outside click, Follow-up and Logout');
            await ctx.close();
        }
        finally {
            await browser.close();
        }
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
