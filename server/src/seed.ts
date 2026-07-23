import type Database from "better-sqlite3";
import type { PropertyType } from "./types.js";

interface SeedSpec {
  id: string;
  parentId: string | null;
  title: string;
  icon: string;
  type?: "page" | "database" | "row";
}

interface SeedBlock {
  id: string;
  pageId: string;
  type: string;
  content: string;
  checked?: boolean;
}

interface SeedProperty {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  options: { id: string; label: string; color: string }[];
}

interface SeedCell {
  rowId: string;
  propertyId: string;
  value: unknown;
}

// Phase 4 seed: per-view settings for the two seeded databases. The shapes
// mirror ViewSettings exactly (a full object per view_kind). activeView is
// stored in meta under 'views:active:<databaseId>'. Together these give every
// view a non-trivial default the moment the app starts: the Project Tracker
// opens on a board grouped by Status and sorted by Priority; the Reading List
// opens on a table filtered/sorted and with a configured list view.
interface SeedView {
  databaseId: string;
  viewKind: "table" | "board" | "list";
  settings: unknown;
}

const SEED_VIEWS: SeedView[] = [
  // Project Tracker -- board grouped by Status, sorted by Priority asc.
  {
    databaseId: "project-tracker",
    viewKind: "board",
    settings: {
      filters: [],
      sort: { propertyId: "project-prop-priority", direction: "asc" },
      groupBy: "project-prop-status",
      listProps: [],
    },
  },
  // Reading List -- table sorted by Rating desc, Status is-not 'Want to read'.
  {
    databaseId: "reading-list",
    viewKind: "table",
    settings: {
      filters: [
        {
          id: "reading-filter-status",
          propertyId: "reading-prop-status",
          op: "is-not",
          value: "reading-opt-want",
        },
      ],
      sort: { propertyId: "reading-prop-rating", direction: "desc" },
      groupBy: null,
      listProps: [],
    },
  },
  // Reading List -- list view shows Author and Status.
  {
    databaseId: "reading-list",
    viewKind: "list",
    settings: {
      filters: [],
      sort: null,
      groupBy: null,
      listProps: ["reading-prop-author", "reading-prop-status"],
    },
  },
  // Packing List -- list view shows Category and Packed, sorted by Category.
  {
    databaseId: "packing-list",
    viewKind: "list",
    settings: {
      filters: [],
      sort: null,
      groupBy: null,
      listProps: ["packing-prop-category", "packing-prop-packed"],
    },
  },
  // Packing List -- table sorted by Packed asc (unchecked on top).
  {
    databaseId: "packing-list",
    viewKind: "table",
    settings: {
      filters: [],
      sort: { propertyId: "packing-prop-packed", direction: "asc" },
      groupBy: null,
      listProps: [],
    },
  },
];

// activeView per seeded database (defaults to 'table' when absent).
const SEED_VIEW_ACTIVE: Record<string, "table" | "board" | "list"> = {
  "project-tracker": "board",
  "reading-list": "table",
  "packing-list": "list",
};


