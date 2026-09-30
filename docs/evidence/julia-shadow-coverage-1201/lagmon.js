const fs = require('fs')
let last = Date.now(), max = 0, n = 0
setInterval(() => {
  const now = Date.now(); const d = now - last - 100; last = now
  if (d > max) max = d
  if (d > 200) fs.appendFileSync('/tmp/run/lag.log', `${new Date().toISOString()} lag ${d}ms\n`)
  if (++n % 100 === 0) fs.writeFileSync('/tmp/run/lag-max.json', JSON.stringify({ at: new Date().toISOString(), max_ms: max, rss_mb: Math.round(process.memoryUsage().rss / 1048576) }))
}, 100).unref()
