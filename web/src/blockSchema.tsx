// BlockNote schema with a custom `callout` block.
//
// All 10 of BlockNote's defaults we want are kept as-is (paragraph, heading,
// bulletListItem, numberedListItem, checkListItem, quote, divider, codeBlock,
// plus the headings 1..3 via level prop). The 11th — callout — is registered
// here so the slash menu can offer it and it renders as a tinted panel.

import {
  BlockNoteSchema,
  defaultBlockSpecs,
  type BlockConfig,
  type PropSchema,
} from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";

interface CalloutProps extends PropSchema {
  backgroundColor: { default: "default"; values: readonly string[] };
  textColor: { default: "default"; values: readonly string[] };
  emoji: { default: string; values: readonly string[] };
}

const calloutConfig: BlockConfig<"callout", CalloutProps, "inline"> = {
  type: "callout",
  propSchema: {
    backgroundColor: { default: "default", values: ["default"] },
    textColor: { default: "default", values: ["default"] },
    emoji: { default: "", values: [""] },
  },
  content: "inline",
};

const calloutSpec = createReactBlockSpec(calloutConfig, {
  render: ({ block, contentRef }) => {
    const emoji = (block.props as { emoji?: string }).emoji ?? "";
    return (
      <div className="bn-callout" data-callout="true">
        {emoji && (
          <span className="bn-callout-emoji" aria-hidden="true">
            {emoji}
          </span>
        )}
        <div className="bn-callout-body" ref={contentRef} />
      </div>
    );
  },
});

export type AppBlockSchema = typeof appSchema.blockSchema;
export type AppInlineContentSchema = typeof appSchema.inlineContentSchema;
export type AppStyleSchema = typeof appSchema.styleSchema;

export const appSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    // `createReactBlockSpec` returns a creator function; call it to get the
    // spec object the schema expects.
    callout: calloutSpec(),
  },
});