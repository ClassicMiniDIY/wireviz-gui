// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['nuxt-monaco-editor'],

  // monaco-editor ships its workers as separate bundles. Keep the
  // built-in language workers Monaco needs (the YAML one is handled
  // separately by monaco-yaml in Phase 3).
  monacoEditor: {
    locale: 'en',
    componentName: { codeEditor: 'MonacoEditor' },
  },

  // CMDIY design tokens (olive/burnt-orange brand). Loaded as a global
  // stylesheet rather than scoped to the page so server-rendered chrome
  // (error pages, future routes) inherit the palette automatically.
  css: ['~/assets/css/cmdiy.css'],

  app: {
    head: {
      // data-theme switches the cmdiy / cmdiy-dark token blocks. Default
      // light; a toggle can flip this client-side later.
      htmlAttrs: { 'data-theme': 'cmdiy', lang: 'en' },
      title: 'WireViz GUI · Classic Mini DIY',
      link: [
        { rel: 'icon', type: 'image/png', href: '/brand/ios-icon.png' },
        // Outfit — primary sans across the CMDIY ecosystem.
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossorigin: '',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap',
        },
        // FontAwesome 6 free CDN — solid only. The brand prefers duotone
        // (`fad`) on production via a private Pro Kit, but the free CDN
        // doesn't ship duotone glyphs so we use solid in this app.
        {
          rel: 'stylesheet',
          href: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css',
        },
      ],
    },
  },

  // The Python sidecar URL is read server-side only by routes under
  // server/api/wireviz/*. Keeping it off public.* means the address never
  // ships in the browser bundle.
  runtimeConfig: {
    sidecarUrl: process.env.WIREVIZ_SIDECAR_URL || 'http://127.0.0.1:8765',
  },
})
