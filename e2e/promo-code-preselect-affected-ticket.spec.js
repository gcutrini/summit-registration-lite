const { test, expect } = require('@playwright/test');
const {
    ticketType,
    discoveryResponse,
    ticketTypesResponse,
    taxTypesResponse,
    validationResponse,
    discoveredCode,
} = require('./fixtures');

// Applying a code should point the user at what it changed. The discovered-code
// path already does this from the code's allowed_ticket_types; a manually typed
// code has no such list, so what it affected is read off the refreshed catalog:
// a ticket that was not there before was unlocked, and one the API marks with
// cost_with_applied_discount was discounted.
//
// Only one affected ticket is unambiguous. Several means the user has a real
// choice, so the widget leaves it to them.

// The catalog is fetched once plainly and again filtered by the applied code,
// which is what lets a code reveal a ticket that was not on offer before.
const setupRoutes = async (page, { before, after, discovery = [], unfilteredDelayMs = 0 }) => {
    await page.route('**/promo-codes/all/discover*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(discoveryResponse(discovery)) })
    );
    await page.route('**/ticket-types/allowed*', async route => {
        const filtered = route.request().url().includes('promo_code');
        // Removing a code refetches unfiltered; delaying that is how a test can
        // sit inside the window where the store still holds the filtered list.
        if (!filtered && unfilteredDelayMs) {
            await new Promise(r => setTimeout(r, unfilteredDelayMs));
        }
        route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify(ticketTypesResponse(filtered ? after : before)),
        });
    });
    await page.route('**/tax-types*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(taxTypesResponse()) })
    );
    await page.route('**/promo-codes/*/apply*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(validationResponse()) })
    );
};

const apply = async (page, code) => {
    await page.fill('input[placeholder="Enter your promo code"]', code);
    await page.click('button:has-text("Apply")');
    // Wait for the apply to settle before anything is asserted. Remove appearing
    // means the code took; network idle means the code-filtered catalog landed,
    // which is what the selection is derived from. Asserting earlier reads the
    // pre-apply screen, where "nothing selected" is trivially true and a wrong
    // selection arriving a moment later goes unnoticed.
    await expect(page.locator('button:has-text("Remove")')).toBeVisible();
    await page.waitForLoadState('networkidle');
};

const selected = (page) => page.locator('[data-testid="selected-ticket"]');
const nothingSelected = (page) => page.getByTestId('no-ticket');

const general = ticketType({ id: 188, name: 'General Ticket' });
const sponsor = ticketType({ id: 300, name: 'Sponsor Ticket' });
const workshop = ticketType({ id: 301, name: 'Workshop Ticket' });
const discounted = (t) => ({ ...t, cost_with_applied_discount: t.cost / 2 });

test('pre-selects the only ticket a manual code unlocks', async ({ page }) => {
    // Sponsor Ticket is not on offer until the code is applied.
    await setupRoutes(page, { before: [general], after: [general, sponsor] });
    await page.goto('/');

    await apply(page, 'SPONSOR');

    await expect(selected(page)).toContainText('Sponsor Ticket');
});

test('pre-selects the only ticket a manual code discounts', async ({ page }) => {
    // Nothing is unlocked; the API marks one existing ticket as discounted.
    await setupRoutes(page, {
        before: [general, sponsor],
        after: [general, discounted(sponsor)],
    });
    await page.goto('/');

    await apply(page, 'HALFOFF');

    await expect(selected(page)).toContainText('Sponsor Ticket');
});

test('selects nothing when a manual code affects more than one ticket', async ({ page }) => {
    // Two unlocked. The user has a real choice, so making it for them would
    // hide the other option.
    await setupRoutes(page, { before: [general], after: [general, sponsor, workshop] });
    await page.goto('/');

    await apply(page, 'BOTH');

    await expect(nothingSelected(page)).toBeVisible();
});

