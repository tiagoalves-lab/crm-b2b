export type PolicyAction = 'read' | 'write' | 'delete';

export interface OwnedResource {
  ownerUserId: string | null;
}
