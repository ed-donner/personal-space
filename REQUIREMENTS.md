# Personal Space — Requirements

## Summary

Personal Space is a personal knowledge manager you run on your own computer — a private,
single-user take on Notion. It holds notes, plans and lists as free-form pages, and as databases
you can view as tables, boards and lists. There is one user, no login, and everything stays on
your machine.

It should feel like a real product from the first screen: quick to navigate, satisfying to edit,
and clearly capable. It ships pre-loaded with a realistic workspace so every feature is on display
the moment it starts.

## The product

### Pages and the sidebar

- The sidebar shows every page as an expandable tree. Pages nest inside pages to any depth.
- Pages can be created, renamed and deleted from the sidebar. Deleting a page asks for
  confirmation, then removes it and everything nested inside it.
- Each page can have an emoji icon, shown in the sidebar and in the page header.

### The editor

- A page is a stack of blocks, edited in place. Click anywhere and type. Changes save
  automatically — there is no save button.
- Block types: paragraph, heading 1, heading 2, heading 3, bulleted list, numbered list, to-do
  (with a working checkbox), quote, divider, code, and callout.
- Enter starts a new block below the current one; Backspace at the start of an empty block
  removes it.
- Typing `/` opens the slash menu: a filterable list of block types, usable by keyboard alone
  (arrows and Enter) or by mouse. Picking an entry inserts that block.
- Blocks can be dragged to a new position within the page.

### Databases

- A database is a special kind of page that holds rows with typed properties. Databases appear in
  the sidebar tree like any other page.
- Property types: text, number, select, multi-select, date, checkbox, and URL. Properties can be
  added, renamed and removed; a property's type is fixed when it is created.
- Select and multi-select options are user-defined, have colors, and are shared across the rows of
  that database.
- Every row has a title and opens as a page of its own: properties shown at the top, free-form
  blocks below.

### Views

- Every database offers three views over the same rows, switchable in place:
  - **Table** — rows and columns; add and delete rows, edit any cell in place, manage properties.
  - **Board** — cards in columns, grouped by a select property of your choosing. Dragging a card
    to another column changes that property's value.
  - **List** — a compact list of rows showing the title and a property or two.
- Each view keeps its own settings — filters, a sort, and (for the board) the grouping property —
  and those settings persist.
- Filters: one or more per view, combined with AND. Cover the property types sensibly: at least
  text contains, select is / is not, checkbox checked state, and date before / after.
- Sorting: by any property, ascending or descending.

### Search

- A quick-find, opened by a keyboard shortcut and by a visible control, searches page, database
  and row titles as you type. Choosing a result jumps straight to it.

### Appearance

- Light mode and dark mode, switched with a button that is always available. The choice persists.

## Seed data

On first launch the app is fully populated with a workspace that reads like a real person's:
projects, a reading list, travel plans, notes — spread across nested pages and several databases.
Together the seed exercises every block type, every property type, all three views, filters, sorts
and board grouping. The seed grows with the phases below, so no feature ships empty.

## High-level technical guidance

Just enough direction to keep things on track — specific choices are left to the Coding Agent.

- A single local web app written in **TypeScript**, with a **Node** backend and a **SQLite**
  database file for storage.
- Starts with **one documented command**; no accounts, no cloud, no internet needed to use it.
- **Prefer popular, well-supported libraries over custom code** — editing interactions, drag and
  drop, and testing are all areas where mature libraries beat hand-rolled work.
- End-to-end tests drive the real app in a real browser. The choice of tooling is the Coding
  Agent's.
- Keep the implementation simple and conventional. Library, data and structure choices are the
  Coding Agent's call, as long as the requirements and success criteria are met.

## Not in scope

Deliberately left out to keep this buildable in one pass. Do not build these:

- No login, accounts, sharing, permissions, collaboration or comments — single user, local only.
- No relations, rollups or formulas on database properties.
- No databases embedded inside ordinary pages — a database is always its own page in the tree.
- No file or image uploads.
- No trash or restore — deletion is permanent, behind a confirmation.
- No version history and no undo across sessions.
- No import or export.
- No changing a property's type after creation.

## Look and feel

Applies to the whole app:

- Make it **bold and impressive** — it should look designed on purpose. This is a product to show
  off, and first impressions matter.
- Palette: **`#ecad0a` (amber), `#209dd7` (blue) and `#753991` (purple)**, over grays. Both themes
  draw from the same palette; dark mode is a first-class theme, equally considered.
- Avoid the tells of generated design: overuse of gradients, purple-dominated backgrounds, and
  thin accent borders down one side of cards or panels.
- Beyond these rules, layout and visual style are the Coding Agent's call.

## Phases and success criteria

Build in these phases, in order. **Do not start a phase until every success criterion of the
previous phase is demonstrably met** — each criterion must be something you can show working, not
just assert.

Every phase closes the same loop: its unit tests pass, its end-to-end tests pass against the real
app in a real browser, and the new features have been used in the running app with screenshots
taken and inspected. Unit tests accompany every phase on both frontend and backend, building
toward the coverage target verified in Phase 6.

### Phase 1 — Running skeleton, pages and the sidebar

**Features**

- The app starts with one documented command and opens in a browser as Personal Space, with the
  sidebar and a page area.
- Pages stored in SQLite: nesting, emoji icons, create, rename, delete (with confirmation and
  cascading removal of nested pages).
- Seed: an initial tree of pages, several levels deep, with icons.
- The end-to-end test harness runs against the real app in a browser.

**Success criteria**

1. One documented command starts the app; opening the given URL shows the sidebar tree populated
   with the seeded pages and their icons.
2. Pages can be created, renamed and deleted from the sidebar; deleting a page with nested pages
   removes them too, after a confirmation.
