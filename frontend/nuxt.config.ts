// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // The Python sidecar URL is read server-side only by routes under
  // server/api/wireviz/*. Keeping it off public.* means the address never
  // ships in the browser bundle, which matters when we eventually run the
  // sidecar over a unix socket or on a non-routable host.
  runtimeConfig: {
    sidecarUrl: process.env.WIREVIZ_SIDECAR_URL || 'http://127.0.0.1:8765',
  },
})
