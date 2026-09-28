/** Square cells, centered rows, and no isolated last number. No DOM or Satori dependency. */
export function boardLayout(numberCount: number, boxW: number, boxH: number) {
  if (!Number.isInteger(numberCount) || numberCount < 2 || numberCount > 100 ||
      !Number.isFinite(boxW) || !Number.isFinite(boxH) || boxW <= 0 || boxH <= 0) {
    throw new RangeError("El tablero requiere 2–100 números y una caja positiva.");
  }
  const gap = 8;
  const preferred = numberCount <= 8 ? Math.min(numberCount, 4)
    : numberCount <= 25 ? 5 : numberCount < 50 ? Math.ceil(Math.sqrt(numberCount)) : 10;
  const sizeFor = (columns: number) => {
    const rows = Math.ceil(numberCount / columns);
    return Math.floor(Math.min((boxW - gap * (columns - 1)) / columns,
      (boxH - gap * (rows - 1)) / rows, 200));
  };
  const candidates = Array.from({ length: Math.min(10, numberCount) }, (_, i) => i + 1)
    .sort((a, b) => (numberCount <= 25 ? sizeFor(b) - sizeFor(a) : 0)
      || Math.abs(a - preferred) - Math.abs(b - preferred));
  for (const columns of candidates) {
    const rows = Math.ceil(numberCount / columns);
    const cellSize = sizeFor(columns);
    if (cellSize < 70) continue;
    // Balance incomplete rows (e.g. 11 => 4+4+3), preserving numeric order.
    const rowCounts = Array.from({ length: rows }, (_, i) =>
      Math.floor(numberCount / rows) + (i < numberCount % rows ? 1 : 0));
    const occupiedColumns = Math.max(...rowCounts);
    return { columns: occupiedColumns, rows, cellSize, gap, fontSize: Math.floor(cellSize * 0.55), rowCounts,
      width: occupiedColumns * cellSize + (occupiedColumns - 1) * gap,
      height: rows * cellSize + (rows - 1) * gap };
  }
  // An impossible box must not silently produce unreadable or overflowing cells.
  throw new RangeError("La caja no admite casillas de al menos 70 px.");
}
