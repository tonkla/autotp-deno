import { OrderPositionSide, OrderSide, OrderType } from '../consts/index.ts'
import { Order } from '../types/index.ts'

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
