function computeDelta(current, factRaw) {
  if (factRaw === undefined || factRaw === null || factRaw === '') return null;
  const factNum = Number(factRaw);
  if (Number.isNaN(factNum)) return null;
  const delta = factNum - Number(current);
  if (delta === 0) return null;
  return delta;
}

function buildMaterialLedgerRow(materialName, delta, dateStr) {
  return {
    type: delta > 0 ? 'Приход' : 'Списание',
    quantity: Math.abs(delta),
    note: 'Инвентаризация от ' + dateStr,
  };
}

function buildGoodsLedgerRow(delta, location, dateStr) {
  return {
    type: 'Инвентаризация',
    from: delta < 0 ? location : '',
    to: delta > 0 ? location : '',
    quantity: Math.abs(delta),
    note: 'Инвентаризация от ' + dateStr,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeDelta, buildMaterialLedgerRow, buildGoodsLedgerRow };
}
