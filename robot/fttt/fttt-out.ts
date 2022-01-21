import { connect } from 'https://deno.land/x/redis/mod.ts'

import { RedisKeys } from '../../consts/index.ts'
import { Interval } from '../../exchange/binance/enums.ts'

const config = {
  exchange: 'binance',
  botId: 1,
}

const redis = await connect({
  hostname: '127.0.0.1',
  port: 6379,
})

async function getCandlestick() {
  try {
    const _gainers = await redis.get(RedisKeys.TopGainers(config.exchange))
    if (_gainers) {
      const gainers = JSON.parse(_gainers)
      for (const symbol of gainers) {
        const t24h = await redis.get(RedisKeys.Ticker24hr(config.exchange, symbol))
        if (t24h) {
          console.log('t24hr', JSON.parse(t24h))
        }
        const t1d = await redis.get(RedisKeys.CandlestickLast(config.exchange, symbol, Interval.D1))
        if (t1d) {
          const token = JSON.parse(t1d)
          console.log('t1d', token)
        }
        const t4h = await redis.get(RedisKeys.CandlestickLast(config.exchange, symbol, Interval.H4))
        if (t4h) {
          const token = JSON.parse(t4h)
          console.log('t4h', token)
        }
        const t1h = await redis.get(RedisKeys.CandlestickLast(config.exchange, symbol, Interval.H1))
        if (t1h) {
          const token = JSON.parse(t1h)
          console.log('t1h', token)
        }
      }
    }

    const _losers = await redis.get(RedisKeys.TopLosers(config.exchange))
    if (_losers) {
      const losers = JSON.parse(_losers)
      for (const symbol of losers) {
        const t24h = await redis.get(RedisKeys.Ticker24hr(config.exchange, symbol))
        if (t24h) {
          console.log('t24hr', JSON.parse(t24h))
        }
        const t1d = await redis.get(RedisKeys.CandlestickLast(config.exchange, symbol, Interval.D1))
        if (t1d) {
          const token = JSON.parse(t1d)
          console.log('t1d', token)
        }
        const t4h = await redis.get(RedisKeys.CandlestickLast(config.exchange, symbol, Interval.H4))
        if (t4h) {
          const token = JSON.parse(t4h)
          console.log('t4h', token)
        }
        const t1h = await redis.get(RedisKeys.CandlestickLast(config.exchange, symbol, Interval.H1))
        if (t1h) {
          const token = JSON.parse(t1h)
          console.log('t1h', token)
        }
      }
    }
  } catch (e) {
    console.error(e)
  }
}

async function main() {
  await getCandlestick()
  setInterval(async () => await getCandlestick(), 60000)

  // if (hma_1 < hma_0 && lma_1 < lma_0) {
  //   // uptrend
  // } else if (hma_1 > hma_0 && lma_1 > lma_0) {
  //   // downtrend
  // }
}

main()