3. Changes survive a browser refresh and a full app restart.
4. Unit tests for page create, read, rename and delete (including cascade) pass.
5. At least one end-to-end test starts the real app in a browser, creates a page, sees it in the
   sidebar, and passes.

### Phase 2 — The editor

**Features**

- All eleven block types, rendering visibly distinct from one another.
- Automatic saving, Enter/Backspace block behavior, the slash menu, and drag-to-reorder.
- Seed extended with pages that use every block type.

**Success criteria**

1. Every block type can be inserted from the slash menu and renders visibly distinct.
2. The slash menu filters as you type and works by keyboard alone and by mouse.
3. Edits save automatically: type into a block, refresh, and the content is unchanged. No save
   button exists anywhere.
4. To-do checkboxes toggle and their state persists.
5. Dragging a block to a new position reorders it, and the order survives a refresh.
6. Unit tests for block creation, editing, reordering and deletion pass.
7. End-to-end tests cover typing into a page, inserting a block via the slash menu, and dragging
   a block to reorder — and pass.

### Phase 3 — Databases and the table view

**Features**

- Databases as pages in the sidebar; rows with the seven property types.
- The table view: add and delete rows, edit any cell in place, add / rename / remove properties.
- Select and multi-select options with colors.
- A row opens as a page: properties at the top, blocks below.
- Seed extended with at least two databases with realistic content.

**Success criteria**

1. A database can be created and appears in the sidebar like any other page.
2. Each of the seven property types can be added to a database and edited in the table with an
   editor that fits the type (for example a date picker for dates, a checkbox for checkboxes, an
   option picker for selects).
3. Rows can be added and deleted; cell edits save in place and survive a refresh.
4. Select and multi-select options are user-defined, colored, and offered again on other rows of
   the same database.
5. Opening a row shows it as a page — properties at the top, editable blocks below — and edits to
   both persist.
6. Unit tests for row and property operations pass.
7. End-to-end tests cover creating a database, adding a property, adding a row, editing cells,
   and opening a row as a page — and pass.

### Phase 4 — Board and list views, filters and sorts

**Features**

- The view switcher; board view grouped by a chosen select property; list view.
- Drag a card between board columns to change its value.
- Per-view filters and sort, persisted.
- Seed extended so at least one database shows a meaningful board.

**Success criteria**

1. Each database switches between table, board and list in place, all showing the same rows.
2. The board groups rows by a chosen select property, one column per option, each card showing
   its row's title.
3. Dragging a card to another column changes that property's value, the change appears in the
   table view too, and it survives a refresh.
4. Each of the filter kinds listed above can be applied and visibly narrows the rows; a sort
   orders rows by a chosen property in either direction.
5. Filters, sort and grouping are remembered per view, and survive a refresh.
6. The list view shows each row's title and at least one property.
7. Unit tests for filtering, sorting and card moves pass.
8. End-to-end tests cover switching all three views, dragging a card between columns, and
   applying a filter and a sort — and pass.

### Phase 5 — Search, dark mode and the full workspace

**Features**

- Quick-find with a keyboard shortcut and a visible control; live results; jump to result.
- The light / dark toggle, persisted.
- The seed grown into the full showcase workspace.

**Success criteria**

1. The quick-find opens by both the shortcut and the control; typing narrows results live across
   page, database and row titles; choosing a result navigates to it.
2. The theme toggle switches the whole app between light and dark; the choice survives a restart;
   every screen is presentable in both themes.
3. The seeded workspace demonstrates every feature: every block type, every property type, all
   three views, at least one filtered view, at least one sorted view, and a board grouped in a
   way that makes sense for its data.
4. Unit tests for search pass.
5. End-to-end tests cover searching and jumping to a result, and toggling the theme — and pass.

### Phase 6 — Final quality gate

**Work**

- A look-and-feel pass over the whole app in both themes.
- The full unit and end-to-end suites, with coverage measured.
- A complete walkthrough of the running app in a real browser.
- An adversarial review of the finished product.

**Success criteria**

1. The full unit test suites pass with statement coverage of at least 80% on both frontend and
   backend, reported by the test command.
2. The full end-to-end suite passes against the running app.
3. The running app has been driven end to end in a real browser, exercising every feature in this
   document, with screenshots of every screen in both themes, visually inspected. No errors
   appear in the browser console during the walkthrough.
4. An adversarial review has been carried out: the running product was used in unscripted,
   hostile ways to try to break it — bad input, odd sequences, edge cases. Every finding is
   recorded with steps to reproduce, and every recorded finding is either fixed or rejected with
   a written reason.
5. After the last fix, the full unit and end-to-end suites were rerun and pass.
6. The look-and-feel rules are met, in both themes, and none of the avoid-list appears anywhere.

## Final success criteria

The project is complete, and the Coding Agent may stop, when **all** of the following are true:

- A non-technical person can start the app with a single documented command and use it in a
  browser.
- Pages, the editor, databases, views, search and both themes all work as described above, and
  every change persists across refresh and restart.
- Drag and drop works in both places: reordering blocks in a page, and moving cards between board
  columns.
- The app ships fully populated, so it looks alive on first launch.
- The look-and-feel rules are met and none of the avoid-list appears anywhere.
- All unit tests pass with at least 80% statement coverage on frontend and backend, and the full
  end-to-end suite passes.
- The adversarial review record exists, every finding in it is fixed or rejected with a written
  reason, and all suites pass on the final build.
- **Most importantly: the product has been validated by using it end to end in a real browser —
  clicking through every feature as a real user would, in both themes, visually inspecting every
  screen. Passing tests is necessary but NOT sufficient; the Coding Agent must confirm the
  running product works and looks right, not merely that the suites are green.**