// A realistic first-launch workspace, several levels deep, with emoji icons.
// Ids are stable slugs so seeded data is easy to reason about in tests/curls.
const SEED: SeedSpec[] = [
  { id: "home", parentId: null, title: "Home", icon: "\u{1F3E0}" },
  // A recipes page under Home, with a numbered recipe and a callout.
  {
    id: "recipes",
    parentId: "home",
    title: "Recipes",
    icon: "\u{1F95}",
  },

  { id: "projects", parentId: null, title: "Projects", icon: "\u{1F680}" },
  {
    id: "website-redesign",
    parentId: "projects",
    title: "Website Redesign",
    icon: "\u{1F310}",
  },
  {
    id: "launch-checklist",
    parentId: "website-redesign",
    title: "Launch Checklist",
    icon: "\u{1F4CB}",
  },
  {
    id: "design-system",
    parentId: "projects",
    title: "Design System",
    icon: "\u{1F3A8}",
  },
  {
    id: "blog-migration",
    parentId: "projects",
    title: "Blog Migration",
    icon: "\u{1F916}",
  },
  // Project Tracker: a database under Projects.
  {
    id: "project-tracker",
    parentId: "projects",
    title: "Project Tracker",
    icon: "\u{1F680}",
    type: "database",
  },

  // Reading List is a database: rows are typed book entries.
  {
    id: "reading-list",
    parentId: null,
    title: "Reading List",
    icon: "\u{1F4DA}",
    type: "database",
  },

  { id: "travel", parentId: null, title: "Travel", icon: "\u2708\u{FE0F}" },
  {
    id: "tokyo-trip",
    parentId: "travel",
    title: "Tokyo Trip",
    icon: "\u{1F5FC}",
  },
  // Packing List: a small database nested under Tokyo Trip so the workspace
  // unmistakably contains several databases. Rows are items to pack.
  {
    id: "packing-list",
    parentId: "tokyo-trip",
    title: "Packing List",
    icon: "\u{1F392}",
    type: "database",
  },
  {
    id: "nyc-weekend",
    parentId: "travel",
    title: "NYC Weekend",
    icon: "\u{1F5FD}",
  },

  { id: "notes", parentId: null, title: "Notes", icon: "\u{1F4DD}" },
  {
    id: "journal",
    parentId: "notes",
    title: "Journal",
    icon: "\u{1F4D3}",
  },
  // A few dated journal entries as nested pages, 3 levels under Notes.
  {
    id: "journal-2024-03",
    parentId: "journal",
    title: "March 2024",
    icon: "\u{1F4C5}",
  },
  {
    id: "journal-2024-04",
    parentId: "journal",
    title: "April 2024",
    icon: "\u{1F4C5}",
  },
  {
    id: "journal-2024-05",
    parentId: "journal",
    title: "May 2024",
    icon: "\u{1F4C5}",
  },
  {
    id: "ideas",
    parentId: "notes",
    title: "Ideas",
    icon: "\u{1F4A1}",
  },

  // ---- Reading List rows (each is a page of type 'row') ----
  { id: "reading-row-1", parentId: "reading-list", title: "The Pragmatic Programmer", icon: "\u{1F4D6}", type: "row" },
  { id: "reading-row-2", parentId: "reading-list", title: "Designing Data-Intensive Applications", icon: "\u{1F4D6}", type: "row" },
  { id: "reading-row-3", parentId: "reading-list", title: "The Making of Prince of Persia", icon: "\u{1F4D6}", type: "row" },
  { id: "reading-row-4", parentId: "reading-list", title: "Sapiens", icon: "\u{1F4D6}", type: "row" },
  { id: "reading-row-5", parentId: "reading-list", title: "The Name of the Wind", icon: "\u{1F4D6}", type: "row" },
  { id: "reading-row-6", parentId: "reading-list", title: "A Brief History of Time", icon: "\u{1F4D6}", type: "row" },
  { id: "reading-row-7", parentId: "reading-list", title: "Clean Code", icon: "\u{1F4D6}", type: "row" },
  { id: "reading-row-8", parentId: "reading-list", title: "How to Read a Book", icon: "\u{1F4D6}", type: "row" },

  // ---- Project Tracker rows ----
  { id: "project-row-1", parentId: "project-tracker", title: "Auth refactor", icon: "\u{1F4CC}", type: "row" },
  { id: "project-row-2", parentId: "project-tracker", title: "Settings page redesign", icon: "\u{1F4CC}", type: "row" },
  { id: "project-row-3", parentId: "project-tracker", title: "API rate limiting", icon: "\u{1F4CC}", type: "row" },
  { id: "project-row-4", parentId: "project-tracker", title: "Dark mode polish", icon: "\u{1F4CC}", type: "row" },
  { id: "project-row-5", parentId: "project-tracker", title: "Migrate to SQLite WAL", icon: "\u{1F4CC}", type: "row" },
  { id: "project-row-6", parentId: "project-tracker", title: "Onboarding tour", icon: "\u{1F4CC}", type: "row" },
  { id: "project-row-7", parentId: "project-tracker", title: "Search index", icon: "\u{1F4CC}", type: "row" },
  { id: "project-row-8", parentId: "project-tracker", title: "Component library docs", icon: "\u{1F4CC}", type: "row" },

  // ---- Packing List rows ----
  { id: "packing-row-1", parentId: "packing-list", title: "Passport", icon: "\u{1F4C4}", type: "row" },
  { id: "packing-row-2", parentId: "packing-list", title: "JR Pass", icon: "\u{1F689}", type: "row" },
  { id: "packing-row-3", parentId: "packing-list", title: "Pocket Wi-Fi", icon: "\u{1F4F1}", type: "row" },
  { id: "packing-row-4", parentId: "packing-list", title: "Light rain jacket", icon: "\u{1F9E5}", type: "row" },
  { id: "packing-row-5", parentId: "packing-list", title: "Running shoes", icon: "\u{1F45F}", type: "row" },
  { id: "packing-row-6", parentId: "packing-list", title: "Phone charger", icon: "\u{1F50C}", type: "row" },
  { id: "packing-row-7", parentId: "packing-list", title: "Plug adapter (Type A)", icon: "\u{1F50C}", type: "row" },
  { id: "packing-row-8", parentId: "packing-list", title: "Notebook and pen", icon: "\u{1F4DD}", type: "row" },
  { id: "packing-row-9", parentId: "packing-list", title: "Passport photocopies", icon: "\u{1F4C4}", type: "row" },
];

