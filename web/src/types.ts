// Domain types for pages, databases, properties and rows.
//
// A row in the data model is the same shape as a page (`type === "row"`),
// so the existing Page union covers it. We extend PageType with "row" and
// add Property, PropertyOption and Row types used only by database views.

export type PageType = "page" | "database" | "row";

export interface Page {
  id: string;
  parentId: string | null;
  title: string;
  icon: string;
  type: PageType;
  position: number;
}

export type PageDraft = {
  parentId?: string | null;
  title?: string;
  icon?: string;
  type?: PageType;
};

export type PagePatch = {
  title?: string;
  icon?: string;
  parentId?: string | null;
  position?: number;
};

export interface PageNode {
  page: Page;
  children: PageNode[];
  depth: number;
}

// ---- Databases ----

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "date"
  | "checkbox"
  | "url";

export const PROPERTY_TYPES: PropertyType[] = [
  "text",
  "number",
  "select",
  "multiSelect",
  "date",
  "checkbox",
  "url",
];

export function isPropertyType(v: string): v is PropertyType {
  return (PROPERTY_TYPES as string[]).includes(v);
}

export type OptionColor =
  | "gray"
  | "red"
  | "amber"
  | "green"
  | "blue"
  | "purple"
  | "pink";

export const OPTION_COLORS: OptionColor[] = [
  "gray",
  "red",
  "amber",
  "green",
  "blue",
  "purple",
  "pink",
];

export interface PropertyOption {
  id: string;
  label: string;
  color: OptionColor;
}

export interface Property {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  options: PropertyOption[];
  position: number;
}

export type PropertyDraft = {
  name: string;
  type: PropertyType;
};

export type PropertyPatch = {
  name?: string;
  options?: PropertyOption[];
};

// Values stored against a row for a given property. The shape depends on
// the property's type; we model it as a discriminated union but the API
// sends a flat { [propertyId]: value } map.
export type CellValue =
  | string
  | number
  | null
  | boolean
  | string[];

export interface Row {
  id: string;
  databaseId: string;
  title: string;
  values: Record<string, CellValue>;
  position: number;
}

export type RowDraft = {
  title?: string;
  values?: Record<string, CellValue>;
};

export type RowPatch = {
  title?: string;
  values?: Record<string, CellValue>;
};

export interface DatabasePayload {
  database: Page;
  properties: Property[];
  rows: Row[];
}
