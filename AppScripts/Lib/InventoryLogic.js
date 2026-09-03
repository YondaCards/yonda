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

function buildGoodsLedgerRow(delta, location, dateStr, type) {
  const resolvedType = type || 'Инвентаризация';
  return {
    type: resolvedType,
    from: delta < 0 ? location : '',
    to: delta > 0 ? location : '',
    quantity: Math.abs(delta),
    note: (resolvedType === 'Продажа' ? 'Сверка продаж от ' : 'Инвентаризация от ') + dateStr,
  };
}

function classifyGoodsDelta(delta, isPostcardVariety, isSaleReconciliation) {
  if (delta > 0) {
    return { type: 'Инвентаризация', mirrorToAggregate: !!isPostcardVariety };
  }
  if (isPostcardVariety && isSaleReconciliation) {
    return { type: 'Продажа', mirrorToAggregate: false };
  }
  return { type: 'Инвентаризация', mirrorToAggregate: !!isPostcardVariety };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeDelta, buildMaterialLedgerRow, buildGoodsLedgerRow, classifyGoodsDelta };
}
