// Multipart variant of /render/png. Used by Download PNG when the user
// has assets attached so the rendered PNG bakes the images into the
// raster output (graphviz writes them inline) AND keeps the YAML iTXt
// chunk for round-trip via /extract.

export default defineEventHandler(async (event) => {
  const { sidecarUrl } = useRuntimeConfig()
  const parts = await readMultipartFormData(event)
  if (!parts?.length) {
    throw createError({ statusCode: 400, statusMessage: 'Empty multipart body' })
  }

  const form = new FormData()
  for (const p of parts) {
    if (p.filename) {
      form.append(
        p.name ?? 'files',
        new Blob([p.data], { type: p.type ?? 'application/octet-stream' }),
        p.filename,
      )
    } else {
      form.append(p.name ?? '', p.data.toString('utf-8'))
    }
  }

  try {
    const png = await $fetch<ArrayBuffer>(`${sidecarUrl}/render/png-multipart`, {
      method: 'POST',
      body: form,
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
