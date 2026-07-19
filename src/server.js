import 'dotenv/config';
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { trackMaerskShipment } from './maersk.js';

const app = express();
const port = Number(process.env.PORT) || 5050;

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

const authorized = (req) => {
    const configuredSecret = String(process.env.MAERSK_SERVICE_SECRET || '');
    const suppliedSecret = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!configuredSecret || configuredSecret.length !== suppliedSecret.length) return false;
    return timingSafeEqual(Buffer.from(configuredSecret), Buffer.from(suppliedSecret));
};

app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'maersk-tracking' });
});

app.post('/track', async (req, res) => {
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

    const trackingNumber = String(req.body?.trackingNumber || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{5,30}$/.test(trackingNumber)) {
        return res.status(400).json({ error: 'A valid tracking number is required' });
    }

    try {
        const result = await trackMaerskShipment(trackingNumber);
        return res.json({ data: result });
    }
    catch (error) {
        console.error('Maersk tracking failed:', error);
        return res.status(502).json({ error: error.message || 'Maersk tracking failed' });
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Maersk tracking service listening on port ${port}`);
});
