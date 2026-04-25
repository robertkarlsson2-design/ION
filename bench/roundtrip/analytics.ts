// Analytics library: employee performance and project tracking

// ── Domain types ───────────────────────────────────────────────────────────

interface Employee {
  id: string;
  name: string;
  department: string;
  salary: number;
  score: number;
  active: boolean;
  yearsAtCompany: number;
}

interface Project {
  id: string;
  name: string;
  budget: number;
  spent: number;
  headcount: number;
  completed: boolean;
  priority: number;
}

interface Review {
  employeeId: string;
  quarter: number;
  year: number;
  rating: number;
  bonus: number;
}

interface DepartmentSummary {
  department: string;
  headcount: number;
  totalSalary: number;
  avgScore: number;
  avgYears: number;
}

interface ProjectReport {
  id: string;
  name: string;
  utilization: number;
  overBudget: boolean;
  efficiency: number;
}

interface PayBand {
  label: string;
  min: number;
  max: number;
  count: number;
}

// ── Employee filters ───────────────────────────────────────────────────────

function getActiveEmployees(employees: Employee[]): Employee[] {
  return employees.filter(e => e.active);
}

function getByDepartment(employees: Employee[], dept: string): Employee[] {
  return employees.filter(e => e.department === dept);
}

function getHighPerformers(employees: Employee[], threshold: number): Employee[] {
  return employees.filter(e => e.score >= threshold);
}

function getVeterans(employees: Employee[], minYears: number): Employee[] {
  return employees.filter(e => e.yearsAtCompany >= minYears);
}

function getEligibleForPromotion(employees: Employee[]): Employee[] {
  return employees.filter(e => e.active && e.score >= 80 && e.yearsAtCompany >= 2);
}

function getLowPerformers(employees: Employee[], cutoff: number): Employee[] {
  return employees.filter(e => e.active && e.score < cutoff);
}

// ── Salary analytics ──────────────────────────────────────────────────────

function totalPayroll(employees: Employee[]): number {
  return employees.reduce((acc, e) => acc + e.salary, 0);
}

function averageSalary(employees: Employee[]): number {
  if (employees.length === 0) return 0;
  return totalPayroll(employees) / employees.length;
}

