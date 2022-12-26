import { OrderSide, OrderStatus, OrderType } from '../../consts/index.ts'
import { Order } from '../../types/index.ts'
import { getBookDepth } from './futures.ts'

export async function buildLongSLTakerOrder(o: Order): Promise<Order | null> {
  const depth = await getBookDepth(o.symbol)
  if (!depth?.bids[1][0]) return null

  const stopPrice = depth.bids[0][0]
  const openPrice = depth.bids[1][0]
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

export async function buildLongSLMakerOrder(o: Order): Promise<Order | null> {
  const depth = await getBookDepth(o.symbol)
  if (!depth?.asks[1][0]) return null

  const stopPrice = depth.asks[0][0]
  const openPrice = depth.asks[1][0]
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

export async function buildLongTPOrder(o: Order): Promise<Order | null> {
  const depth = await getBookDepth(o.symbol)
  if (!depth?.asks[2][0]) return null

  const stopPrice = depth.asks[1][0]
  const openPrice = depth.asks[2][0]
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

export async function buildShortSLTakerOrder(o: Order): Promise<Order | null> {
  const depth = await getBookDepth(o.symbol)
  if (!depth?.asks[1][0]) return null

  const stopPrice = depth.asks[0][0]
  const openPrice = depth.asks[1][0]
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

export async function buildShortSLMakerOrder(o: Order): Promise<Order | null> {
  const depth = await getBookDepth(o.symbol)
  if (!depth?.bids[1][0]) return null

  const stopPrice = depth.bids[0][0]
  const openPrice = depth.bids[1][0]
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

export async function buildShortTPOrder(o: Order): Promise<Order | null> {
  const depth = await getBookDepth(o.symbol)
  if (!depth?.bids[2][0]) return null

  const stopPrice = depth.bids[1][0]
  const openPrice = depth.bids[2][0]
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
