/** Some stores typed "Table 2" as the table number; screens that already say "Table" show just "2". */
export function tableNo(number: string) {
  return number.replace(/^\s*(?:table|tbl|طاولة)(?:\s*[-#:.]\s*|\s+|(?=\d))/i, '') || number;
}
