// A realistic TypeScript module — user service with filtering and stats

interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
  score: number;
}

function getActiveUsers(users: User[]): User[] {
  return users.filter(u => u.active);
}

function topScorers(users: User[], n: number): User[] {
  return users
    .filter(u => u.active)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function averageScore(users: User[]): number {
  if (users.length === 0) return 0;
  const total = users.reduce((acc, u) => acc + u.score, 0);
  return total / users.length;
}

function emailsFor(users: User[]): string[] {
  return users.filter(u => u.active).map(u => u.email);
}
