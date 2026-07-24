export type PolicyAction = 'read' | 'write';

export interface OwnedResource {
  ownerUserId: string | null;
}
