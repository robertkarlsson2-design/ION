def wordCount(text):
    return len(list(filter(lambda w: w != "", text.strip().split(" "))))

def capitalize(words):
    return " ".join(list(map(toUpper, words)))

def csvRow(fields):
    return ",".join(fields)

def hasKeyword(text, keyword):
    return any(map(lambda w: w == keyword.lower(), text.lower().split(" ")))
