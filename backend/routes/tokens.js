const { Router } = require('express')
const { dataApi } = require('@surf-ai/sdk/server')

const router = Router()

router.get('/', async (req, res) => {
  try {
    const sortBy = req.query.sort_by || 'market_cap'
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100)
    const data = await dataApi.market.ranking({ sort_by: sortBy, order: 'desc', limit })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: { message: e?.message || 'failed' } })
  }
})

module.exports = router
