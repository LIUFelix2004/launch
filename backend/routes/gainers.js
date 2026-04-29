const { Router } = require('express')
const { dataApi } = require('@surf-ai/sdk/server')

const router = Router()

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 50)
    const data = await dataApi.market.ranking({ sort_by: 'change_24h', order: 'desc', limit })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: { message: e?.message || 'failed' } })
  }
})

module.exports = router
