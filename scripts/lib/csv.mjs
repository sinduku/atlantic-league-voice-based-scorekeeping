// just enough csv to round trip the reading sheet through google sheets or
// excel: quoted fields, escaped quotes, commas/newlines inside quotes

function escapeField(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows, columns) {
  const lines = [columns.map(escapeField).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeField(row[column])).join(","));
  }
  return lines.join("\n") + "\n";
}

// returns one object per row keyed by the header line
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // spreadsheet exports often start with a byte order mark
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((value) => value.trim() !== ""));
  if (!header) return [];
  return body.map((values) =>
    Object.fromEntries(header.map((column, i) => [column.trim(), values[i] ?? ""]))
  );
}