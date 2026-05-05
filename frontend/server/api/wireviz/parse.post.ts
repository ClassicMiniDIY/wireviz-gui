// Server route — proxies parse requests to the Python sidecar.
// Keeping this server-side means CORS is a non-issue in production and the
// sidecar URL never leaks to the browser bundle.

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { sidecarUrl } = useRuntimeConfig()

  try {
    return await $fetch(`${sidecarUrl}/parse`, {
      method: 'POST',
      body,
    })
  } catch (err: any) {
    // FastAPI wraps user-facing errors with a `detail` key. Surface that
    // verbatim so the editor UI can render the WireViz parse error.
    throw createError({
      statusCode: err?.statusCode || err?.response?.status || 500,
      statusMessage: err?.statusMessage || 'Sidecar error',
      data: err?.data ?? err?.response?._data ?? { detail: String(err) },
    })
  }
})
