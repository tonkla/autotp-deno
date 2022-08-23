import { OrderPositionSide, OrderSide, OrderStatus, OrderType } from '../consts/index.ts'
import { BookDepth, Order } from '../types/index.ts'

const newOrder: Order = {
  exchange: '',
  botId: '',
  id: '',
  refId: '',
  symbol: '',
  side: '',
  positionSide: '',
  type: '',
  status: '',
  qty: 0,
  openPrice: 0,
  closePrice: 0,
  commission: 0,
  pl: 0,
}

export function buildLimitOrder(
  exchange: string,
  botId: string,
  symbol: string,
  side: OrderSide,
  positionSide: OrderPositionSide,
  openPrice: number,
  qty: number
): Order {
  return {
    ...newOrder,
    exchange,
    botId,
    id: Date.now().toString(),
    symbol,
    side,
    positionSide,
    type: OrderType.Limit,
    openPrice,
    qty,
  }
}

export function buildStopOrder(
  exchange: string,
  botId: string,
  symbol: string,
  side: OrderSide,
  positionSide: string,
  type: string,
  stopPrice: number,
  openPrice: number,
  qty: number,
  openOrderId: string
): Order {
  return {
    ...newOrder,
    exchange,
    botId,
    id: Date.now().toString(),
    symbol,
    side,
    positionSide,
    type,
    stopPrice,
    openPrice,
    qty,
    openOrderId,
  }
}

export function buildMarketOrder(o: Order): Order {
  const side = o.positionSide === OrderPositionSide.Long ? OrderSide.Sell : OrderSide.Buy
  const order: Order = {
    exchange: o.exchange ?? '',
    botId: o.botId,
    id: Date.now().toString(),
    refId: '',
    symbol: o.symbol,
    side,
    positionSide: o.positionSide ?? '',
    type: OrderType.Market,
    status: '',
    qty: o.qty,
    openPrice: 0,
    closePrice: 0,
    commission: 0,
    pl: 0,
    openOrderId: o.id,
  }
  return order
}

export function buildLongSLOrder(o: Order, depth: BookDepth): Order | null {
  if (depth?.bids?.length !== 10 || !depth.bids[0][0]) return null

  const stopPrice = depth.bids[2][0]
  const openPrice = depth.bids[4][0]
  return {
    ...o,
    refId: '',
    commission: 0,
    note: undefined,
    id: Date.now().toString(),
    stopPrice,
    openPrice,
    openOrderId: o.id,
    side: OrderSide.Sell,
    type: OrderType.FSL,
    status: OrderStatus.New,
  }
}

export function buildLongTPOrder(o: Order, depth: BookDepth): Order | null {
  if (depth?.asks?.length !== 10 || !depth.asks[0][0]) return null

  const stopPrice = depth.asks[3][0]
  const openPrice = depth.asks[6][0]
  return {
    ...o,
    refId: '',
    commission: 0,
    note: undefined,
    id: Date.now().toString(),
    stopPrice,
    openPrice,
    openOrderId: o.id,
    side: OrderSide.Sell,
    type: OrderType.FTP,
    status: OrderStatus.New,
  }
}

export function buildShortSLOrder(o: Order, depth: BookDepth): Order | null {
  if (depth?.asks?.length !== 10 || !depth.asks[0][0]) return null

  const stopPrice = depth.asks[2][0]
  const openPrice = depth.asks[4][0]
  return {
    ...o,
    refId: '',
    commission: 0,
    note: undefined,
    id: Date.now().toString(),
    stopPrice,
    openPrice,
    openOrderId: o.id,
    side: OrderSide.Buy,
    type: OrderType.FSL,
    status: OrderStatus.New,
  }
}

export function buildShortTPOrder(o: Order, depth: BookDepth): Order | null {
  if (depth?.bids?.length !== 10 || !depth.bids[0][0]) return null

  const stopPrice = depth.bids[3][0]
  const openPrice = depth.bids[6][0]
  return {
    ...o,
    refId: '',
    commission: 0,
    note: undefined,
    id: Date.now().toString(),
    stopPrice,
    openPrice,
    openOrderId: o.id,
    side: OrderSide.Buy,
    type: OrderType.FTP,
    status: OrderStatus.New,
  }
}
