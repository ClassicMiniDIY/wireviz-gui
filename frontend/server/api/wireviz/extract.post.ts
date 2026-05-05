// Forwards a multipart PNG upload to the sidecar /extract endpoint and
// returns the embedded YAML. Used by the GUI's "Open .png" flow.

export default defineEventHandler(async (event) => {
  const { sidecarUrl } = useRuntimeConfig()
  const parts = await readMultipartFormData(event)
  if (!parts?.length) {
    throw createError({ statusCode: 400, statusMessage: 'No file uploaded' })
  }

  const file = parts.find((p) => p.name === 'file') ?? parts[0]
  const form = new FormData()
  form.append(
    'file',
    new Blob([file.data], { type: file.type ?? 'image/png' }),
    file.filename ?? 'upload.png',
  )

  try {
    return await $fetch(`${sidecarUrl}/extract`, {
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
