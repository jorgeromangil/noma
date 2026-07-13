const slugify = (value) => {
    const base = String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return base || 'item';
};

const ensureUniqueSlug = async (Model, baseSlug, idToExclude) => {
    const base = baseSlug || 'item';
    let slug = base;
    let counter = 2;

    const buildFilter = () => {
        if (!idToExclude) return { slug };
        return { slug, _id: { $ne: idToExclude } };
    };

    while (await Model.exists(buildFilter())) {
        slug = `${base}-${counter}`;
        counter += 1;
    }

    return slug;
};

module.exports = { slugify, ensureUniqueSlug };
