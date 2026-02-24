import { readFile, writeFile, readdir, mkdir, appendFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createLogger, type AgentId } from '@jarvis/shared';

const log = createLogger('knowledge:base');

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  source: string;
  agentId: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SearchResult {
  entry: KnowledgeEntry;
  score: number;
  matchedTerms: string[];
}

/**
 * KnowledgeBase - Stores and retrieves knowledge on NAS.
 *
 * Uses a simple file-based storage with TF-IDF-like text search.
 * Future: can be upgraded to vector embeddings with sqlite-vec.
 *
 * Structure on NAS:
 *   /knowledge/entries/{id}.json      - Individual entries
 *   /knowledge/index.json             - Search index
 *   /knowledge/tags.json              - Tag index
 */
export class KnowledgeBase {
  private entriesDir: string;
  private indexPath: string;
  private index: Map<string, Set<string>> = new Map(); // term -> entry IDs
  private entries: Map<string, KnowledgeEntry> = new Map();
  private loaded = false;

  constructor(nasPath: string) {
    this.entriesDir = join(nasPath, 'knowledge', 'entries');
    this.indexPath = join(nasPath, 'knowledge', 'index.json');
  }

  async init(): Promise<void> {
    await mkdir(this.entriesDir, { recursive: true });
    await this.loadIndex();
    log.info(`Knowledge base initialized: ${this.entries.size} entries`);
  }

  /** Add a new knowledge entry */
  async add(entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = `kb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullEntry: KnowledgeEntry = {
      ...entry,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Save entry
    await writeFile(
      join(this.entriesDir, `${id}.json`),
      JSON.stringify(fullEntry, null, 2),
      'utf-8',
    );

    // Update in-memory
    this.entries.set(id, fullEntry);
    this.indexEntry(fullEntry);
    await this.saveIndex();

    log.info(`Added knowledge entry: ${id} - ${entry.title}`);
    return id;
  }

  /** Update an existing entry */
  async update(id: string, updates: Partial<Pick<KnowledgeEntry, 'title' | 'content' | 'tags'>>): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    // Remove old terms from index
    this.removeFromIndex(entry);

    // Apply updates
    if (updates.title) entry.title = updates.title;
    if (updates.content) entry.content = updates.content;
    if (updates.tags) entry.tags = updates.tags;
    entry.updatedAt = Date.now();

    // Save and re-index
    await writeFile(join(this.entriesDir, `${id}.json`), JSON.stringify(entry, null, 2), 'utf-8');
    this.indexEntry(entry);
    await this.saveIndex();

    return true;
  }

  /** Search knowledge base using TF-IDF-like text matching */
  search(query: string, limit = 10): SearchResult[] {
    const queryTerms = tokenize(query);
    const scores = new Map<string, { score: number; matchedTerms: string[] }>();

    for (const term of queryTerms) {
      const entryIds = this.index.get(term);
      if (!entryIds) continue;

      // IDF: rarer terms score higher
      const idf = Math.log(this.entries.size / (entryIds.size + 1));

      for (const entryId of entryIds) {
        const existing = scores.get(entryId) ?? { score: 0, matchedTerms: [] };
        existing.score += idf;
        if (!existing.matchedTerms.includes(term)) {
          existing.matchedTerms.push(term);
        }
        scores.set(entryId, existing);
      }
    }

    // Boost for matching more unique terms
    for (const [, data] of scores) {
      data.score *= (1 + data.matchedTerms.length * 0.2);
    }

    return Array.from(scores.entries())
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, limit)
      .map(([entryId, data]) => ({
        entry: this.entries.get(entryId)!,
        score: data.score,
        matchedTerms: data.matchedTerms,
      }))
      .filter((r) => r.entry);
  }

  /** Search by tags */
  searchByTags(tags: string[], limit = 10): KnowledgeEntry[] {
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));
    return Array.from(this.entries.values())
      .filter((e) => e.tags.some((t) => tagSet.has(t.toLowerCase())))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  /** Get a specific entry */
  get(id: string): KnowledgeEntry | undefined {
    return this.entries.get(id);
  }

  /** List recent entries */
  listRecent(limit = 20): KnowledgeEntry[] {
    return Array.from(this.entries.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  /** Get stats */
  stats(): { entryCount: number; tagCount: number; termCount: number } {
    const allTags = new Set<string>();
    for (const entry of this.entries.values()) {
      for (const tag of entry.tags) allTags.add(tag);
    }
    return {
      entryCount: this.entries.size,
      tagCount: allTags.size,
      termCount: this.index.size,
    };
  }

  /** Load all entries and rebuild index */
  private async loadIndex(): Promise<void> {
    if (this.loaded) return;

    try {
      const files = await readdir(this.entriesDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await readFile(join(this.entriesDir, file), 'utf-8');
          const entry = JSON.parse(content) as KnowledgeEntry;
          this.entries.set(entry.id, entry);
          this.indexEntry(entry);
        } catch {
          // Skip corrupt entries
        }
      }
    } catch {
      // Directory might not exist yet
    }

    this.loaded = true;
  }

  private indexEntry(entry: KnowledgeEntry): void {
    const terms = tokenize(`${entry.title} ${entry.content} ${entry.tags.join(' ')}`);
    for (const term of terms) {
      if (!this.index.has(term)) this.index.set(term, new Set());
      this.index.get(term)!.add(entry.id);
    }
  }

  private removeFromIndex(entry: KnowledgeEntry): void {
    const terms = tokenize(`${entry.title} ${entry.content} ${entry.tags.join(' ')}`);
    for (const term of terms) {
      this.index.get(term)?.delete(entry.id);
    }
  }

  private async saveIndex(): Promise<void> {
    // Serializable index: term -> array of entry IDs
    const serializable: Record<string, string[]> = {};
    for (const [term, ids] of this.index) {
      if (ids.size > 0) serializable[term] = Array.from(ids);
    }
    await writeFile(this.indexPath, JSON.stringify(serializable), 'utf-8');
  }
}

/** Simple tokenizer: lowercase, split on non-alphanumeric, filter short/stop words */
function tokenize(text: string): string[] {
  const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'not', 'with', 'from', 'by', 'as', 'this', 'that', 'was', 'are', 'be', 'has', 'had', 'have', 'will', 'would', 'could', 'should', 'do', 'does', 'did']);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}
