const { Router } = require('express')
const { dataApi } = require('@surf-ai/sdk/server')

const router = Router()

router.get('/', async (_req, res) => {
  try {
    const data = await dataApi.market.fear_greed({})
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: { message: e?.message || 'failed' } })
  }
})

module.exports = router
