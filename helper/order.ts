import { OrderPositionSide, OrderSide, OrderType } from '../consts/index.ts'
import { Order } from '../types/index.ts'

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
