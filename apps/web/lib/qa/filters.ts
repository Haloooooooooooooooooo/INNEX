export type QaFilters = {
  tags: string[];
  source?: string;
  dateGte?: string;
  dateLte?: string;
};

export function parseQuestionFilters(input: string): { question: string; filters: QaFilters } {
  const tokens = input.trim().split(/\s+/);
  const filters: QaFilters = { tags: [] };
  const remains: string[] = [];

  for (const t of tokens) {
    if (/^tag:/i.test(t)) {
      const v = t.slice(4).trim();
      if (v) filters.tags.push(v);
      continue;
    }
    if (/^source:/i.test(t)) {
      const v = t.slice(7).trim();
      if (v) filters.source = v;
      continue;
    }
    if (/^date>=/i.test(t)) {
      const v = t.slice(6).trim();
      if (v) filters.dateGte = v;
      continue;
    }
    if (/^date<=/i.test(t)) {
      const v = t.slice(6).trim();
      if (v) filters.dateLte = v;
      continue;
    }
    remains.push(t);
  }

  return {
    question: remains.join(" ").trim(),
    filters,
  };
}

export function hasFilters(filters: QaFilters): boolean {
  return Boolean(filters.tags.length || filters.source || filters.dateGte || filters.dateLte);
}

