function wordCount(text) {
  return text.trim().split(" ").filter(w => w !== "").length;
}

function capitalize(words) {
  return words.map(w => w.toUpperCase()).join(" ");
}

function csvRow(fields) {
  return fields.join(",");
}

function hasKeyword(text, keyword) {
  return text.toLowerCase().split(" ").some(w => w === keyword.toLowerCase());
}
