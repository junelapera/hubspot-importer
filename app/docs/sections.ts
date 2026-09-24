export const SECTIONS = [
  { id: "overview", title: "What this app does" },
  { id: "example-dataset", title: "Example dataset" },
  { id: "prerequisites", title: "Prerequisites" },
  { id: "walkthrough", title: "Walkthrough" },
  { id: "reference", title: "Reference" },
  { id: "troubleshooting", title: "Troubleshooting" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];
