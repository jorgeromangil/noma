import type { ProductModalData } from '../pages/home/product-modal/product-modal';

export function mapApiProductToModalData(product: any): ProductModalData | null {
  if (!product) {
    return null;
  }

  const media: string[] = Array.isArray(product.media)
    ? product.media
    : (product.media ? [product.media] : []);
  const image = media.length > 0 ? undefined : product.image;
  const owner = product.owner;
  const ownerName = !owner
    ? ''
    : typeof owner === 'string'
      ? owner
      : (owner.company_name || [owner.name, owner.surname].filter(Boolean).join(' ').trim());

  return {
    title: product.name,
    description: product.description,
    resumen: product.resumen,
    category: product.category,
    historia_origen: product.historia_origen,
    importancia_cultural: product.importancia_cultural,
    proceso_elaboracion: product.proceso_elaboracion,
    materias_primas: product.materias_primas,
    tiempo_elaboracion: product.tiempo_elaboracion,
    certificaciones_protecciones: product.certificaciones_protecciones,
    province: product.province,
    autonomous_community: product.autonomous_community,
    address_text: product.address_text,
    owner: product.owner,
    owner_name: ownerName,
    media,
    image,
    id: product.uid || product._id,
    uid: product.uid || product._id,
    _id: product._id || product.uid,
    slug: product.slug
  };
}
