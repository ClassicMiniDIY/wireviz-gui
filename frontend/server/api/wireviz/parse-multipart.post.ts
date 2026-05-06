// Forwards a multipart parse request (yaml + assets) to the sidecar.
//
// We rebuild the FormData on this side rather than streaming the raw body
// through, because Nitro's readMultipartFormData parses the parts for us
// and Node's fetch needs a real FormData instance to set the multipart
// boundary correctly. The cost is a single in-memory copy per asset —
// fine for the sizes we'll see in this app.

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
    return await $fetch(`${sidecarUrl}/parse-multipart`, {
      method: 'POST',
      body: form,
    })
  } catch (err: any) {
    throw createError({
      statusCode: err?.statusCode || err?.response?.status || 500,
      statusMessage: err?.statusMessage || 'Sidecar error',
      data: err?.data ?? err?.response?._data ?? { detail: String(err) },
    })
  }
})
