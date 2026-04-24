function wordCount(text: string): number {
  return text.trim().split(" ").filter(w => w !== "").length;
}

function capitalize(words: string[]): string {
  return words.map(w => w.toUpperCase()).join(" ");
}

function csvRow(fields: string[]): string {
  return fields.join(",");
}

function hasKeyword(text: string, keyword: string): boolean {
  return text.toLowerCase().split(" ").some(w => w === keyword.toLowerCase());
}
