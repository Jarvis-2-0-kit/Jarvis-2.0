import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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

/** Recency boost window in ms (7 days) */
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * KnowledgeBase - Stores and retrieves knowledge on NAS.
 *
 * Uses a simple file-based storage with TF-IDF text search,
 * fuzzy matching, recency boost, and tag weighting.
 *
 * Structure on NAS:
 *   /knowledge/entries/{id}.json      - Individual entries
 *   /knowledge/index.json             - Search index
 *   /knowledge/tags.json              - Tag index
 */
export class KnowledgeBase {
  private entriesDir: string;
  private indexPath: string;
  private index: Map<string, Map<string, number>> = new Map(); // term -> {entryId -> termFrequency}
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

  /** Search knowledge base using TF-IDF with fuzzy matching, recency boost, and tag weighting */
  search(query: string, limit = 10): SearchResult[] {
    const queryTerms = tokenize(query);
    const scores = new Map<string, { score: number; matchedTerms: string[] }>();
    const N = this.entries.size;
    if (N === 0 || queryTerms.length === 0) return [];

    const queryTagTerms = new Set(queryTerms);

    for (const term of queryTerms) {
      // Exact matches
      const exactEntries = this.index.get(term);
      if (exactEntries) {
        const df = exactEntries.size;
        const idf = Math.log(1 + N / df);
        for (const [entryId, tf] of exactEntries) {
          const tfidf = Math.log(1 + tf) * idf;
          const existing = scores.get(entryId) ?? { score: 0, matchedTerms: [] };
          existing.score += tfidf;
          if (!existing.matchedTerms.includes(term)) existing.matchedTerms.push(term);
          scores.set(entryId, existing);
        }
      }

      // Fuzzy matching: for terms >= 4 chars, check prefix similarity with indexed terms
      if (term.length >= 4) {
        for (const [indexedTerm, entryMap] of this.index) {
          if (indexedTerm === term) continue; // already handled
          if (prefixSimilarity(term, indexedTerm) >= 0.75) {
            const df = entryMap.size;
            const idf = Math.log(1 + N / df);
            for (const [entryId, tf] of entryMap) {
              const tfidf = Math.log(1 + tf) * idf * 0.5; // 0.5x weight for fuzzy
              const existing = scores.get(entryId) ?? { score: 0, matchedTerms: [] };
              existing.score += tfidf;
              if (!existing.matchedTerms.includes(term)) existing.matchedTerms.push(term);
              scores.set(entryId, existing);
            }
          }
        }
      }
    }

    const now = Date.now();

    for (const [entryId, data] of scores) {
      const entry = this.entries.get(entryId);
      if (!entry) continue;

      // Multi-term boost
      data.score *= (1 + data.matchedTerms.length * 0.2);

      // Recency boost: up to 50% boost for entries within the last 7 days (linear decay)
      const age = now - entry.updatedAt;
      if (age < RECENCY_WINDOW_MS) {
        data.score *= 1 + 0.5 * (1 - age / RECENCY_WINDOW_MS);
      }

      // Tag boost: 30% boost if any query term matches a tag
      const entryTags = entry.tags.map(t => t.toLowerCase());
      for (const qt of queryTagTerms) {
        if (entryTags.some(t => t.includes(qt) || qt.includes(t))) {
          data.score *= 1.3;
          break;
        }
      }
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
    // Count term frequency per entry
    const termCounts = new Map<string, number>();
    for (const term of terms) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }
    for (const [term, count] of termCounts) {
      if (!this.index.has(term)) this.index.set(term, new Map());
      this.index.get(term)!.set(entry.id, count);
    }
  }

  private removeFromIndex(entry: KnowledgeEntry): void {
    const terms = tokenize(`${entry.title} ${entry.content} ${entry.tags.join(' ')}`);
    for (const term of terms) {
      this.index.get(term)?.delete(entry.id);
    }
  }

  private async saveIndex(): Promise<void> {
    // Serializable index: term -> {entryId: tf}
    const serializable: Record<string, Record<string, number>> = {};
    for (const [term, entryMap] of this.index) {
      if (entryMap.size > 0) {
        const obj: Record<string, number> = {};
        for (const [id, tf] of entryMap) obj[id] = tf;
        serializable[term] = obj;
      }
    }
    await writeFile(this.indexPath, JSON.stringify(serializable), 'utf-8');
  }
}

/** Prefix similarity: ratio of shared prefix length to the longer string's length */
function prefixSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  let shared = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) shared++;
    else break;
  }
  return shared / maxLen;
}

/** Simple tokenizer: lowercase, split on non-alphanumeric, filter short/stop words */
const STOP_WORDS = new Set(['the', 'a', 'an', 'is', 'it', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'not', 'with', 'from', 'by', 'as', 'this', 'that', 'was', 'are', 'be', 'has', 'had', 'have', 'will', 'would', 'could', 'should', 'do', 'does', 'did']);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}