// Block seed, grouped per page and in display order. Every one of the 11 block
// types appears at least once across these pages. Block ids are stable slugs so
// they can be referenced from tests and curl.
const SEED_BLOCKS: SeedBlock[] = [
  // Home -- callout welcome, headings, paragraph, quote, divider.
  {
    id: "home-b1",
    pageId: "home",
    type: "callout",
    content:
      "Welcome to your Personal Space — a private workspace for notes, plans, and ideas. Everything stays on your machine.",
  },
  { id: "home-b2", pageId: "home", type: "heading1", content: "Getting started" },
  {
    id: "home-b3",
    pageId: "home",
    type: "paragraph",
    content:
      "Pages save automatically as you type — there is no save button. Click any block to edit it, and press / to open the block menu.",
  },
  {
    id: "home-b4",
    pageId: "home",
    type: "quote",
    content: "The palest ink is better than the best memory. — Chinese proverb",
  },
  { id: "home-b5", pageId: "home", type: "divider", content: "" },
  { id: "home-b6", pageId: "home", type: "heading2", content: "Your workspace" },
  {
    id: "home-b7",
    pageId: "home",
    type: "paragraph",
    content:
      "The sidebar lists every page. Pages can nest to any depth, and a database is just a special kind of page.",
  },
  // A small "Today" todo section to make Home feel lived-in.
  { id: "home-b8", pageId: "home", type: "heading2", content: "Today" },
  {
    id: "home-b9",
    pageId: "home",
    type: "todo",
    content: "Review the search endpoint PR",
    checked: true,
  },
  {
    id: "home-b10",
    pageId: "home",
    type: "todo",
    content: "Reply to the design review thread",
  },
  {
    id: "home-b11",
    pageId: "home",
    type: "todo",
    content: "Walk for 20 minutes after lunch",
  },
  {
    id: "home-b12",
    pageId: "home",
    type: "todo",
    content: "Skim the new DDIA chapter on replication",
    checked: true,
  },

  // Recipes -- a numbered recipe plus a callout, under Home.
  {
    id: "recipes-b1",
    pageId: "recipes",
    type: "heading1",
    content: "Weeknight Miso Soup",
  },
  {
    id: "recipes-b2",
    pageId: "recipes",
    type: "paragraph",
    content:
      "A 15-minute miso soup that scales from one bowl to a pot. Use dashi stock if you have it; otherwise a pinch of bonito flakes in hot water works.",
  },
  {
    id: "recipes-b3",
    pageId: "recipes",
    type: "heading2",
    content: "Ingredients (serves 2)",
  },
  {
    id: "recipes-b4",
    pageId: "recipes",
    type: "bulleted",
    content: "4 cups dashi (or water + 1 tsp dashi powder)",
  },
  {
    id: "recipes-b5",
    pageId: "recipes",
    type: "bulleted",
    content: "3 tbsp white miso paste",
  },
  {
    id: "recipes-b6",
    pageId: "recipes",
    type: "bulleted",
    content: "1 block soft tofu, cubed",
  },
  {
    id: "recipes-b7",
    pageId: "recipes",
    type: "bulleted",
    content: "2 spring onions, thinly sliced",
  },
  {
    id: "recipes-b8",
    pageId: "recipes",
    type: "bulleted",
    content: "A small handful of wakame, soaked",
  },
  {
    id: "recipes-b9",
    pageId: "recipes",
    type: "heading2",
    content: "Method",
  },
  {
    id: "recipes-b10",
    pageId: "recipes",
    type: "numbered",
    content: "Bring the dashi to a gentle simmer in a saucepan.",
  },
  {
    id: "recipes-b11",
    pageId: "recipes",
    type: "numbered",
    content:
      "Add the tofu and wakame; cook for about a minute until warmed through.",
  },
  {
    id: "recipes-b12",
    pageId: "recipes",
    type: "numbered",
    content:
      "Off the heat, whisk the miso into a ladle of broth, then stir it back in — never boil miso, it kills the aroma.",
  },
  {
    id: "recipes-b13",
    pageId: "recipes",
    type: "numbered",
    content: "Ladle into bowls and top with spring onion.",
  },
  {
    id: "recipes-b14",
    pageId: "recipes",
    type: "callout",
    content:
      "Tip: dissolve the miso through a fine strainer for a silky, scum-free broth.",
  },

  // Launch Checklist -- todos (some checked) + a numbered list.
  {
    id: "launch-b1",
    pageId: "launch-checklist",
    type: "heading1",
    content: "Launch Checklist",
  },
  {
    id: "launch-b2",
    pageId: "launch-checklist",
    type: "todo",
    content: "Run a performance audit on the homepage",
  },
  {
    id: "launch-b3",
    pageId: "launch-checklist",
    type: "todo",
    content: "Set up redirect from the old domain",
    checked: true,
  },
  {
    id: "launch-b4",
    pageId: "launch-checklist",
    type: "todo",
    content: "Configure analytics and error reporting",
    checked: true,
  },
  {
    id: "launch-b5",
    pageId: "launch-checklist",
    type: "todo",
    content: "Final cross-browser QA pass",
  },
  {
    id: "launch-b6",
    pageId: "launch-checklist",
    type: "todo",
    content: "Schedule the launch announcement",
  },
  {
    id: "launch-b7",
    pageId: "launch-checklist",
    type: "heading2",
    content: "On launch day",
  },
  {
    id: "launch-b8",
    pageId: "launch-checklist",
    type: "numbered",
    content: "Notify the team in #launches",
  },
  {
    id: "launch-b9",
    pageId: "launch-checklist",
    type: "numbered",
    content: "Update the status page",
  },
  {
    id: "launch-b10",
    pageId: "launch-checklist",
    type: "numbered",
    content: "Archive the staging branch",
  },

  // Tokyo Trip -- headings h2/h3, bulleted list, code block, quote.
  { id: "tokyo-b1", pageId: "tokyo-trip", type: "heading1", content: "Tokyo Trip" },
  { id: "tokyo-b2", pageId: "tokyo-trip", type: "heading2", content: "Itinerary" },
  {
    id: "tokyo-b3",
    pageId: "tokyo-trip",
    type: "heading3",
    content: "Day 1 — Shibuya & Harajuku",
  },
  {
    id: "tokyo-b4",
    pageId: "tokyo-trip",
    type: "bulleted",
    content: "Arrive at Haneda, pick up a pocket Wi-Fi",
  },
  {
    id: "tokyo-b5",
    pageId: "tokyo-trip",
    type: "bulleted",
    content: "Shibuya Crossing and the Hachiko statue",
  },
  {
    id: "tokyo-b6",
    pageId: "tokyo-trip",
    type: "bulleted",
    content: "Meiji Shrine in the afternoon",
  },
  {
    id: "tokyo-b7",
    pageId: "tokyo-trip",
    type: "heading3",
    content: "Day 2 — Asakusa & Akihabara",
  },
  {
    id: "tokyo-b8",
    pageId: "tokyo-trip",
    type: "bulleted",
    content: "Senso-ji temple, early to beat the crowds",
  },
  {
    id: "tokyo-b9",
    pageId: "tokyo-trip",
    type: "bulleted",
    content: "Akihabara for electronics and arcades",
  },
  { id: "tokyo-b10", pageId: "tokyo-trip", type: "heading2", content: "Packing" },
  {
    id: "tokyo-b11",
    pageId: "tokyo-trip",
    type: "code",
    content:
      '{\n  "essentials": ["passport", "JR pass", "pocket Wi-Fi", "IC card"],\n  "clothes": ["light layers", "comfortable shoes"],\n  "electronics": ["phone charger", "plug adapter (Type A)"]\n}',
  },
  {
    id: "tokyo-b12",
    pageId: "tokyo-trip",
    type: "quote",
    content: "When in Tokyo, eat everything.",
  },

  // Reading List -- the database page keeps some free-form content too.
  {
    id: "reading-b1",
    pageId: "reading-list",
    type: "heading1",
    content: "Reading List",
  },
  {
    id: "reading-b2",
    pageId: "reading-list",
    type: "paragraph",
    content: "Books I am working through or want to read next. Each row is a book with typed properties and its own notes.",
  },

  // Reading List rows -- a few get free-form blocks (notes + quotes).
  {
    id: "reading-row-1-b1",
    pageId: "reading-row-1",
    type: "paragraph",
    content:
      "A foundational book on software craftsmanship. The chapters on DRY, orthogonality, and tracer bullets still hold up years later.",
  },
  {
    id: "reading-row-1-b2",
    pageId: "reading-row-1",
    type: "quote",
    content: "Don't repeat yourself (DRY).",
  },
  {
    id: "reading-row-3-b1",
    pageId: "reading-row-3",
    type: "quote",
    content: "Journals are the fresnels of the soul.",
  },
  {
    id: "reading-row-5-b1",
    pageId: "reading-row-5",
    type: "paragraph",
    content:
      "A lush, slow-burning fantasy built on naming and silence. Worth the long setup for the prose alone.",
  },
  {
    id: "reading-row-5-b2",
    pageId: "reading-row-5",
    type: "quote",
    content: "Words are pale shadows of forgotten names.",
  },

  // Project Tracker rows -- two get a short note.
  {
    id: "project-row-1-b1",
    pageId: "project-row-1",
    type: "paragraph",
    content:
      "Refactor the auth module to use rotating refresh tokens and move session state out of the app server.",
  },
  {
    id: "project-row-4-b1",
    pageId: "project-row-4",
    type: "paragraph",
    content:
      "Polish dark mode across the settings and database views; verify contrast on the amber and purple accents.",
  },

  // Packing List -- the database page keeps a short intro.
  {
    id: "packing-b1",
    pageId: "packing-list",
    type: "heading1",
    content: "Packing List",
  },
  {
    id: "packing-b2",
    pageId: "packing-list",
    type: "paragraph",
    content:
      "Everything that needs to make it into the bag before the flight. Tick the Packed column as you go; the list view sorts by category.",
  },
  {
    id: "packing-b3",
    pageId: "packing-list",
    type: "callout",
    content:
      "Liquids and battery packs ride in carry-on, never checked. Keep the passport separate from the photocopies.",
  },

  // Journal -- a short index page introducing the entries.
  {
    id: "journal-b1",
    pageId: "journal",
    type: "heading1",
    content: "Journal",
  },
  {
    id: "journal-b2",
    pageId: "journal",
    type: "paragraph",
    content:
      "A loose diary. Most entries are a few paragraphs and a quote; some are just a line or two. Nothing here is polished on purpose.",
  },

  // March 2024 entry.
  {
    id: "journal-03-b1",
    pageId: "journal-2024-03",
    type: "heading1",
    content: "March 2024",
  },
  {
    id: "journal-03-b2",
    pageId: "journal-2024-03",
    type: "paragraph",
    content:
      "March came in cold and stayed that way. I spent most of it in the same three rooms, working on the redesign and walking the same loop every evening. The routine felt less like a trap than a handrail.",
  },
  {
    id: "journal-03-b3",
    pageId: "journal-2024-03",
    type: "paragraph",
    content:
      "Shipped the search endpoint mid-month. It is a small thing — a substring match over titles — but watching it rank exact matches first felt like real craft for the first time in a while.",
  },
  {
    id: "journal-03-b4",
    pageId: "journal-2024-03",
    type: "callout",
    content:
      "Reminder for next month: stop optimizing the build before the feature exists.",
  },
  {
    id: "journal-03-b5",
    pageId: "journal-2024-03",
    type: "quote",
    content:
      "The days are long but the decades are short. — a friend, paraphrased",
  },

  // April 2024 entry.
  {
    id: "journal-04-b1",
    pageId: "journal-2024-04",
    type: "heading1",
    content: "April 2024",
  },
  {
    id: "journal-04-b2",
    pageId: "journal-2024-04",
    type: "paragraph",
    content:
      "April broke the routine. A week of travel, a wedding, and a cold that knocked me flat for three days. I read nothing useful and wrote less; the workspace waited patiently.",
  },
  {
    id: "journal-04-b3",
    pageId: "journal-2024-04",
    type: "paragraph",
    content:
      "Came back to the database views and found the board grouping finally made sense once the Project Tracker had enough rows in every column. Empty columns are the enemy of a good board.",
  },
  {
    id: "journal-04-b4",
    pageId: "journal-2024-04",
    type: "quote",
    content: "Make a thing, then make it make sense.",
  },

  // May 2024 entry.
  {
    id: "journal-05-b1",
    pageId: "journal-2024-05",
    type: "heading1",
    content: "May 2024",
  },
  {
    id: "journal-05-b2",
    pageId: "journal-2024-05",
    type: "paragraph",
    content:
      "May was for finishing things. The packing list database, the recipes page, a handful of half-written notes that had been sitting around since winter. Closing loops is its own kind of rest.",
  },
  {
    id: "journal-05-b3",
    pageId: "journal-2024-05",
    type: "callout",
    content:
      "Note to self: the miso soup recipe is good enough to make again. Double the wakame next time.",
  },

  // Ideas -- bullets, a code block, and a todo or two.
  {
    id: "ideas-b1",
    pageId: "ideas",
    type: "heading1",
    content: "Ideas",
  },
  {
    id: "ideas-b2",
    pageId: "ideas",
    type: "paragraph",
    content:
      "Half-formed things I do not want to lose. Most of them go nowhere; a few turn into projects.",
  },
  {
    id: "ideas-b3",
    pageId: "ideas",
    type: "heading2",
    content: "Product",
  },
  {
    id: "ideas-b4",
    pageId: "ideas",
    type: "bulleted",
    content: "A 'recently edited' shelf on the Home page",
  },
  {
    id: "ideas-b5",
    pageId: "ideas",
    type: "bulleted",
    content: "Keyboard-only navigation for the sidebar tree",
  },
  {
    id: "ideas-b6",
    pageId: "ideas",
    type: "bulleted",
    content: "Per-database 'empty state' text the user can edit",
  },
  {
    id: "ideas-b7",
    pageId: "ideas",
    type: "heading2",
    content: "Technical",
  },
  {
    id: "ideas-b8",
    pageId: "ideas",
    type: "bulleted",
    content: "FTS5 table for full-text search across block content too",
  },
  {
    id: "ideas-b9",
    pageId: "ideas",
    type: "bulleted",
    content: "Share prepared statements across requests for the hot paths",
  },
  {
    id: "ideas-b10",
    pageId: "ideas",
    type: "code",
    content:
      "// Sketch: rank by edit recency as a tiebreak after title rank.\nfunction recencyRank(lastEditedAt: number): number {\n  const days = (Date.now() - lastEditedAt) / 86_400_000;\n  return Math.min(days, 30) / 30; // 0 (fresh) .. 1 (a month old)\n}",
  },
  {
    id: "ideas-b11",
    pageId: "ideas",
    type: "heading2",
    content: "Try this week",
  },
  {
    id: "ideas-b12",
    pageId: "ideas",
    type: "todo",
    content: "Prototype the 'recently edited' shelf",
    checked: true,
  },
  {
    id: "ideas-b13",
    pageId: "ideas",
    type: "todo",
    content: "Read the FTS5 docs for one evening, no commitments",
  },
];

