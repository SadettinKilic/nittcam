/**
 * T332 rider (PO, docs/machines/controllers/mach3-saha-kontrol.md): the "Mach3 ön kontrol" lines
 * of the field kit, only for a machine whose post is `mach3`; null for every other post.
 */
export function mach3PreCheckItems(
  postId: string | null | undefined,
  t: { items: readonly string[] },
): readonly string[] | null {
  return postId === 'mach3' ? t.items : null;
}
