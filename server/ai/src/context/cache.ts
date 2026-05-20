import { getProjectInfo, listCompositions, ProjectInfo, CompositionsList } from "../mcp/tools.js";

interface CacheEntry<T> {
  value: T;
}

export class SessionCache {
  private projectInfo: CacheEntry<ProjectInfo> | null = null;
  private compositionsList: CacheEntry<CompositionsList> | null = null;

  async getProjectInfo(): Promise<ProjectInfo> {
    if (!this.projectInfo) {
      this.projectInfo = { value: await getProjectInfo() };
    }
    return this.projectInfo.value;
  }

  async getCompositionsList(): Promise<CompositionsList> {
    if (!this.compositionsList) {
      this.compositionsList = { value: await listCompositions() };
    }
    return this.compositionsList.value;
  }

  invalidate(): void {
    this.projectInfo = null;
    this.compositionsList = null;
  }
}

export const sessionCache = new SessionCache();
