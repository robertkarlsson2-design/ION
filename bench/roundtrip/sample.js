// Same user service in JavaScript

function getActiveUsers(users) {
  return users.filter(u => u.active);
}

function topScorers(users, n) {
  return users
    .filter(u => u.active)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function averageScore(users) {
  if (users.length === 0) return 0;
  const total = users.reduce((acc, u) => acc + u.score, 0);
  return total / users.length;
}

function emailsFor(users) {
  return users.filter(u => u.active).map(u => u.email);
}
