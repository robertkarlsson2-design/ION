# A realistic Python module — same user service logic

def get_active_users(users):
    return [u for u in users if u["active"]]

def top_scorers(users, n):
    active = [u for u in users if u["active"]]
    return sorted(active, key=lambda u: u["score"], reverse=True)[:n]

def average_score(users):
    if len(users) == 0:
        return 0
    total = sum(u["score"] for u in users)
    return total / len(users)

def emails_for(users):
    return [u["email"] for u in users if u["active"]]
