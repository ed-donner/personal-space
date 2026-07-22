import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Block, type BlockContent, type BlockType } from '../lib/api';
import { reorderBlocks } from './helpers';

const AUTOSAVE_DEBOUNCE_MS = 500;

export function useBlockEditor(pageId: string) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBlocks([]);
    void api
      .getBlocks(pageId)
      .then(({ blocks: loaded }) => {
        if (cancelled) return;
        setBlocks([...loaded].sort((a, b) => a.position - b.position));
      })
      .catch(() => {
        if (!cancelled) setBlocks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    []
  );

  const commitTimer = useCallback((id: string, content: BlockContent) => {
    const existing = timers.current.get(id);
    if (existing !== undefined) window.clearTimeout(existing);
    timers.current.set(
      id,
      window.setTimeout(() => {
        timers.current.delete(id);
        void api.updateBlock(id, { content }).catch(() => undefined);
      }, AUTOSAVE_DEBOUNCE_MS)
    );
  }, []);

  const patchBlock = useCallback(
    (id: string, content: BlockContent) => {
      setBlocks((current) => {
        const next = current.map((block) =>
          block.id === id ? { ...block, content: { ...block.content, ...content } } : block
        );
        const updated = next.find((block) => block.id === id);
        if (updated) commitTimer(id, updated.content);
        return next;
      });
    },
    [commitTimer]
  );

  const flushBlock = useCallback(
    (id: string) => {
      const timer = timers.current.get(id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timers.current.delete(id);
      }
      setBlocks((current) => {
        const found = current.find((block) => block.id === id);
        if (found) void api.updateBlock(id, { content: found.content }).catch(() => undefined);
        return current;
      });
    },
    []
  );

  const setEditing = useCallback((_id: string, _editing: boolean) => undefined, []);

  const createBlock = useCallback(
    async (type: BlockType, content: BlockContent = { text: '' }, atIndex?: number) => {
      const position = atIndex ?? blocks.length;
      const created = await api.createBlock(pageId, { type, position, content });
      setBlocks((current) => {
        const next = [...current, created].sort((a, b) => a.position - b.position);
        if (atIndex !== undefined) {
          next.sort((a, b) => a.position - b.position);
        }
        return next;
      });
      return created;
    },
    [pageId, blocks.length]
  );

  const createBlockAfter = useCallback(
    async (block: Block, type: BlockType = 'paragraph') => {
      const content: BlockContent =
        type === 'todo' ? { text: '', checked: false } : type === 'divider' ? {} : { text: '' };
      const created = await api.createBlock(pageId, { type, position: block.position + 1, content });
      setBlocks((current) => {
        const next = [
          ...current.map((b) => (b.position > block.position ? { ...b, position: b.position + 1 } : b)),
          created,
        ].sort((a, b) => a.position - b.position);
        return next;
      });
      return created;
    },
    [pageId]
  );

  const convertBlock = useCallback(async (id: string, type: BlockType) => {
    const content: BlockContent =
      type === 'todo' ? { text: '', checked: false } : type === 'divider' ? {} : { text: '' };
    setBlocks((current) => current.map((block) => (block.id === id ? { ...block, type, content } : block)));
    await api.updateBlock(id, { type, content }).catch(() => undefined);
  }, []);

  const removeBlock = useCallback(async (id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setBlocks((current) => {
      const removed = current.find((block) => block.id === id);
      if (!removed) return current;
      return current
        .filter((block) => block.id !== id)
        .map((block) => ({ ...block, position: block.position > removed.position ? block.position - 1 : block.position }));
    });
    await api.deleteBlock(id).catch(() => undefined);
  }, []);

  const reorder = useCallback(
    async (activeId: string, overId: string) => {
      let orderedIds: string[] = [];
      setBlocks((current) => {
        const next = reorderBlocks(current, activeId, overId);
        if (next === current) return current;
        orderedIds = next.map((block) => block.id);
        return next;
      });
      if (orderedIds.length) await api.reorderBlocks(pageId, orderedIds).catch(() => undefined);
    },
    [pageId]
  );

  const createFirstBlock = useCallback(async () => createBlock('paragraph', { text: '' }, 0), [createBlock]);

  return {
    blocks,
    loading,
    patchBlock,
    flushBlock,
    setEditing,
    createBlock,
    createBlockAfter,
    createFirstBlock,
    convertBlock,
    removeBlock,
    reorder,
  };
}
