import { chromium } from 'playwright-core';

const clean = (value = '') => String(value).replace(/\s+/g, ' ').trim();

const formatDateForInput = (dateText = '') => {
    const date = new Date(dateText);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

export async function trackMaerskShipment(trackingNumber) {
    const executablePath = String(process.env.CHROME_EXECUTABLE_PATH || '').trim();
    if (!executablePath) {
        throw new Error('CHROME_EXECUTABLE_PATH is not configured');
    }

    const browser = await chromium.launch({
        headless: process.env.MAERSK_SCRAPER_HEADLESS !== 'false',
        executablePath,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
        ],
    });

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            viewport: { width: 1440, height: 900 },
        });
        const page = await context.newPage();

        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        await page.goto(`https://www.maersk.com/tracking/${encodeURIComponent(trackingNumber)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
        });

        try {
            await page.getByRole('button', { name: /allow all/i }).click({ timeout: 8000 });
        }
        catch {
            // The cookie prompt is not always shown.
        }

        await page.waitForFunction((expectedTrackingNumber) => {
            const text = document.body.innerText;
            return text.includes('No results found') ||
                text.includes("couldn't find") ||
                (text.includes(expectedTrackingNumber) && /[A-Z]{4}\d{7}/.test(text));
        }, trackingNumber, { timeout: 90000 });

        await page.waitForTimeout(3000);
        const text = await page.locator('body').innerText();
        if (text.includes('No results found') || text.includes("couldn't find")) {
            return { ok: false, trackingNo: trackingNumber, error: 'No results found on Maersk public tracking' };
        }

        const flatText = text.replace(/\s+/g, ' ').trim();
        const getMatch = (regex) => clean(flatText.match(regex)?.[1] || '');
        const billOfLading = getMatch(/Bill of Lading number\s+([A-Z0-9]{9})\s+From/i);
        const originPort = getMatch(/From\s+([^\s]+)\s+To/i);
        const destinationPort = getMatch(/To\s+([^\s]+)\s+(?:[A-Z]{4}\d{7}|Last updated)/i);
        const containerNumber = getMatch(/([A-Z]{4}\d{7})\s*\|/i);
        const rawContainerType = getMatch(/[A-Z]{4}\d{7}\s*\|\s*(.*?)\s+Last updated/i);
        const eventPattern = /(Vessel arrival|Vessel departure|Feeder arrival|Feeder departure|Load on|Discharge)\s*(?:\()?([A-Z\s/0-9-]+?)(?:\))?\s+([0-9]{2}\s+[A-Za-z]{3}\s+[0-9]{4}\s+[0-9]{2}:[0-9]{2})/gi;
        const events = [...flatText.matchAll(eventPattern)].map((match) => ({
            event: clean(match[1]),
            vessel: clean(match[2]),
            dateText: clean(match[3]),
        }));
        const arrivals = events.filter((event) => /arrival/i.test(event.event));
        const departures = events.filter((event) => /departure/i.test(event.event));
        const finalArrival = arrivals.at(-1);
        const firstDeparture = departures[0];
        const latestDeparture = departures.at(-1);
        const etaText = getMatch(/Estimated arrival date\s+([\s\S]*?)\s+(?:Latest event|Note:)/i) || finalArrival?.dateText || '';
        const etdText = firstDeparture?.dateText || '';
        const vesselName = latestDeparture?.vessel?.split('/')[0]?.trim() ||
            finalArrival?.vessel?.split('/')[0]?.trim() ||
            firstDeparture?.vessel?.split('/')[0]?.trim() || '';
        const latestEvent = getMatch(/Last updated:.*?(?:ago|Date)\s+(.*?)\s+Note:/i) ||
            getMatch(/Latest event\s+(.*?)\s+Note:/i) ||
            (latestDeparture ? `${latestDeparture.event} · ${latestDeparture.vessel} · ${latestDeparture.dateText}` : '');

        let size = '';
        let type = rawContainerType;
        if (/40/i.test(rawContainerType)) size = '40FT';
        else if (/20/i.test(rawContainerType)) size = '20FT';
        else if (/45/i.test(rawContainerType)) size = '45FT';
        if (/dry/i.test(rawContainerType)) type = 'Dry Container';
        else if (/reefer/i.test(rawContainerType)) type = 'Reefer Container';
        else if (/open/i.test(rawContainerType)) type = 'Open Top Container';
        else if (/flat/i.test(rawContainerType)) type = 'Flat Rack Container';

        return {
            ok: true,
            trackingNo: billOfLading || trackingNumber,
            vesselName,
            originPort,
            destinationPort,
            etd: formatDateForInput(etdText),
            eta: formatDateForInput(etaText),
            priority: 'Normal',
            status: 'Draft',
            originCountry: '',
            goodsDescription: '',
            notes: latestEvent ? `Latest event: ${latestEvent}` : '',
            containers: containerNumber ? [{ containerNumber, size, type, containerGoods: '' }] : [],
            raw: { billOfLading, rawContainerType, etaText, etdText, latestEvent, vesselName, events },
        };
    }
    finally {
        await browser.close();
    }
}
