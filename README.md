# Maersk Tracking Service

This folder is the Maersk-only service intended for an EC2 VM. The ERP frontend
and main backend stay on Vercel.

## EC2 setup

1. Install Node.js 20 or newer and Google Chrome.
2. Copy this folder to EC2 and run `npm install --omit=dev`.
3. Copy `.env.example` to `.env` and set a long random
   `MAERSK_SERVICE_SECRET`.
4. Confirm `CHROME_EXECUTABLE_PATH` using `which google-chrome`.
5. Run `npm start` behind an HTTPS reverse proxy and a process manager.
6. Permit inbound traffic only from the required proxy/network where possible.

Configure the same secret and the public HTTPS service URL in the Vercel backend:

```env
MAERSK_TRACKING_SERVICE_URL=https://tracking.example.com
MAERSK_TRACKING_SERVICE_SECRET=the-same-long-random-secret
```

Health check: `GET /health`

The protected tracking endpoint is `POST /track` with JSON
`{"trackingNumber":"..."}` and `Authorization: Bearer <secret>`.
# mersk
