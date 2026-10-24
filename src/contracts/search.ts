export type ProjectSearchMatch = {
  path: string;
  relative: string;
  line: number;
  column: number;
  preview: string;
};

export type ProjectSearchResult = {
  matches: ProjectSearchMatch[];
  truncated: boolean;
};

export type ProjectSearchOptions = {
  cwd: string;
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  include?: string;
  exclude?: string;
  searchId: string;
};
