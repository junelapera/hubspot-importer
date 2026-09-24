export { parseCsv, CsvParseError } from "./csv";
export type { CsvDelimiter, CsvEncoding, CsvParseOptions, CsvParseResult, CsvDetected } from "./csv";

export { parseJson } from "./json";
export type { JsonParseError, JsonParseOutcome, JsonParseResult, JsonTable } from "./json";

export { parseXlsx, XlsxParseError } from "./xlsx";
export type { XlsxParseOptions, XlsxParseResult, XlsxSheetResult } from "./xlsx";

export { normalizeGoogleSheetsUrl, GoogleSheetsUrlError } from "./gsheets";
export type { NormalizedGoogleSheetsUrl } from "./gsheets";

export {
  validateSource,
  HUBDB_TEXT_MAX,
  HUBDB_RICHTEXT_MAX,
} from "./validate";
export type { Warning, WarningKind, ValidationInput } from "./validate";

export const SOURCE_PREVIEW_ROWS = 20;
