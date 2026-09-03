function computeCartTotal(items) {
  return (items || []).reduce(function (sum, item) {
    // A per-line price can be a repeating fraction (enteredTotal / qty from a
    // cashier editing a line's total) — round back to the nearest whole unit
    // before summing so the total matches what was actually typed, instead of
    // carrying a floating-point artifact like 14999.999999999998.
    return sum + Math.round(Number(item.price) * Number(item.qty));
  }, 0);
}

function buildSaleGoodsRows(items) {
  return (items || [])
    .filter(function (item) { return !item.isCustom; })
    .map(function (item) {
      return { name: item.name, quantity: Number(item.qty) };
    });
}

function buildOperationsRow(items, paymentType, totalOverride) {
  // Neither "Реестр товаров" (quantity-only, no price column) nor this row's
  // own Сумма (one grand total for the whole cart) preserve what a specific
  // line actually sold for. The note spells out qty × price per line — the
  // only place a per-line price override survives.
  //
  // totalOverride lets the cashier correct the whole order's final total
  // (e.g. a round-number discount) without redistributing it back across
  // lines — deliberately: proportionally rescaling every line raises more
  // questions (does it touch services too? how does it round?) than it's
  // worth when the goods-movement rows only ever cared about quantity
  // anyway. When it's used, the note gets one appended clause so it still
  // explains itself instead of silently disagreeing with its own header.
  const subtotal = computeCartTotal(items);
  const hasOverride = totalOverride !== null && totalOverride !== undefined && totalOverride !== subtotal;
  const lines = (items || []).map(function (item) {
    return item.name + ' x' + item.qty + ' = ' + Math.round(Number(item.price) * Number(item.qty));
  });
  if (hasOverride) {
    lines.push('Итого по позициям: ' + subtotal + ', к оплате: ' + totalOverride);
  }
  return {
    type: 'Доход',
    amount: hasOverride ? totalOverride : subtotal,
    account: paymentType,
    category: 'Продажа товаров',
    note: lines.join(', '),
  };
}

function buildTelegramSaleMessage(items, point, paymentType, fmt, totalOverride) {
  const subtotal = computeCartTotal(items);
  const hasOverride = totalOverride !== null && totalOverride !== undefined && totalOverride !== subtotal;
  const lines = (items || []).map(function (item) {
    return '• ' + item.name + ' × ' + item.qty + ' — ' + fmt(Math.round(Number(item.price) * Number(item.qty)));
  });
  const msg = '🛍 <b>Продажа</b>\n' + lines.join('\n') + '\n' +
    'Точка: ' + point + '\n' +
    'Оплата: ' + paymentType + '\n' +
    'Итого: ' + fmt(hasOverride ? totalOverride : subtotal);
  // Normalize non-breaking spaces to regular spaces for consistent regex matching
  return msg.replace(/ /g, ' ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeCartTotal, buildSaleGoodsRows, buildOperationsRow, buildTelegramSaleMessage };
}
