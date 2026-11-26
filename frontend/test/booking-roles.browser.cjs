// Start frontend with NEXT_PUBLIC_API_BASE_URL=http://localhost:4499 on port 3370.
// Mocked APIs only; real authority and database preservation use booking-roles.integration.ts.
const { chromium } = require(process.env.MEDISLOT_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ headless: true, ...(process.env.MEDISLOT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.MEDISLOT_CHROMIUM_EXECUTABLE } : {}) });
    try {
        for (const role of ['ADMIN', 'MANAGER', 'DOCTOR', 'RECEPTIONIST', 'PATIENT']) {
            const ctx = await browser.newContext();
            await ctx.addInitScript(role => localStorage.setItem('medislot.auth', JSON.stringify({ userId: 1, role, token: 'synthetic', sessionId: 'synthetic' })), role);
            const doctor = { id: 2, userId: 2, specialization: 'ENT', user: { id: 2, name: 'Synthetic doctor', email: 'doctor@example.test', role: 'DOCTOR' } }, patient = { id: 3, name: 'Synthetic patient', email: 'patient@example.test', role: 'PATIENT' };
            const slot = { id: 10, doctorId: 2, startTime: '2037-02-01T10:00:00Z', endTime: '2037-02-01T10:30:00Z', isBooked: false, isBlocked: false, doctor };
            let posts = 0, appointment;
            await ctx.route('http://localhost:4499/**', async (route) => {
                const r = route.request(), path = new URL(r.url()).pathname;
                let body = { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } };
                if (path === '/appointments' && r.method() === 'POST') {
                    assert.ok(['RECEPTIONIST', 'PATIENT'].includes(role));
                    const b = r.postDataJSON();
                    posts++;
                    appointment = { id: 100, ...b, version: 1, status: 'CONFIRMED', slotStartTime: slot.startTime, slotEndTime: slot.endTime, doctor, patient };
                    return route.fulfill({ status: 201, json: appointment });
                }
                if (/^\/users\/\d+$/.test(path))
                    body = { id: 1, name: 'Synthetic ' + role, email: 'user@example.test', role };
                else if (path === '/users')
                    body = { data: [patient], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } };
                else if (path === '/doctors')
                    body = { data: [doctor] };
                else if (path === '/calendars')
                    body = { data: posts ? [] : [slot] };
                else if (path === '/appointments' || path.endsWith('/appointments'))
                    body = { data: appointment ? [appointment] : [] };
                await route.fulfill({ json: body });
            });
            const page = await ctx.newPage();
            page.setDefaultTimeout(20000);
            await page.goto('http://localhost:3370/appointments');
            await page.getByRole('heading', { name: role === 'PATIENT' ? 'My appointments' : 'Appointment management', exact: true }).waitFor();
            if (['ADMIN', 'MANAGER', 'DOCTOR'].includes(role)) {
                assert.equal(await page.getByRole('heading', { name: 'Create appointment', exact: true }).count(), 0);
                assert.equal(await page.getByRole('button', { name: 'Create appointment', exact: true }).count(), 0);
                assert.equal(await page.getByLabel('Patient search', { exact: true }).count(), 0);
                console.log('PASS no booking form', role);
            }
            if (role === 'RECEPTIONIST') {
                await page.getByRole('button', { name: 'Create appointment', exact: true }).click();
                await page.getByLabel('Patient search', { exact: true }).fill('Synthetic');
                await page.locator('select[name="patientId"] option[value="3"]').waitFor({ state: 'attached' });
                await page.locator('select[name="patientId"]').selectOption('3');
                await page.locator('select[name="doctorId"]').selectOption('2');
                await page.locator('select[name="calendarId"] option[value="10"]').waitFor({ state: 'attached' });
                await page.locator('select[name="calendarId"]').selectOption('10');
                await page.getByLabel('Reason', { exact: true }).fill('Preserved staff reason');
                await page.getByRole('button', { name: 'Create appointment', exact: true }).click();
                await page.getByText(/Appointment confirmed:/).waitFor();
                assert.equal(posts, 1);
                assert.equal(appointment.patientId, 3);
                console.log('PASS receptionist form submits one booking and shows success');
            }
            if (role === 'PATIENT') {
                assert.equal(await page.getByRole('button', { name: 'Create appointment', exact: true }).count(), 0);
                await page.getByRole('link', { name: 'Book appointment', exact: true }).click();
                await page.getByRole('button', { name: 'Select slot', exact: true }).click();
                await page.getByLabel('Visit reason', { exact: true }).fill('Preserved patient reason');
                await page.getByRole('button', { name: 'Review booking', exact: true }).click();
                assert.equal(posts, 0);
                await page.getByRole('button', { name: 'Confirm booking', exact: true }).click();
                await page.getByRole('link', { name: 'View my appointments', exact: true }).waitFor();
                assert.equal(posts, 1);
                assert.equal(appointment.patientId, 1);
                console.log('PASS patient selection/review/explicit confirmation submits one own booking');
            }
            await ctx.close();
        }
    }
    finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
