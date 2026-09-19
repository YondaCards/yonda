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

// Returns a Russian error message, or null when the movement is valid.
function validateMovement(action, location, from, to) {
  if (action === 'transfer') {
    if (!from || !to) return 'Выберите склады «Откуда» и «Куда»';
    if (from === to) return 'Склады «Откуда» и «Куда» должны различаться';
    return null;
  }
  if (action === 'production' || action === 'writeoff') {
    return location ? null : 'Выберите склад';
  }
  return 'Неизвестное действие: ' + action;
}

// Movement modes enter a quantity (not a counted fact); rows with blank,
// non-numeric, zero or negative quantities are dropped.
function buildMovementRows(action, location, from, to, items) {
  const rows = [];
  (items || []).forEach((it) => {
    const quantity = Number(it.quantity);
    if (it.quantity === '' || it.quantity === null || it.quantity === undefined) return;
    if (Number.isNaN(quantity) || quantity <= 0) return;
    if (action === 'writeoff') {
      rows.push({ name: it.name, quantity, vidDeistviya: 'Продажа', from: location, to: '' });
    } else if (action === 'transfer') {
      rows.push({ name: it.name, quantity, vidDeistviya: 'Перемещение', from, to });
    } else if (action === 'production') {
      rows.push({ name: it.name, quantity, vidDeistviya: 'Пополнение', opType: 'Производство', from: '', to: location });
    }
  });
  return rows;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeDelta, buildMaterialLedgerRow, buildGoodsLedgerRow, classifyGoodsDelta, validateMovement, buildMovementRows };
}
