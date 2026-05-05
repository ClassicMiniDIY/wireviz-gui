export default defineEventHandler(async () => {
  const { sidecarUrl } = useRuntimeConfig()
  try {
    return await $fetch(`${sidecarUrl}/health`)
  } catch (err: any) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Sidecar unreachable',
      data: { sidecarUrl, error: String(err) },
    })
  }
})
