"use client";

/**
 * Minimal SheetJS wrapper for the import wizard.
 *
 * We only need to:
 *   1. Read an .xlsx or .csv file selected by the user.
 *   2. Pull the first sheet's rows.
 *   3. Optionally treat the first row as a header.
 *
 * Everything else (column inference, type guessing, etc.) is handled in
 * the wizard steps or shipped to the GLPIM agent.
 */

import * as XLSX from "xlsx";

import type { ParsedFile } from "@/lib/import/types";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
// Excel pads sheets out to ~1.05M rows; without an upper bound a real file
// with a few hundred data rows can present as 1M rows of empty strings and
// crash the browser. 50k is generous for a wizard import.
const MAX_DATA_ROWS = 50_000;

/**
 * Read a File from a drop / input change event into a ParsedFile.
 *
 * Accepts .xlsx, .xls, .csv. Throws on parse failure or oversized input.
 *
 * `hasHeaders` controls whether row 0 becomes the column names. When false,
 * synthetic "Column A", "Column B"... names are produced.
 */
export async function parseSpreadsheetFile(
  file: File,
  hasHeaders: boolean,
): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File too large (${Math.round(file.size / 1024 / 1024)} MB; limit ${MAX_FILE_BYTES / 1024 / 1024} MB).`,
    );
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("File has no sheets.");
  }
  const sheet = wb.Sheets[firstSheetName];
  // header: 1 → array-of-arrays. defval ensures undefined cells become "".
  // blankrows: false drops fully-empty rows during parse so an Excel sheet
  // padded to 1M rows doesn't allocate 1M arrays here.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (aoa.length === 0) {
    return {
      fileName: file.name,
      columns: [],
      rows: [],
      hasHeaders,
    };
  }

  if (aoa.length > MAX_DATA_ROWS) {
    throw new Error(
      `File has ${aoa.length.toLocaleString()} non-empty rows; the wizard supports up to ${MAX_DATA_ROWS.toLocaleString()}. Split the file or use a server-side import.`,
    );
  }

  // reduce, not Math.max(...spread): V8 caps spread args around ~100k and
  // throws RangeError on larger files.
  let maxCols = 0;
  for (const r of aoa) if (r.length > maxCols) maxCols = r.length;
  // Normalise every row to maxCols length so the table is rectangular.
  const norm = aoa.map((r) => {
    const out: string[] = new Array(maxCols).fill("");
    r.forEach((cell, i) => {
      out[i] = cell == null ? "" : String(cell);
    });
    return out;
  });

  let columns: string[];
  let rows: string[][];
  if (hasHeaders) {
    columns = (norm[0] || []).map((c, i) => (c.trim() || syntheticColumnName(i)));
    rows = norm.slice(1);
  } else {
    columns = Array.from({ length: maxCols }, (_, i) => syntheticColumnName(i));
    rows = norm;
  }

  // Drop trailing fully-empty rows
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }

  return {
    fileName: file.name,
    columns,
    rows,
    hasHeaders,
  };
}

function syntheticColumnName(i: number): string {
  // Excel-style: A, B, … Z, AA, AB, …
  let n = i;
  let name = "";
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Columna ${name}`;
}
