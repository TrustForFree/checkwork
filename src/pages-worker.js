// ==========================================================
//  pages-worker.js — نقطة الدخول لـ Cloudflare Pages
//  (وضع متقدّم: _worker.js مع أصول مدمجة داخل الحزمة)
// ==========================================================

import { makeFetch } from "./handler.js";
import { serveStatic } from "./static.js";

export default {
  async fetch(request, env, ctx) {
    return makeFetch(() => serveStatic(request))(request, env, ctx);
  },
};