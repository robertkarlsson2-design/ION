def word_count(text: str) -> int:
    return len([w for w in text.strip().split(" ") if w != ""])

def capitalize(words: list[str]) -> str:
    return " ".join(w.upper() for w in words)

def csv_row(fields: list[str]) -> str:
    return ",".join(fields)

def has_keyword(text: str, keyword: str) -> bool:
    return any(w == keyword.lower() for w in text.lower().split(" "))