// Database properties for the seeded databases. Options are written through
// the same JSON column the repository uses, so the colors/labels show up
// identically whether seeded or created at runtime.
const SEED_PROPERTIES: SeedProperty[] = [
  // ---- Reading List ----
  { id: "reading-prop-author", databaseId: "reading-list", name: "Author", type: "text", options: [] },
  {
    id: "reading-prop-status",
    databaseId: "reading-list",
    name: "Status",
    type: "select",
    options: [
      { id: "reading-opt-want", label: "Want to read", color: "gray" },
      { id: "reading-opt-reading", label: "Reading", color: "blue" },
      { id: "reading-opt-finished", label: "Finished", color: "green" },
    ],
  },
  {
    id: "reading-prop-genre",
    databaseId: "reading-list",
    name: "Genre",
    type: "multiSelect",
    options: [
      { id: "reading-genre-fiction", label: "Fiction", color: "purple" },
      { id: "reading-genre-tech", label: "Tech", color: "amber" },
      { id: "reading-genre-history", label: "History", color: "red" },
      { id: "reading-genre-science", label: "Science", color: "green" },
    ],
  },
  { id: "reading-prop-started", databaseId: "reading-list", name: "Started", type: "date", options: [] },
  { id: "reading-prop-owned", databaseId: "reading-list", name: "Owned", type: "checkbox", options: [] },
  { id: "reading-prop-goodreads", databaseId: "reading-list", name: "Goodreads", type: "url", options: [] },
  { id: "reading-prop-rating", databaseId: "reading-list", name: "Rating", type: "number", options: [] },

  // ---- Project Tracker ----
  {
    id: "project-prop-status",
    databaseId: "project-tracker",
    name: "Status",
    type: "select",
    options: [
      { id: "project-status-todo", label: "To do", color: "gray" },
      { id: "project-status-inprogress", label: "In progress", color: "blue" },
      { id: "project-status-blocked", label: "Blocked", color: "red" },
      { id: "project-status-done", label: "Done", color: "green" },
    ],
  },
  {
    id: "project-prop-priority",
    databaseId: "project-tracker",
    name: "Priority",
    type: "select",
    options: [
      { id: "project-priority-high", label: "High", color: "red" },
      { id: "project-priority-medium", label: "Medium", color: "amber" },
      { id: "project-priority-low", label: "Low", color: "gray" },
    ],
  },
  { id: "project-prop-due", databaseId: "project-tracker", name: "Due", type: "date", options: [] },
  { id: "project-prop-estimate", databaseId: "project-tracker", name: "Estimate", type: "number", options: [] },
  {
    id: "project-prop-tags",
    databaseId: "project-tracker",
    name: "Tags",
    type: "multiSelect",
    options: [
      { id: "project-tag-frontend", label: "Frontend", color: "blue" },
      { id: "project-tag-backend", label: "Backend", color: "purple" },
      { id: "project-tag-design", label: "Design", color: "amber" },
      { id: "project-tag-ops", label: "Ops", color: "green" },
    ],
  },
  { id: "project-prop-archived", databaseId: "project-tracker", name: "Archived", type: "checkbox", options: [] },
  { id: "project-prop-spec", databaseId: "project-tracker", name: "Spec", type: "url", options: [] },

  // ---- Packing List ----
  {
    id: "packing-prop-packed",
    databaseId: "packing-list",
    name: "Packed",
    type: "checkbox",
    options: [],
  },
  {
    id: "packing-prop-category",
    databaseId: "packing-list",
    name: "Category",
    type: "select",
    options: [
      { id: "packing-cat-clothing", label: "Clothing", color: "blue" },
      { id: "packing-cat-tech", label: "Tech", color: "amber" },
      { id: "packing-cat-docs", label: "Docs", color: "green" },
      { id: "packing-cat-toiletries", label: "Toiletries", color: "purple" },
    ],
  },
  { id: "packing-prop-notes", databaseId: "packing-list", name: "Notes", type: "text", options: [] },
];

