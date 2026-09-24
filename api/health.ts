import { createApp } from "../server/src/app.js";

/** Vercel Function for `GET /api/health`: reports mock or live mode and the limits. */
export default createApp();
