// Proxies POST /render/png to the sidecar. Used by the "Download PNG"
// button so the live editor render only computes SVG (one graphviz pipe);
// PNG is only generated when the user explicitly asks for it.

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { sidecarUrl } = useRuntimeConfig()

  try {
    const png = await $fetch<ArrayBuffer>(`${sidecarUrl}/render/png`, {
      method: 'POST',
      body,
      responseType: 'arrayBuffer',
    })
    setHeader(event, 'Content-Type', 'image/png')
    setHeader(event, 'Content-Disposition', 'attachment; filename="harness.png"')
    return new Uint8Array(png)
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode || err?.response?.status || 500,
      statusMessage: err?.statusMessage || 'Sidecar error',
      data: err?.data ?? err?.response?._data ?? { detail: String(err) },
    })
  }
})