test('selects nothing when a code unlocks one ticket and discounts another', async ({ page }) => {
    // One of each is still two affected tickets.
    await setupRoutes(page, {
        before: [general, sponsor],
        after: [discounted(general), sponsor, workshop],
    });
    await page.goto('/');

    await apply(page, 'MIXED');

    await expect(nothingSelected(page)).toBeVisible();
});

test('leaves an already chosen ticket alone', async ({ page }) => {
    // The user picked this deliberately, so applying a code does not move them.
    await setupRoutes(page, { before: [general, sponsor], after: [general, discounted(sponsor)] });
    await page.goto('/');

    await page.locator('[data-testid="ticket-dropdown"]').click();
    await page.locator('[data-testid="ticket-list"] >> text=General Ticket').click();
    await expect(selected(page)).toContainText('General Ticket');

    await apply(page, 'HALFOFF');

    await expect(selected(page)).toContainText('General Ticket');
});

test('pre-selects for a manual code even when the summit has a suggestion', async ({ page }) => {
    // Discovery runs for every logged-in user, so a suggestion is usually
    // present. It describes a different code than the one being applied and
    // must not decide the selection for it.
    await setupRoutes(page, {
        before: [general],
        after: [general, sponsor],
        discovery: [discoveredCode({ auto_apply: false, code: 'EARLYBIRD', allowed_ticket_types: [188] })],
    });
    await page.goto('/');

    await apply(page, 'SPONSOR');

    await expect(selected(page)).toContainText('Sponsor Ticket');
});

test('never pre-selects a ticket outside its sales window', async ({ page }) => {
    // The code unlocks a ticket whose sales window has closed. The dropdown
    // cannot show it, so selecting it would strand the user on a ticket they
    // can neither see nor change. Two in-window tickets so the single-ticket
    // fallback cannot mask a wrong pick.
    const expired = ticketType({
        id: 400, name: 'Expired Sponsor Ticket',
        sales_start_date: 1000000, sales_end_date: 2000000,
    });
    await setupRoutes(page, {
        before: [general, sponsor],
        after: [general, sponsor, expired],
    });
    await page.goto('/');

    await apply(page, 'EXPIREDUNLOCK');

    await expect(nothingSelected(page)).toBeVisible();
});

test('a discovered code still selects from the tickets it names', async ({ page }) => {
    // The discovered path is unchanged by this work, but nothing pinned it: the
    // other discovery specs return the same catalog whether or not the code is
    // applied, so the catalog diff is empty there and the single-ticket
    // fallback covers for the branch. Here the code discounts Workshop while
    // naming General, and both are in window, so the two rules disagree and
    // only the code's own list can produce the expected answer.
    await setupRoutes(page, {
        before: [general, workshop],
        after: [general, discounted(workshop)],
        discovery: [discoveredCode({
            auto_apply: true, code: 'EARLYBIRD', allowed_ticket_types: [188],
        })],
    });
    await page.goto('/');

    await expect(selected(page)).toContainText('General Ticket');
});

test('does not let a code be re-applied against the catalog of the last one', async ({ page }) => {
    // Removing refetches the catalog without the code. Until that lands the
    // store still lists the ticket the code unlocked, so applying again in that
    // window would compare the new catalog against one that already contained
    // it and conclude the code changed nothing. Applying has to wait for the
    // removal to finish.
    await setupRoutes(page, {
        before: [general],
        after: [general, sponsor],
        unfilteredDelayMs: 1500,
    });
    await page.goto('/');

    await apply(page, 'SPONSOR');
    await expect(selected(page)).toContainText('Sponsor Ticket');

    await page.click('button:has-text("Remove")');
    // The field is busy while the catalog is refetched, so the code cannot be
    // re-applied against the stale one.
    await expect(page.getByTestId('promo-spinner')).toBeVisible();

    await apply(page, 'SPONSOR');
    await expect(selected(page)).toContainText('Sponsor Ticket');
});

