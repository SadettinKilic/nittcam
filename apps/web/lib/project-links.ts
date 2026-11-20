/** T292: projects split off from one another (other board thickness), shared by route and client. */
export interface ProjectLink {
  id: string;
  name: string;
}

/** GET /api/projects/:id/links */
export interface ProjectLinks {
  /** The live project this one was split off from. */
  source: ProjectLink | null;
  /** Live projects split off from this one, oldest first. */
  derived: ProjectLink[];
}
