// ==========================================================
//  worker.js — نقطة الدخول لـ Cloudflare Workers
//  (الأصول الساكنة عبر ASSETS binding)
// ==========================================================

import { makeFetch, runCleanup } from "./handler.js";

const fetch = makeFetch(async (request, env) => env.ASSETS.fetch(request));

export default {
  fetch,

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runCleanup(env).catch((err) => console.error("cleanup failed:", err?.message || err))
    );
  },
};