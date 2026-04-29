const { Router } = require('express')
const { dataApi } = require('@surf-ai/sdk/server')

const router = Router()

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 6, 30)
    const data = await dataApi.news.feed({ limit, sort_by: 'recency' })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: { message: e?.message || 'failed' } })
  }
})

module.exports = router