// Cell values for seeded rows. The value is JSON-encoded per the property
// type when written, exactly as the repository stores runtime edits.
const SEED_CELLS: SeedCell[] = [
  // ---- Reading List rows ----
  cell("reading-row-1", "reading-prop-author", "Hunt & Thomas"),
  cell("reading-row-1", "reading-prop-status", "reading-opt-finished"),
  cell("reading-row-1", "reading-prop-genre", ["reading-genre-tech"]),
  cell("reading-row-1", "reading-prop-started", "2019-03-12"),
  cell("reading-row-1", "reading-prop-owned", true),
  cell("reading-row-1", "reading-prop-goodreads", "https://www.goodreads.com/book/show/4099.The_Pragmatic_Programmer"),
  cell("reading-row-1", "reading-prop-rating", 5),

  cell("reading-row-2", "reading-prop-author", "Martin Kleppmann"),
  cell("reading-row-2", "reading-prop-status", "reading-opt-reading"),
  cell("reading-row-2", "reading-prop-genre", ["reading-genre-tech"]),
  cell("reading-row-2", "reading-prop-started", "2024-01-08"),
  cell("reading-row-2", "reading-prop-owned", true),
  cell("reading-row-2", "reading-prop-goodreads", "https://www.goodreads.com/book/show/23463279-designing-data-intensive-applications"),
  cell("reading-row-2", "reading-prop-rating", 5),

  cell("reading-row-3", "reading-prop-author", "Jordan Mechner"),
  cell("reading-row-3", "reading-prop-status", "reading-opt-finished"),
  cell("reading-row-3", "reading-prop-genre", ["reading-genre-history"]),
  cell("reading-row-3", "reading-prop-started", "2020-06-01"),
  cell("reading-row-3", "reading-prop-owned", true),
  cell("reading-row-3", "reading-prop-goodreads", "https://www.goodreads.com/book/show/104340-the-making-of-prince-of-persia"),
  cell("reading-row-3", "reading-prop-rating", 4),

  cell("reading-row-4", "reading-prop-author", "Yuval Harari"),
  cell("reading-row-4", "reading-prop-status", "reading-opt-want"),
  cell("reading-row-4", "reading-prop-genre", ["reading-genre-history", "reading-genre-science"]),
  cell("reading-row-4", "reading-prop-started", "2024-09-15"),
  cell("reading-row-4", "reading-prop-owned", false),
  cell("reading-row-4", "reading-prop-goodreads", "https://www.goodreads.com/book/show/23692271-sapiens"),
  cell("reading-row-4", "reading-prop-rating", 4),

  cell("reading-row-5", "reading-prop-author", "Patrick Rothfuss"),
  cell("reading-row-5", "reading-prop-status", "reading-opt-reading"),
  cell("reading-row-5", "reading-prop-genre", ["reading-genre-fiction"]),
  cell("reading-row-5", "reading-prop-started", "2023-11-20"),
  cell("reading-row-5", "reading-prop-owned", true),
  cell("reading-row-5", "reading-prop-goodreads", "https://www.goodreads.com/book/show/18607437-the-name-of-the-wind"),
  cell("reading-row-5", "reading-prop-rating", 5),

  cell("reading-row-6", "reading-prop-author", "Stephen Hawking"),
  cell("reading-row-6", "reading-prop-status", "reading-opt-finished"),
  cell("reading-row-6", "reading-prop-genre", ["reading-genre-science"]),
  cell("reading-row-6", "reading-prop-started", "2018-07-22"),
  cell("reading-row-6", "reading-prop-owned", false),
  cell("reading-row-6", "reading-prop-goodreads", "https://www.goodreads.com/book/show/3869-a-brief-history-of-time"),
  cell("reading-row-6", "reading-prop-rating", 4),

  cell("reading-row-7", "reading-prop-author", "Robert Martin"),
  cell("reading-row-7", "reading-prop-status", "reading-opt-want"),
  cell("reading-row-7", "reading-prop-genre", ["reading-genre-tech"]),
  cell("reading-row-7", "reading-prop-started", "2024-10-01"),
  cell("reading-row-7", "reading-prop-owned", true),
  cell("reading-row-7", "reading-prop-goodreads", "https://www.goodreads.com/book/show/3735293-clean-code"),
  cell("reading-row-7", "reading-prop-rating", 3),

  cell("reading-row-8", "reading-prop-author", "Adler & Van Doren"),
  cell("reading-row-8", "reading-prop-status", "reading-opt-finished"),
  cell("reading-row-8", "reading-prop-genre", ["reading-genre-tech"]),
  cell("reading-row-8", "reading-prop-started", "2017-09-01"),
  cell("reading-row-8", "reading-prop-owned", true),
  cell("reading-row-8", "reading-prop-goodreads", "https://www.goodreads.com/book/show/56757.How_to_Read_a_Book"),
  cell("reading-row-8", "reading-prop-rating", 4),

  // ---- Project Tracker rows ----
  cell("project-row-1", "project-prop-status", "project-status-inprogress"),
  cell("project-row-1", "project-prop-priority", "project-priority-high"),
  cell("project-row-1", "project-prop-due", "2024-12-15"),
  cell("project-row-1", "project-prop-estimate", 8),
  cell("project-row-1", "project-prop-tags", ["project-tag-backend"]),
  cell("project-row-1", "project-prop-archived", false),
  cell("project-row-1", "project-prop-spec", "https://example.com/spec/auth"),

  cell("project-row-2", "project-prop-status", "project-status-todo"),
  cell("project-row-2", "project-prop-priority", "project-priority-medium"),
  cell("project-row-2", "project-prop-due", "2025-01-20"),
  cell("project-row-2", "project-prop-estimate", 5),
  cell("project-row-2", "project-prop-tags", ["project-tag-frontend", "project-tag-design"]),
  cell("project-row-2", "project-prop-archived", false),
  cell("project-row-2", "project-prop-spec", "https://example.com/spec/settings"),

  cell("project-row-3", "project-prop-status", "project-status-done"),
  cell("project-row-3", "project-prop-priority", "project-priority-high"),
  cell("project-row-3", "project-prop-due", "2024-11-30"),
  cell("project-row-3", "project-prop-estimate", 3),
  cell("project-row-3", "project-prop-tags", ["project-tag-backend", "project-tag-ops"]),
  cell("project-row-3", "project-prop-archived", false),
  cell("project-row-3", "project-prop-spec", "https://example.com/spec/ratelimit"),

  cell("project-row-4", "project-prop-status", "project-status-inprogress"),
  cell("project-row-4", "project-prop-priority", "project-priority-medium"),
  cell("project-row-4", "project-prop-due", "2024-12-10"),
  cell("project-row-4", "project-prop-estimate", 2),
  cell("project-row-4", "project-prop-tags", ["project-tag-frontend", "project-tag-design"]),
  cell("project-row-4", "project-prop-archived", false),
  cell("project-row-4", "project-prop-spec", "https://example.com/spec/darkmode"),

  cell("project-row-5", "project-prop-status", "project-status-done"),
  cell("project-row-5", "project-prop-priority", "project-priority-low"),
  cell("project-row-5", "project-prop-due", "2024-10-15"),
  cell("project-row-5", "project-prop-estimate", 1),
  cell("project-row-5", "project-prop-tags", ["project-tag-backend"]),
  cell("project-row-5", "project-prop-archived", true),
  cell("project-row-5", "project-prop-spec", "https://example.com/spec/wal"),

  cell("project-row-6", "project-prop-status", "project-status-blocked"),
  cell("project-row-6", "project-prop-priority", "project-priority-low"),
  cell("project-row-6", "project-prop-due", "2025-02-01"),
  cell("project-row-6", "project-prop-estimate", 6),
  cell("project-row-6", "project-prop-tags", ["project-tag-frontend"]),
  cell("project-row-6", "project-prop-archived", false),
  cell("project-row-6", "project-prop-spec", "https://example.com/spec/onboarding"),

  cell("project-row-7", "project-prop-status", "project-status-todo"),
  cell("project-row-7", "project-prop-priority", "project-priority-high"),
  cell("project-row-7", "project-prop-due", "2025-01-31"),
  cell("project-row-7", "project-prop-estimate", 5),
  cell("project-row-7", "project-prop-tags", ["project-tag-backend"]),
  cell("project-row-7", "project-prop-archived", false),
  cell("project-row-7", "project-prop-spec", "https://example.com/spec/search"),

  cell("project-row-8", "project-prop-status", "project-status-inprogress"),
  cell("project-row-8", "project-prop-priority", "project-priority-low"),
  cell("project-row-8", "project-prop-due", "2024-12-20"),
  cell("project-row-8", "project-prop-estimate", 2),
  cell("project-row-8", "project-prop-tags", ["project-tag-design"]),
  cell("project-row-8", "project-prop-archived", false),
  cell("project-row-8", "project-prop-spec", "https://example.com/spec/docs"),

  // ---- Packing List rows ----
  cell("packing-row-1", "packing-prop-packed", true),
  cell("packing-row-1", "packing-prop-category", "packing-cat-docs"),
  cell("packing-row-1", "packing-prop-notes", "Expires 2029; keep separate from photocopies."),

  cell("packing-row-2", "packing-prop-packed", true),
  cell("packing-row-2", "packing-prop-category", "packing-cat-docs"),
  cell("packing-row-2", "packing-prop-notes", "Activate at Narita airport arrivals."),

  cell("packing-row-3", "packing-prop-packed", false),
  cell("packing-row-3", "packing-prop-category", "packing-cat-tech"),
  cell("packing-row-3", "packing-prop-notes", "Pick up at the airport counter, pre-booked."),

  cell("packing-row-4", "packing-prop-packed", false),
  cell("packing-row-4", "packing-prop-category", "packing-cat-clothing"),
  cell("packing-row-4", "packing-prop-notes", "Spring in Tokyo is rainy; pack something light."),

  cell("packing-row-5", "packing-prop-packed", true),
  cell("packing-row-5", "packing-prop-category", "packing-cat-clothing"),
  cell("packing-row-5", "packing-prop-notes", "For the morning run along the Meguro river."),

  cell("packing-row-6", "packing-prop-packed", true),
  cell("packing-row-6", "packing-prop-category", "packing-cat-tech"),
  cell("packing-row-6", "packing-prop-notes", "USB-C cable; battery pack in carry-on only."),

  cell("packing-row-7", "packing-prop-packed", false),
  cell("packing-row-7", "packing-prop-category", "packing-cat-tech"),
  cell("packing-row-7", "packing-prop-notes", "Japan is Type A; a single adapter covers everything."),

  cell("packing-row-8", "packing-prop-packed", true),
  cell("packing-row-8", "packing-prop-category", "packing-cat-toiletries"),
  cell("packing-row-8", "packing-prop-notes", "For sketching temples and jotting meal notes."),

  cell("packing-row-9", "packing-prop-packed", false),
  cell("packing-row-9", "packing-prop-category", "packing-cat-docs"),
  cell("packing-row-9", "packing-prop-notes", "Stashed separately from the passport, just in case."),
];