function medianSalary(employees: Employee[]): number {
  if (employees.length === 0) return 0;
  const sorted = employees.map(e => e.salary).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function salaryRange(employees: Employee[]): number {
  if (employees.length === 0) return 0;
  const salaries = employees.map(e => e.salary);
  return Math.max(...salaries) - Math.min(...salaries);
}

function salaryVariance(employees: Employee[]): number {
  if (employees.length === 0) return 0;
  const avg = averageSalary(employees);
  const squaredDiffs = employees.map(e => (e.salary - avg) * (e.salary - avg));
  return squaredDiffs.reduce((acc, d) => acc + d, 0) / employees.length;
}

function salaryStdDev(employees: Employee[]): number {
  return Math.sqrt(salaryVariance(employees));
}

// ── Score analytics ────────────────────────────────────────────────────────

function averageScore(employees: Employee[]): number {
  if (employees.length === 0) return 0;
  const total = employees.reduce((acc, e) => acc + e.score, 0);
  return total / employees.length;
}

function topScorers(employees: Employee[], n: number): Employee[] {
  return employees
    .filter(e => e.active)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function scoreDistribution(employees: Employee[]): Map<string, number> {
  const dist = new Map<string, number>();
  for (const e of employees) {
    const band = e.score >= 90 ? 'excellent'
      : e.score >= 75 ? 'good'
      : e.score >= 60 ? 'average'
      : 'below_average';
    dist.set(band, (dist.get(band) ?? 0) + 1);
  }
  return dist;
}

function scoreCorrelationWithTenure(employees: Employee[]): number {
  if (employees.length < 2) return 0;
  const avgS = averageScore(employees);
  const avgY = employees.reduce((acc, e) => acc + e.yearsAtCompany, 0) / employees.length;
  const cov = employees.reduce((acc, e) =>
    acc + (e.score - avgS) * (e.yearsAtCompany - avgY), 0) / employees.length;
  const stdS = Math.sqrt(employees.reduce((acc, e) =>
    acc + (e.score - avgS) * (e.score - avgS), 0) / employees.length);
  const stdY = Math.sqrt(employees.reduce((acc, e) =>
    acc + (e.yearsAtCompany - avgY) * (e.yearsAtCompany - avgY), 0) / employees.length);
  if (stdS === 0 || stdY === 0) return 0;
  return cov / (stdS * stdY);
}

// ── Department summaries ──────────────────────────────────────────────────

function summarizeByDepartment(employees: Employee[]): DepartmentSummary[] {
  const depts = [...new Set(employees.map(e => e.department))];
  return depts.map(dept => {
    const group = employees.filter(e => e.department === dept);
    const headcount = group.length;
    const totalSalary = group.reduce((acc, e) => acc + e.salary, 0);
    const avgScore = headcount === 0 ? 0 : group.reduce((acc, e) => acc + e.score, 0) / headcount;
    const avgYears = headcount === 0 ? 0 : group.reduce((acc, e) => acc + e.yearsAtCompany, 0) / headcount;
    return { department: dept, headcount, totalSalary, avgScore, avgYears };
  });
}

function largestDepartment(employees: Employee[]): string {
  const summaries = summarizeByDepartment(employees);
  if (summaries.length === 0) return '';
  return summaries.sort((a, b) => b.headcount - a.headcount)[0].department;
}

function highestPayingDepartment(employees: Employee[]): string {
  const summaries = summarizeByDepartment(employees);
  if (summaries.length === 0) return '';
  return summaries.sort((a, b) => b.avgScore - a.avgScore)[0].department;
}

// ── Pay bands ─────────────────────────────────────────────────────────────

function buildPayBands(employees: Employee[]): PayBand[] {
  const bands: PayBand[] = [
    { label: 'junior', min: 0, max: 60000, count: 0 },
    { label: 'mid', min: 60000, max: 90000, count: 0 },
    { label: 'senior', min: 90000, max: 130000, count: 0 },
    { label: 'principal', min: 130000, max: Infinity, count: 0 },
  ];
  for (const e of employees) {
    const band = bands.find(b => e.salary >= b.min && e.salary < b.max);
    if (band) band.count++;
  }
  return bands;
}

function salaryPercentile(employees: Employee[], pct: number): number {
  if (employees.length === 0) return 0;
  const sorted = employees.map(e => e.salary).sort((a, b) => a - b);
  const idx = Math.floor((pct / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ── Project analytics ─────────────────────────────────────────────────────

function getBudgetUtilization(project: Project): number {
  if (project.budget === 0) return 0;
  return project.spent / project.budget;
}

function isOverBudget(project: Project): boolean {
  return project.spent > project.budget;
}

function projectEfficiency(project: Project): number {
  if (project.headcount === 0 || project.budget === 0) return 0;
  return project.budget / project.headcount;
}

function buildProjectReport(projects: Project[]): ProjectReport[] {
  return projects.map(p => ({
    id: p.id,
    name: p.name,
    utilization: getBudgetUtilization(p),
    overBudget: isOverBudget(p),
    efficiency: projectEfficiency(p),
  }));
}

function activeProjects(projects: Project[]): Project[] {
  return projects.filter(p => !p.completed);
}

function completedProjects(projects: Project[]): Project[] {
  return projects.filter(p => p.completed);
}

function highPriorityProjects(projects: Project[], minPriority: number): Project[] {
  return projects.filter(p => p.priority >= minPriority && !p.completed);
}

function totalBudget(projects: Project[]): number {
  return projects.reduce((acc, p) => acc + p.budget, 0);
}

function totalSpent(projects: Project[]): number {
  return projects.reduce((acc, p) => acc + p.spent, 0);
}

function averageBudgetUtilization(projects: Project[]): number {
  if (projects.length === 0) return 0;
  const total = projects.reduce((acc, p) => acc + getBudgetUtilization(p), 0);
  return total / projects.length;
}

// ── Review analytics ──────────────────────────────────────────────────────

function reviewsForEmployee(reviews: Review[], employeeId: string): Review[] {
  return reviews.filter(r => r.employeeId === employeeId);
}

function averageRating(reviews: Review[]): number {
  if (reviews.length === 0) return 0;
  return reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length;
}

function totalBonuses(reviews: Review[]): number {
  return reviews.reduce((acc, r) => acc + r.bonus, 0);
}

function topRatedEmployeeIds(reviews: Review[], n: number): string[] {
  const byEmployee = new Map<string, number[]>();
  for (const r of reviews) {
    const list = byEmployee.get(r.employeeId) ?? [];
    list.push(r.rating);
    byEmployee.set(r.employeeId, list);
  }
  return [...byEmployee.entries()]
    .map(([id, ratings]) => ({
      id,
      avg: ratings.reduce((a, b) => a + b, 0) / ratings.length,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, n)
    .map(e => e.id);
}

function reviewTrend(reviews: Review[], employeeId: string): number {
  const emp = reviewsForEmployee(reviews, employeeId).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.quarter - b.quarter);
  if (emp.length < 2) return 0;
  const first = emp[0].rating;
  const last = emp[emp.length - 1].rating;
  return last - first;
}

// ── Text reports ──────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPercent(ratio: number): string {
  return (ratio * 100).toFixed(1) + '%';
}

function employeeSummaryLine(e: Employee): string {
  return e.name + ' (' + e.department + ') — score: ' + e.score +
    ', salary: ' + formatCurrency(e.salary) +
    ', tenure: ' + e.yearsAtCompany + ' yrs';
}

function departmentReport(summary: DepartmentSummary): string {
  return '[' + summary.department + '] ' +
    'n=' + summary.headcount +
    ' avgScore=' + summary.avgScore.toFixed(1) +
    ' totalSalary=' + formatCurrency(summary.totalSalary) +
    ' avgTenure=' + summary.avgYears.toFixed(1) + 'y';
}

function projectStatusLine(r: ProjectReport): string {
  return r.name + ' util=' + formatPercent(r.utilization) +
    (r.overBudget ? ' [OVER BUDGET]' : '') +
    ' eff=' + r.efficiency.toFixed(0);
}

// ── Cross-domain helpers ───────────────────────────────────────────────────

function headcountByDept(employees: Employee[]): Record<string, number> {
  return employees.reduce((acc, e) => {
    acc[e.department] = (acc[e.department] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function avgSalaryByDept(employees: Employee[]): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const e of employees) {
    sums[e.department] = (sums[e.department] ?? 0) + e.salary;
    counts[e.department] = (counts[e.department] ?? 0) + 1;
  }
  const result: Record<string, number> = {};
  for (const dept of Object.keys(sums)) {
    result[dept] = sums[dept] / counts[dept];
  }
  return result;
}

function bonusEligibleEmployees(employees: Employee[], reviews: Review[]): Employee[] {
  const highReviewers = new Set(
    reviews.filter(r => r.rating >= 4).map(r => r.employeeId)
  );
  return employees.filter(e => e.active && highReviewers.has(e.id) && e.score >= 70);
}

function estimateAnnualBonus(e: Employee, reviews: Review[]): number {
  const empReviews = reviewsForEmployee(reviews, e.id);
  if (empReviews.length === 0) return 0;
  const avgR = averageRating(empReviews);
  return e.salary * (avgR / 10) * 0.15;
}

function rankEmployeesByValue(employees: Employee[]): Employee[] {
  return employees
    .filter(e => e.active)
    .sort((a, b) => {
      const scoreWeight = (b.score - a.score) * 0.6;
      const tenureWeight = (b.yearsAtCompany - a.yearsAtCompany) * 0.4;
      return scoreWeight + tenureWeight;
    });
}

function attritionRisk(employees: Employee[]): Employee[] {
  return employees.filter(e =>
    e.active && e.score >= 85 && e.yearsAtCompany >= 3 && e.salary < 90000
  );
}

function headcountForecast(employees: Employee[], growthRate: number, years: number): number {
  const active = employees.filter(e => e.active).length;
  return Math.round(active * Math.pow(1 + growthRate, years));
}

function payrollForecast(employees: Employee[], raiseRate: number): number {
  return employees
    .filter(e => e.active)
    .reduce((acc, e) => acc + e.salary * (1 + raiseRate), 0);
}

function equityScore(employees: Employee[]): number {
  if (employees.length < 2) return 1;
  const avg = averageSalary(employees);
  const deviations = employees.map(e => Math.abs(e.salary - avg) / avg);
  return 1 - deviations.reduce((a, b) => a + b, 0) / employees.length;
}

function diversityIndex(employees: Employee[]): number {
  const deptCounts = headcountByDept(employees);
  const total = employees.length;
  if (total === 0) return 0;
  const proportions = Object.values(deptCounts).map(n => n / total);
  return 1 - proportions.reduce((acc, p) => acc + p * p, 0);
}
