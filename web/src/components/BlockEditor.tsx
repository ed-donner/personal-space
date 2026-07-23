// BlockEditor: Notion-style block editor built on BlockNote.
//
// Responsibilities:
//   - Create a BlockNote editor with our app schema (paragraph, headings
//     1..3, bulleted/numbered lists, todo, quote, divider, code, callout).
//   - Seed it with the page's blocks via apiToPartialBlocks.
//   - On every change, schedule a debounced autosave (PUT replace).
//   - Provide a custom slash menu that maps the visible menu entries to our
//     BlockType values; filtering and keyboard/mouse navigation come from
//     BlockNote's Mantine renderer.
//   - Apply our palette via CSS variable overrides on the editor's DOM.
//
// The component is intentionally thin: it does not own block storage
// (blocksStore.ts does) and does not own the page tree (store.ts does).

import { useEffect, useMemo } from "react";
import { filterSuggestionItems } from "@blocknote/core";
import {
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import type { ReactNode } from "react";
import { useBlocks } from "../blocksStore";
import { apiToPartialBlocks, documentToReplaceBlocks } from "../blocks";
import { appSchema } from "../blockSchema";

// Custom slash menu items. We use BlockNote's `filterSuggestionItems` (it
// matches title + aliases case-insensitively) so the menu feels familiar.
// Each item holds an `onItemClick` that mutates the editor: it transforms
// the paragraph containing the slash query into the chosen block type.

interface SlashItem {
  key: string;
  title: string;
  aliases: string[];
  group: string;
  subtext?: string;
  icon: ReactNode;
  onItemClick: () => void;
}

const ICONS = {
  paragraph: "Aa",
  h1: "H1",
  h2: "H2",
  h3: "H3",
  bullet: "\u2022",
  number: "1.",
  todo: "\u2610",
  quote: "\u201C",
  divider: "\u2014",
  code: "</>",
  callout: "!",
};

function keyToBnType(key: string): string {
  switch (key) {
    case "paragraph":
      return "paragraph";
    case "heading1":
    case "heading2":
    case "heading3":
      return "heading";
    case "bulleted":
      return "bulletListItem";
    case "numbered":
      return "numberedListItem";
    case "todo":
      return "checkListItem";
    case "quote":
      return "quote";
    case "divider":
      return "divider";
    case "code":
      return "codeBlock";
    case "callout":
      return "callout";
    default:
      return "paragraph";
  }
}

function makeSlashItems(): Omit<SlashItem, "onItemClick">[] {
  return [
    { key: "paragraph", title: "Text", aliases: ["text", "paragraph", "p"], group: "Basic", icon: ICONS.paragraph },
    { key: "heading1", title: "Heading 1", aliases: ["h1", "heading 1", "title"], group: "Headings", icon: ICONS.h1 },
    { key: "heading2", title: "Heading 2", aliases: ["h2", "heading 2"], group: "Headings", icon: ICONS.h2 },
    { key: "heading3", title: "Heading 3", aliases: ["h3", "heading 3"], group: "Headings", icon: ICONS.h3 },
    { key: "bulleted", title: "Bulleted list", aliases: ["bullet", "bulleted", "list", "ul"], group: "Lists", icon: ICONS.bullet },
    { key: "numbered", title: "Numbered list", aliases: ["numbered", "number", "ol"], group: "Lists", icon: ICONS.number },
    { key: "todo", title: "To-do", aliases: ["todo", "check", "checkbox", "task"], group: "Lists", icon: ICONS.todo },
    { key: "quote", title: "Quote", aliases: ["quote", "blockquote"], group: "Blocks", icon: ICONS.quote },
    { key: "divider", title: "Divider", aliases: ["divider", "hr", "rule", "line", "---"], group: "Blocks", icon: ICONS.divider },
    { key: "code", title: "Code", aliases: ["code", "pre", "codeblock"], group: "Blocks", icon: ICONS.code },
    { key: "callout", title: "Callout", aliases: ["callout", "info", "note"], group: "Blocks", icon: ICONS.callout },
  ];
}

export interface BlockEditorProps {
  pageId: string;
}

export function BlockEditor({ pageId }: BlockEditorProps) {
  const load = useBlocks((s) => s.load);
  const loading = useBlocks((s) => s.loading);
  const error = useBlocks((s) => s.error);
  const loadedPageId = useBlocks((s) => s.pageId);
  const blocksLength = useBlocks((s) => s.blocks.length);

  useEffect(() => {
    void load(pageId);
  }, [pageId, load]);

  // Show an error only after we've actually failed a load for *this* page.
  if (error && !loading && loadedPageId === pageId && blocksLength === 0) {
    return <BlockEditorError error={error} onRetry={() => void load(pageId)} />;
  }

  // BlockNote reads `initialContent` exactly once when the editor is
  // constructed. If we let it mount before blocks have loaded it sees an
  // empty document. So we wait for the load (signalled by `pageId`
  // matching the loaded one and `loading` being false) and only then
  // render the inner editor. An empty page also reaches this state with
  // `blocks.length === 0` — that's fine, the inner editor will create a
  // single empty paragraph.
  if (loadedPageId !== pageId || loading) {
    return <div className="block-loading">Loading blocks…</div>;
  }

  return (
    <div className="bn-host" data-block-editor-page={pageId}>
      <BlockEditorInner pageId={pageId} />
    </div>
  );
}

function BlockEditorInner({ pageId }: { pageId: string }) {
  const blocks = useBlocks((s) => s.blocks);
  const scheduleSave = useBlocks((s) => s.scheduleSave);
  const flush = useBlocks((s) => s.flush);

  const editor = useCreateBlockNote(
    {
      schema: appSchema,
      initialContent:
        blocks.length === 0
          ? undefined
          : (apiToPartialBlocks(blocks) as never),
    },
    [pageId],
  );

  // Subscribe to document changes and debounce-save them.
  useEffect(() => {
    const off = editor.onChange(() => {
      const doc = editor.document;
      const replace = documentToReplaceBlocks(
        doc as unknown as Parameters<typeof documentToReplaceBlocks>[0],
      );
      scheduleSave(pageId, replace);
    });
    return () => {
      off();
    };
  }, [editor, pageId, scheduleSave]);

  // Flush a pending save when the user navigates away.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  // Build a custom slash menu. BlockNote's filterSuggestionItems does
  // case-insensitive contains on title + aliases; we wrap it in a promise
  // because that's the signature SuggestionMenuController expects.
  const getSlashItems = useMemo(() => {
    return async (query: string) => {
      const editorRef = editor;
      const items = makeSlashItems();
      const wrapped = items.map((it) => ({
        key: it.key,
        title: it.title,
        aliases: it.aliases,
        group: it.group,
        subtext: it.subtext ?? "",
        icon: <span className="bn-slash-icon">{it.icon}</span>,
        onItemClick: () => {
          const cursorBlock = editorRef.getTextCursorPosition().block;
          editorRef.updateBlock(cursorBlock, {
            type: keyToBnType(it.key),
            // Clear inline content so the trigger character and any typed
            // filter text disappear with the slash menu.
            content: undefined,
            props:
              it.key === "heading1"
                ? { level: 1 }
                : it.key === "heading2"
                  ? { level: 2 }
                  : it.key === "heading3"
                    ? { level: 3 }
                    : it.key === "todo"
                      ? { checked: false }
                      : ({} as Record<string, unknown>),
          } as never);
        },
      }));
      return filterSuggestionItems(wrapped, query);
    };
  }, [editor]);

  return (
    <BlockNoteView
      editor={editor}
      theme="light"
      slashMenu={false}
      formattingToolbar
      linkToolbar
      sideMenu
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={getSlashItems}
      />
    </BlockNoteView>
  );
}

function BlockEditorError({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="block-error" role="alert">
      <strong>Couldn’t load this page.</strong>
      <p>{error}</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

// A small, non-blocking save indicator. Reads from the blocks store; the
// store updates its `saveStatus` whenever a save fires.
export function SaveIndicator() {
  const status = useBlocks((s) => s.saveStatus);
  const lastSavedAt = useBlocks((s) => s.lastSavedAt);
  let label: string;
  if (status === "saving") label = "Saving…";
  else if (status === "saved")
    label = lastSavedAt ? `Saved ${formatTime(lastSavedAt)}` : "Saved";
  else if (status === "error") label = "Save failed";
  else label = "";
  if (!label) return null;
  return (
    <span className="save-indicator" data-status={status}>
      {label}
    </span>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}