/** Build a SeedCell (helper keeps the value table readable). */
function cell(rowId: string, propertyId: string, value: unknown): SeedCell {
  return { rowId, propertyId, value };
}

/**
 * Seed the pages table on first launch only.
 *
 * "First launch" is recorded in the `meta` table: when the `seeded` key is
 * absent the workspace has never been initialized, so we insert the seed data
 * and then set `meta.seeded = '1'`. Subsequent starts find the key and do
 * nothing, even if the user has since deleted every page -- a deliberately
 * emptied workspace stays empty across restarts (DEF-003).
 */
export function seedIfEmpty(db: Database.Database): void {
  const already = db
    .prepare("SELECT value FROM meta WHERE key = 'seeded'")
    .get() as { value: string } | undefined;
  if (already !== undefined) return;

  // Assign per-sibling positions in declaration order.
  const maxByParent = new Map<string | null, number>();
  const insert = db.prepare(
    `INSERT INTO pages (id, parent_id, title, icon, type, position)
     VALUES (@id, @parent_id, @title, @icon, @type, @position)`,
  );
  const insertBlock = db.prepare(
    `INSERT INTO blocks (id, page_id, type, content, checked, position)
     VALUES (@id, @page_id, @type, @content, @checked, @position)`,
  );
  const insertProperty = db.prepare(
    `INSERT INTO properties (id, database_id, name, type, options, position)
     VALUES (@id, @database_id, @name, @type, @options, @position)`,
  );
  const insertCell = db.prepare(
    `INSERT INTO row_values (row_id, property_id, value) VALUES (?, ?, ?)`,
  );
  const insertView = db.prepare(
    `INSERT INTO view_settings (database_id, view_kind, settings)
     VALUES (?, ?, ?)`,
  );
  const insertViewActive = db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)`,
  );
  const tx = db.transaction((items: SeedSpec[]) => {
    for (const item of items) {
      const key = item.parentId;
      const next = (maxByParent.get(key) ?? -1) + 1;
      maxByParent.set(key, next);
      insert.run({
        id: item.id,
        parent_id: item.parentId,
        title: item.title,
        icon: item.icon,
        type: item.type ?? "page",
        position: next,
      });
    }
    // Insert seeded blocks with dense per-page positions in declaration order.
    const posByPage = new Map<string, number>();
    for (const b of SEED_BLOCKS) {
      const p = posByPage.get(b.pageId) ?? 0;
      insertBlock.run({
        id: b.id,
        page_id: b.pageId,
        type: b.type,
        content: b.content,
        checked: b.checked === true ? 1 : 0,
        position: p,
      });
      posByPage.set(b.pageId, p + 1);
    }
    // Insert properties with dense per-database positions in declaration order.
    const posByDb = new Map<string, number>();
    for (const prop of SEED_PROPERTIES) {
      const p = posByDb.get(prop.databaseId) ?? 0;
      insertProperty.run({
        id: prop.id,
        database_id: prop.databaseId,
        name: prop.name,
        type: prop.type,
        options: JSON.stringify(prop.options),
        position: p,
      });
      posByDb.set(prop.databaseId, p + 1);
    }
    // Insert cell values, JSON-encoded per type.
    for (const c of SEED_CELLS) {
      insertCell.run(c.rowId, c.propertyId, JSON.stringify(c.value));
    }
    // Insert seeded per-view settings (Phase 4).
    for (const v of SEED_VIEWS) {
      insertView.run(v.databaseId, v.viewKind, JSON.stringify(v.settings));
    }
    for (const [dbId, active] of Object.entries(SEED_VIEW_ACTIVE)) {
      insertViewActive.run(`views:active:${dbId}`, active);
    }
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('seeded', '1')",
    ).run();
  });
  tx(SEED);
}
